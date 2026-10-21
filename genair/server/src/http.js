// HTTP plumbing shared by every route: errors, JSON, body parsing, CORS, auth.
import { createHash, timingSafeEqual } from 'node:crypto';

export const MAX_BODY_BYTES = 25 * 1024 * 1024;

export const CORS_ALLOW_HEADERS =
  'content-type, x-app-token, anthropic-beta, authorization, x-client-id, x-file-name, x-case-id, x-folder, x-drive-folder-id, last-event-id';
export const CORS_ALLOW_METHODS = 'GET, POST, PATCH, DELETE, OPTIONS';
export const CORS_EXPOSE_HEADERS = 'x-auth-token';

export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

export function errorBody(err) {
  const error = { code: err.code, message: err.message };
  if (err.details !== undefined) error.details = err.details;
  return { error };
}

export function sendError(res, err) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  if (!(err instanceof HttpError)) {
    // Log only the message: request bodies and headers may hold secrets or PII.
    console.error('[genair-server] unexpected error:', err?.message ?? err);
    err = new HttpError(500, 'internal_error', 'שגיאה פנימית בשרת');
  }
  const headers = {};
  if (err.status === 413) headers.connection = 'close';
  if (err.allow) headers.allow = err.allow;
  if (err.retryAfter) headers['retry-after'] = String(err.retryAfter);
  sendJson(res, err.status, errorBody(err), headers);
}

/** Reads the raw request body as a Buffer, enforcing the size limit. */
export async function readBody(req, limit = MAX_BODY_BYTES) {
  const tooLarge = () =>
    new HttpError(413, 'payload_too_large', `גוף הבקשה גדול מדי (מקסימום ${Math.round(limit / 1024 / 1024)}MB)`, {
      limitBytes: limit,
    });

  // Platforms that buffer the body before calling us (Vercel helpers, GCF).
  if (Buffer.isBuffer(req.rawBody)) {
    if (req.rawBody.length > limit) throw tooLarge();
    return req.rawBody;
  }
  // With Vercel's Node helpers on, the stream is already consumed and req.body is a
  // lazy parser (it throws on bad JSON). Set NODEJS_HELPERS=0 to get the exact bytes,
  // which WhatsApp signature checks need.
  if (req.readableEnded) {
    let b;
    try {
      b = req.body;
    } catch {
      throw new HttpError(400, 'invalid_json', 'גוף הבקשה אינו JSON תקין');
    }
    if (b === undefined) return Buffer.alloc(0);
    const buf = Buffer.isBuffer(b) ? b : Buffer.from(typeof b === 'string' ? b : JSON.stringify(b ?? null));
    if (buf.length > limit) throw tooLarge();
    return buf;
  }

  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) throw tooLarge();

  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onErr);
      fn(value);
    };
    const onData = (chunk) => {
      size += chunk.length;
      if (size > limit) {
        finish(reject, tooLarge());
        req.resume();
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => finish(resolve, Buffer.concat(chunks));
    const onErr = (e) => finish(reject, e);
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onErr);
  });
}

export function parseJson(buf) {
  const text = buf.toString('utf8').trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'invalid_json', 'גוף הבקשה אינו JSON תקין');
  }
}

export async function readJson(req) {
  const value = parseJson(await readBody(req));
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'invalid_json', 'גוף הבקשה חייב להיות אובייקט JSON');
  }
  return value;
}

/**
 * Client IP for rate limits. Behind a proxy (Render, Fly, nginx) set TRUST_PROXY=true. Each proxy appends the address it
 * saw to X-Forwarded-For, so the left side is whatever the client claimed; the real client is the entry `hops` places from
 * the right (TRUST_PROXY_HOPS, default 1 = a single proxy in front).
 */
