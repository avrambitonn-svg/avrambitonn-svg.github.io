// Test helpers: a real HTTP server around the handler, a node:http client (so
// stubbing globalThis.fetch for outbound calls never affects test requests),
// env isolation and a recording fetch mock.
import http from 'node:http';
import { handler } from '../src/app.js';
import { resetStores } from '../src/db/index.js';
import { resetLoginLimits } from '../src/auth.js';
import { resetPortalLimits } from '../src/portal.js';

const ENV_KEYS = [
  'ALLOWED_ORIGINS', 'APP_TOKEN',
  'PRIORITY_MODE', 'PRIORITY_URL', 'PRIORITY_USER', 'PRIORITY_PASSWORD', 'PRIORITY_PAT', 'PRIORITY_APP_ID', 'PRIORITY_APP_KEY', 'PRIORITY_ALLOW_WRITE',
  'ANTHROPIC_API_KEY', 'AI_ALLOWED_MODELS', 'AI_ALLOWED_BETAS', 'AI_TIMEOUT_MS',
  'WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_GRAPH_VERSION', 'WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_APP_SECRET',
  'GOOGLE_SERVICE_ACCOUNT_JSON', 'GOOGLE_CALENDAR_ID', 'GOOGLE_DRIVE_PARENT_ID', 'GOOGLE_SUBJECT', 'GOOGLE_DRIVE_SCOPE',
  'DB_MODE', 'DATA_DIR', 'DB_FLUSH_MS', 'AUTH_SECRET', 'AUTH_TTL_HOURS', 'BOOTSTRAP_TOKEN', 'FILES_MAX_MB', 'TRUST_PROXY', 'VERCEL',
];

/** Clears all server env vars, applies `vars`, and restores everything after the test. */
export function useEnv(t, vars = {}) {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  // Never let a unit test point at the shared public sandbox by accident.
  process.env.PRIORITY_MODE = 'off';
  // A fresh in-memory database per test (never ./data).
  process.env.DB_MODE = 'memory';
  resetStores();
  resetLoginLimits();
  resetPortalLimits();
  Object.assign(process.env, vars);
  t.after(() => {
    resetStores();
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
}

/** Replaces globalThis.fetch for the duration of the test. `impl(url, init, n)` returns a Response. */
export function mockFetch(t, impl) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return impl(String(url), init, calls.length);
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  return calls;
}

/** A fetch mock that fails the test if anything tries to reach the network. */
export function forbidFetch(t) {
  return mockFetch(t, (url) => {
    throw new Error(`unexpected network call to ${url}`);
  });
}

export const jsonResponse = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

export async function startServer(t) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  t.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections(); // SSE and long-poll requests stay open otherwise
  }));
  return {
    port,
    request: (method, path, opts) => request(port, method, path, opts),
  };
}

export function request(port, method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    let payload;
    const h = { ...headers };
    if (body !== undefined) {
      payload = Buffer.isBuffer(body) || typeof body === 'string' ? body : JSON.stringify(body);
      if (!Object.keys(h).some((k) => k.toLowerCase() === 'content-type')) h['content-type'] = 'application/json';
    }
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: h }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          json = undefined;
        }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}
