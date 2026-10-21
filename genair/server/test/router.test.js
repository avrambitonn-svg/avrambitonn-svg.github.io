import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { TEST_APP_TOKEN, forbidFetch, startServer, useEnv, useIntegrationEnv } from './helpers.js';
import { safeEqual } from '../src/http.js';

test('GET /api/health: anyone sees ok + setup state; version and features only with a session or the app token', async (t) => {
  useIntegrationEnv(t, { PRIORITY_MODE: 'demo' });
  forbidFetch(t);
  const s = await startServer(t);
  const anon = await s.request('GET', '/api/health', { anonymous: true });
  assert.equal(anon.status, 200);
  assert.deepEqual(anon.json, { ok: true, db: { mode: 'off' } });
});

test('GET /api/health reports version and features to a trusted caller', async (t) => {
  useIntegrationEnv(t, { PRIORITY_MODE: 'demo' });
  forbidFetch(t);
  const s = await startServer(t);
  const r = await s.request('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.match(r.json.version, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(r.json.features, {
    priority: 'demo',
    priorityWrite: false,
    prioritySync: false,
    ai: false,
    whatsapp: false,
    google: { calendar: false, drive: false },
  });
});

test('health: live mode without credentials reports priority off; flags follow env', async (t) => {
  useIntegrationEnv(t, {
    PRIORITY_MODE: 'live',
    PRIORITY_ALLOW_WRITE: 'true',
    ANTHROPIC_API_KEY: 'sk-test',
    WHATSAPP_TOKEN: 'x',
    WHATSAPP_PHONE_NUMBER_ID: '123',
  });
  const s = await startServer(t);
  const r = await s.request('GET', '/api/health');
  assert.equal(r.json.features.priority, 'off');
  assert.equal(r.json.features.priorityWrite, false);
  assert.equal(r.json.features.ai, true);
  assert.equal(r.json.features.whatsapp, true);
  assert.ok(!r.text.includes('sk-test'), 'secrets must never be returned');
});

test('unknown path -> 404 JSON error; wrong method -> 405 with Allow', async (t) => {
  useEnv(t);
  const s = await startServer(t);
  const a = await s.request('GET', '/api/nope');
  assert.equal(a.status, 404);
  assert.equal(a.json.error.code, 'not_found');
  assert.equal(typeof a.json.error.message, 'string');
  const b = await s.request('DELETE', '/api/health');
  assert.equal(b.status, 405);
  assert.equal(b.json.error.code, 'method_not_allowed');
  assert.equal(b.headers.allow, 'GET');
});

test('trailing slash is tolerated', async (t) => {
  useEnv(t);
  const s = await startServer(t);
  assert.equal((await s.request('GET', '/api/health/')).status, 200);
});

test('CORS preflight from an allowed origin', async (t) => {
  useEnv(t); // default origins: localhost:5173, localhost:4173
  const s = await startServer(t);
  const r = await s.request('OPTIONS', '/api/priority/customers', {
    headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-app-token' },
  });
  assert.equal(r.status, 204);
  assert.equal(r.headers['access-control-allow-origin'], 'http://localhost:5173');
  assert.match(r.headers['access-control-allow-headers'], /content-type/);
  assert.match(r.headers['access-control-allow-headers'], /x-app-token/);
  assert.match(r.headers['access-control-allow-headers'], /anthropic-beta/);
  assert.match(r.headers['access-control-allow-methods'], /POST/);
  assert.match(r.headers.vary, /Origin/);
});