export function clientIp(req, trustProxy = false, hops = 1) {
  if (trustProxy) {
    const parts = String(req.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const n = Math.max(1, Math.floor(Number(hops)) || 1);
    if (parts.length) return parts[Math.max(0, parts.length - n)];
  }
  return req.socket?.remoteAddress ?? 'unknown';
}

export const ipOf = (req, cfg) => clientIp(req, cfg.db.trustProxy, cfg.db.trustProxyHops);

/** Constant-time string comparison (hashing first hides the length too). */
export function safeEqual(a, b) {
  const ha = createHash('sha256').update(String(a ?? ''), 'utf8').digest();
  const hb = createHash('sha256').update(String(b ?? ''), 'utf8').digest();
  return timingSafeEqual(ha, hb);
}

function sameHost(origin, host) {
  try {
    return Boolean(host) && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Sets CORS headers. Returns false when the request carries an Origin that is
 * neither allow-listed nor the server's own host (server-to-server calls such as
 * Meta's webhook send no Origin and are always allowed through).
 */
export function applyCors(req, res, allowedOrigins) {
  const origin = req.headers.origin;
  res.setHeader('vary', 'Origin');
  if (!origin) return true;
  const wildcard = allowedOrigins.includes('*');
  const allowed = wildcard || allowedOrigins.includes(origin) || sameHost(origin, req.headers.host);
  if (!allowed) return false;
  res.setHeader('access-control-allow-origin', wildcard ? '*' : origin);
  res.setHeader('access-control-allow-methods', CORS_ALLOW_METHODS);
  res.setHeader('access-control-allow-headers', CORS_ALLOW_HEADERS);
  res.setHeader('access-control-expose-headers', CORS_EXPOSE_HEADERS);
  res.setHeader('access-control-max-age', '600');
  return true;
}

/**
 * fetch() with a timeout; maps network failures to HttpErrors.
 * `service` = { code: 'priority', label: 'פריוריטי', to: 'לפריוריטי' } (label/to are Hebrew UI text).
 */
export async function fetchUpstream(url, init, { timeoutMs, service, fetchImpl = globalThis.fetch }) {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new HttpError(504, `${service.code}_timeout`, `${service.label} לא הגיב בזמן (${Math.round(timeoutMs / 1000)} שניות)`);
    }
    throw new HttpError(502, `${service.code}_unreachable`, `לא ניתן להתחבר ${service.to}`, {
      reason: err?.cause?.code || err?.message || 'network_error',
    });
  }
}

/** Reads an upstream body as JSON when possible, else as (truncated) text. */
export async function readUpstream(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text.length > 1000 ? `${text.slice(0, 1000)}…` : text;
  }
}

/** Headers every API answer carries (the API returns JSON, never a page). */
export function applySecurityHeaders(req, res, cfg) {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
  const https = Boolean(req.socket?.encrypted) || (cfg.db.trustProxy && String(req.headers['x-forwarded-proto'] ?? '').split(',').pop().trim() === 'https');
  if (https) res.setHeader('strict-transport-security', 'max-age=15552000');
}

// ---------------------------------------------------------------- links stored in records

/** Fields that hold a link somebody may click later. A link with any other scheme (javascript:, data:, vbscript:) is never stored. */
export const URL_FIELDS = new Set(['url', 'website', 'webViewLink', 'driveFolderUrl', 'link', 'href']);

/**
 * Returns a link that is safe to put in an href, or undefined. Allowed: http(s), mailto, tel, an app path ("/cases/k1", "#/x")
 * and a bare domain ("example.com", which gets https://).
 */
export function safeUrl(value) {
  if (typeof value !== 'string') return undefined;
  const s = value.trim();
  if (!s || s.length > 2048 || /[\u0000-\u001f\u007f\s]/.test(s)) return undefined;
  if (/^(https?:\/\/|mailto:|tel:)/i.test(s)) return s;
  if (/^[/#]/.test(s) && !s.startsWith('//')) return s;
  if (/^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#][^\s]*)?$/i.test(s)) return `https://${s}`;
  return undefined;
}

/** A copy of `data` whose link fields are safe; a field that cannot be made safe is removed. */
export function cleanLinks(data) {
  const out = { ...data };
  for (const k of Object.keys(out)) {
    if (!URL_FIELDS.has(k)) continue;
    const v = safeUrl(out[k]);
    if (v === undefined) delete out[k];
    else out[k] = v;
  }
  return out;
}
