// HTTP plumbing shared by every route: errors, JSON, body parsing, CORS, auth.
import { createHash, timingSafeEqual } from 'node:crypto';

export const MAX_BODY_BYTES = 25 * 1024 * 1024;

export const CORS_ALLOW_HEADERS = 'content-type, x-app-token, anthropic-beta';
export const CORS_ALLOW_METHODS = 'GET, POST, OPTIONS';

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
