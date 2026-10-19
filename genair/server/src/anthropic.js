// Thin proxy to the Anthropic Messages API: the browser builds the request,
// the server only adds the API key and enforces model / beta allowlists.
import { Readable } from 'node:stream';
import { HttpError, fetchUpstream, parseJson, readBody } from './http.js';

const SERVICE = { code: 'ai', label: 'שירות ה-AI', to: 'לשירות ה-AI' };
export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';

/** Returns the beta header to forward (or undefined); throws if any value is not allow-listed. */
export function checkBetaHeader(header, allowed) {
  if (header === undefined || header === null || String(header).trim() === '') return undefined;
  const values = String(header).split(',').map((v) => v.trim()).filter(Boolean);
  const rejected = values.filter((v) => !allowed.includes(v));
  if (rejected.length) {
    throw new HttpError(400, 'beta_not_allowed', 'ערך anthropic-beta אינו מורשה בשרת', { rejected, allowed });
  }
  return values.join(',');
}

export function checkModel(model, allowed) {
  if (allowed.includes('*')) return;
  if (typeof model !== 'string' || !allowed.includes(model)) {
    throw new HttpError(400, 'model_not_allowed', 'המודל המבוקש אינו מורשה בשרת', { model: model ?? null, allowed });
  }
}

export async function aiMessages({ req, res, cfg }) {
  const ai = cfg.ai;
  if (!ai.apiKey) throw new HttpError(503, 'ai_not_configured', 'שירות ה-AI לא הוגדר בשרת (חסר ANTHROPIC_API_KEY)');

  const raw = await readBody(req);
  const body = parseJson(raw);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'invalid_json', 'גוף הבקשה חייב להיות אובייקט JSON');
  }
  checkModel(body.model, ai.allowedModels);
  const beta = checkBetaHeader(req.headers['anthropic-beta'], ai.allowedBetas);

  const headers = {
    'x-api-key': ai.apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
    'content-type': 'application/json',
  };
  if (beta) headers['anthropic-beta'] = beta;

  // Forward the original bytes unchanged.
  const upstream = await fetchUpstream(ANTHROPIC_URL, { method: 'POST', headers, body: raw }, { timeoutMs: ai.timeoutMs, service: SERVICE });

  const passHeaders = { 'cache-control': 'no-store' };
  for (const name of ['content-type', 'request-id', 'retry-after']) {
    const value = upstream.headers.get(name);
    if (value) passHeaders[name] = value;
  }
  passHeaders['content-type'] ??= 'application/json';

  res.writeHead(upstream.status, passHeaders);
  if (!upstream.body) {
    res.end();
    return;
  }
  // Streams SSE (stream: true) as it arrives; plain JSON is piped through as-is.
  await new Promise((resolve) => {
    const stream = Readable.fromWeb(upstream.body);
    stream.on('error', () => { res.destroy(); resolve(); });
    res.on('close', () => { stream.destroy(); resolve(); });
    stream.pipe(res);
  });
}