test('CORS: disallowed origin gets 403 and no allow-origin header', async (t) => {
  useEnv(t, { ALLOWED_ORIGINS: 'https://app.genair.co.il' });
  const s = await startServer(t);
  const pre = await s.request('OPTIONS', '/api/health', { headers: { origin: 'https://evil.example' } });
  assert.equal(pre.status, 403);
  assert.equal(pre.headers['access-control-allow-origin'], undefined);
  const get = await s.request('GET', '/api/health', { headers: { origin: 'https://evil.example' } });
  assert.equal(get.status, 403);
  assert.equal(get.json.error.code, 'origin_not_allowed');
  const ok = await s.request('GET', '/api/health', { headers: { origin: 'https://app.genair.co.il' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['access-control-allow-origin'], 'https://app.genair.co.il');
});

test('CORS: wildcard, same-host origin and no-origin requests', async (t) => {
  useEnv(t, { ALLOWED_ORIGINS: '*' });
  const s = await startServer(t);
  const r = await s.request('GET', '/api/health', { headers: { origin: 'https://anything.example' } });
  assert.equal(r.status, 200);
  assert.equal(r.headers['access-control-allow-origin'], '*');

  process.env.ALLOWED_ORIGINS = 'https://other.example';
  const same = await s.request('GET', '/api/health', { headers: { origin: `http://127.0.0.1:${s.port}` } });
  assert.equal(same.status, 200, 'same-origin requests are allowed');
  const none = await s.request('GET', '/api/health');
  assert.equal(none.status, 200, 'server-to-server (no Origin) is allowed');
});

test('APP_TOKEN (integration-only server): required everywhere except health and the WhatsApp webhook', async (t) => {
  useEnv(t, { DB_MODE: 'off', APP_TOKEN: 's3cret-token', WHATSAPP_VERIFY_TOKEN: 'vt', WHATSAPP_ALLOW_UNSIGNED: 'true' });
  const s = await startServer(t);
  const noToken = await s.request('GET', '/api/whatsapp/inbox');
  assert.equal(noToken.status, 401);
  assert.equal(noToken.json.error.code, 'unauthorized');
  const wrong = await s.request('GET', '/api/whatsapp/inbox', { headers: { 'x-app-token': 's3cret-tokeX' } });
  assert.equal(wrong.status, 401);
  const right = await s.request('GET', '/api/whatsapp/inbox', { headers: { 'x-app-token': 's3cret-token' } });
  assert.equal(right.status, 200);
  assert.equal((await s.request('GET', '/api/health')).status, 200);
  const hook = await s.request('GET', '/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=42');
  assert.equal(hook.status, 200);
  assert.equal(hook.text, '42');
  const hookPost = await s.request('POST', '/api/whatsapp/webhook', { body: { entry: [] } });
  assert.equal(hookPost.status, 200);
  // Preflight never carries custom headers, so it must not require the token.
  const pre = await s.request('OPTIONS', '/api/whatsapp/inbox', { headers: { origin: 'http://localhost:5173' } });
  assert.equal(pre.status, 204);
});

test('safeEqual compares in constant time and handles different lengths', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual('', 'x'), false);
});

test('invalid JSON body -> 400 invalid_json', async (t) => {
  useIntegrationEnv(t, { WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: '1' });
  forbidFetch(t);
  const s = await startServer(t);
  const r = await s.request('POST', '/api/whatsapp/send', { body: '{not json', headers: { 'content-type': 'application/json' } });
  assert.equal(r.status, 400);
  assert.equal(r.json.error.code, 'invalid_json');
});

test('body over 25 MB -> 413 (declared Content-Length)', async (t) => {
  useIntegrationEnv(t, { ANTHROPIC_API_KEY: 'k' });
  forbidFetch(t);
  const s = await startServer(t);
  const r = await new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: s.port, method: 'POST', path: '/api/ai/messages', headers: { 'content-type': 'application/json', 'x-app-token': TEST_APP_TOKEN, 'content-length': String(26 * 1024 * 1024) } },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(text) }));
      },
    );
    req.on('error', reject);
    req.write('{"model":"x"');
  });
  assert.equal(r.status, 413);
  assert.equal(r.json.error.code, 'payload_too_large');
});

test('body over 25 MB -> 413 (chunked, no Content-Length)', async (t) => {
  useIntegrationEnv(t, { ANTHROPIC_API_KEY: 'k' });
  forbidFetch(t);
  const s = await startServer(t);
  const r = await new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: s.port, method: 'POST', path: '/api/ai/messages', headers: { 'content-type': 'application/json', 'x-app-token': TEST_APP_TOKEN, 'transfer-encoding': 'chunked' } },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(text) }));
      },
    );
    req.on('error', (e) => (e.code === 'ECONNRESET' || e.code === 'EPIPE' ? null : reject(e)));
    const chunk = Buffer.alloc(1024 * 1024, 0x61);
    for (let i = 0; i < 27; i++) req.write(chunk);
    req.end();
  });
  assert.equal(r.status, 413);
});

test('readBody works when a platform already consumed the stream (Vercel helpers)', async () => {
  const { readBody } = await import('../src/http.js');
  const parsed = { readableEnded: true, headers: {}, get body() { return { a: 1 }; } };
  assert.equal((await readBody(parsed)).toString(), '{"a":1}');
  const rawBuf = { readableEnded: true, headers: {}, body: Buffer.from('{"b":2}') };
  assert.equal((await readBody(rawBuf)).toString(), '{"b":2}');
  const broken = { readableEnded: true, headers: {}, get body() { throw new Error('Invalid JSON'); } };
  await assert.rejects(readBody(broken), { status: 400, code: 'invalid_json' });
  const gcf = { rawBody: Buffer.from('xyz'), headers: {} };
  assert.equal((await readBody(gcf)).toString(), 'xyz');
});
