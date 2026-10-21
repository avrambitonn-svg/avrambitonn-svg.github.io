import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBetaHeader, checkModel } from '../src/anthropic.js';
import { forbidFetch, jsonResponse, mockFetch, startServer, useIntegrationEnv } from './helpers.js';

const BODY = { model: 'claude-opus-5-5', max_tokens: 1024, messages: [{ role: 'user', content: 'שלום' }] };

test('checkBetaHeader / checkModel', () => {
  const allowed = ['server-side-fallback-2026-07-01'];
  assert.equal(checkBetaHeader(undefined, allowed), undefined);
  assert.equal(checkBetaHeader('server-side-fallback-2026-07-01', allowed), 'server-side-fallback-2026-07-01');
  assert.equal(checkBetaHeader(' server-side-fallback-2026-07-01 , server-side-fallback-2026-07-01', allowed), 'server-side-fallback-2026-07-01,server-side-fallback-2026-07-01');
  assert.throws(() => checkBetaHeader('server-side-fallback-2026-07-01,files-api-2025-04-14', allowed), (e) => e.code === 'beta_not_allowed' && e.details.rejected[0] === 'files-api-2025-04-14');
  assert.doesNotThrow(() => checkModel('claude-haiku-5-5', ['claude-haiku-5-5']));
  assert.throws(() => checkModel('claude-x', ['claude-haiku-5-5']), { code: 'model_not_allowed' });
  assert.throws(() => checkModel(undefined, ['claude-haiku-5-5']), { code: 'model_not_allowed' });
  assert.doesNotThrow(() => checkModel('anything', ['*']));
});

test('no ANTHROPIC_API_KEY -> 503 ai_not_configured', async (t) => {
  useIntegrationEnv(t);
  forbidFetch(t);
  const s = await startServer(t);
  const r = await s.request('POST', '/api/ai/messages', { body: BODY });
  assert.equal(r.status, 503);
  assert.equal(r.json.error.code, 'ai_not_configured');
});

test('forwards the body unchanged with key/version headers and allowed beta', async (t) => {
  useIntegrationEnv(t, { ANTHROPIC_API_KEY: 'sk-ant-test-key' });
  const upstream = { id: 'msg_1', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'שלום!' }], stop_reason: 'end_turn' };
  const calls = mockFetch(t, () => jsonResponse(200, upstream, { 'request-id': 'req_123' }));
  const s = await startServer(t);
  const raw = `{"model":"claude-opus-5-5",  "max_tokens":1024,"messages":[{"role":"user","content":"שלום"}],"fallbacks":"default"}`;
  const r = await s.request('POST', '/api/ai/messages', { body: raw, headers: { 'anthropic-beta': 'server-side-fallback-2026-07-01' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, upstream);
  assert.equal(r.headers['request-id'], 'req_123');
  assert.ok(!r.text.includes('sk-ant-test-key'));
  const { url, init } = calls[0];
  assert.equal(url, 'https://api.anthropic.com/v1/messages');
  assert.equal(init.headers['x-api-key'], 'sk-ant-test-key');
  assert.equal(init.headers['anthropic-version'], '2023-06-01');
  assert.equal(init.headers['content-type'], 'application/json');
  assert.equal(init.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.equal(Buffer.from(init.body).toString('utf8'), raw, 'bytes are forwarded unchanged');
});

test('no beta header from client -> none upstream', async (t) => {
  useIntegrationEnv(t, { ANTHROPIC_API_KEY: 'k' });
  const calls = mockFetch(t, () => jsonResponse(200, { ok: 1 }));
  const s = await startServer(t);
  await s.request('POST', '/api/ai/messages', { body: BODY });
  assert.equal(calls[0].init.headers['anthropic-beta'], undefined);
});

test('rejects disallowed beta values and models before calling upstream', async (t) => {
  useIntegrationEnv(t, { ANTHROPIC_API_KEY: 'k', AI_ALLOWED_MODELS: 'claude-haiku-5-5' });
  const calls = forbidFetch(t);
  const s = await startServer(t);
  const beta = await s.request('POST', '/api/ai/messages', { body: { ...BODY, model: 'claude-haiku-5-5' }, headers: { 'anthropic-beta': 'computer-use-2025-01-24' } });
  assert.equal(beta.status, 400);
  assert.equal(beta.json.error.code, 'beta_not_allowed');
  const model = await s.request('POST', '/api/ai/messages', { body: BODY });
  assert.equal(model.status, 400);
  assert.equal(model.json.error.code, 'model_not_allowed');
  assert.deepEqual(model.json.error.details.allowed, ['claude-haiku-5-5']);
  assert.equal(calls.length, 0);
});

test('upstream error status and body are returned as-is', async (t) => {
  useIntegrationEnv(t, { ANTHROPIC_API_KEY: 'k' });
  const err = { type: 'error', error: { type: 'rate_limit_error', message: 'Rate limited' } };
  mockFetch(t, () => jsonResponse(429, err, { 'retry-after': '7' }));
  const s = await startServer(t);
  const r = await s.request('POST', '/api/ai/messages', { body: BODY });
  assert.equal(r.status, 429);
  assert.deepEqual(r.json, err);
  assert.equal(r.headers['retry-after'], '7');
});

test('streaming responses (SSE) are piped through', async (t) => {
  useIntegrationEnv(t, { ANTHROPIC_API_KEY: 'k' });
  const sse = 'event: message_start\ndata: {"type":"message_start"}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n';
  mockFetch(t, () => new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
  const s = await startServer(t);
  const r = await s.request('POST', '/api/ai/messages', { body: { ...BODY, stream: true } });
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /text\/event-stream/);
  assert.equal(r.text, sse);
});

test('network failure -> 502 ai_unreachable', async (t) => {
  useIntegrationEnv(t, { ANTHROPIC_API_KEY: 'k' });
  mockFetch(t, () => {
    throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
  });
  const s = await startServer(t);
  const r = await s.request('POST', '/api/ai/messages', { body: BODY });
  assert.equal(r.status, 502);
  assert.equal(r.json.error.code, 'ai_unreachable');
});
