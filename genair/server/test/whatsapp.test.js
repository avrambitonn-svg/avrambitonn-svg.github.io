import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Inbox, buildSendPayload, extractEvents, inbox, normalizePhone, verifySignature } from '../src/whatsapp.js';
import { forbidFetch, jsonResponse, mockFetch, startServer, useIntegrationEnv } from './helpers.js';

test('normalizePhone: Israeli formats -> 972...', () => {
  assert.equal(normalizePhone('0541234567'), '972541234567');
  assert.equal(normalizePhone('054-123-4567'), '972541234567');
  assert.equal(normalizePhone('+972 54 123 4567'), '972541234567');
  assert.equal(normalizePhone('+972-054-1234567'), '972541234567');
  assert.equal(normalizePhone('00972541234567'), '972541234567');
  assert.equal(normalizePhone('972541234567'), '972541234567');
  assert.equal(normalizePhone('(03) 123-4567'), '97231234567');
  assert.equal(normalizePhone(541234567), '972541234567');
  assert.equal(normalizePhone('+1 415 555 2671'), '14155552671');
});

test('normalizePhone rejects junk', () => {
  for (const bad of ['', null, undefined, 'abc', '05412', '0541234567890', '+972 0', '05x1234567']) {
    assert.equal(normalizePhone(bad), null, String(bad));
  }
});

test('buildSendPayload: text and template', () => {
  assert.deepEqual(buildSendPayload({ to: '050-1234567', text: 'שלום' }), {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: '972501234567', type: 'text', text: { preview_url: false, body: 'שלום' },
  });
  assert.deepEqual(buildSendPayload({ to: '972501234567', template: { name: 'service_reminder', language: 'he', params: ['דני', '10:00'] } }), {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: '972501234567', type: 'template',
    template: {
      name: 'service_reminder',
      language: { code: 'he' },
      components: [{ type: 'body', parameters: [{ type: 'text', text: 'דני' }, { type: 'text', text: '10:00' }] }],
    },
  });
  const noParams = buildSendPayload({ to: '972501234567', template: { name: 'hello_world', language: 'en_US' } });
  assert.deepEqual(noParams.template, { name: 'hello_world', language: { code: 'en_US' } });
});

test('buildSendPayload validation', () => {
  const fields = (b) => {
    try {
      buildSendPayload(b);
    } catch (e) {
      assert.equal(e.code, 'validation_error');
      return e.details.fields.map((f) => f.field);
    }
    throw new Error('expected error');
  };
  assert.deepEqual(fields({ to: 'x', text: 'hi' }), ['to']);
  assert.deepEqual(fields({ to: '0501234567' }), ['text']);
  assert.deepEqual(fields({ to: '0501234567', text: 'a', template: { name: 'b' } }), ['text']);
  assert.deepEqual(fields({ to: '0501234567', template: { name: 'Bad Name', params: [{}] } }), ['template.name', 'template.params']);
});

test('POST /api/whatsapp/send calls the Graph API and returns the message id', async (t) => {
  useIntegrationEnv(t, { WHATSAPP_TOKEN: 'EAAtoken', WHATSAPP_PHONE_NUMBER_ID: '1234567890' });
  const calls = mockFetch(t, () => jsonResponse(200, { messaging_product: 'whatsapp', contacts: [{ input: '972501234567', wa_id: '972501234567' }], messages: [{ id: 'wamid.ABC' }] }));
  const s = await startServer(t);
  const r = await s.request('POST', '/api/whatsapp/send', { body: { to: '0501234567', text: 'הטכנאי בדרך' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { id: 'wamid.ABC' });
  assert.equal(calls[0].url, 'https://graph.facebook.com/v26.0/1234567890/messages');
  assert.equal(calls[0].init.headers.authorization, 'Bearer EAAtoken');
  assert.equal(JSON.parse(calls[0].init.body).to, '972501234567');
  assert.ok(!r.text.includes('EAAtoken'));
});

test('send: not configured -> 503', async (t) => {
  useIntegrationEnv(t);
  forbidFetch(t);
  const s = await startServer(t);
  const r = await s.request('POST', '/api/whatsapp/send', { body: { to: '0501234567', text: 'x' } });
  assert.equal(r.status, 503);
  assert.equal(r.json.error.code, 'whatsapp_not_configured');
});

test('send: 24h-window error -> 422 with Hebrew hint; graph version override', async (t) => {
  useIntegrationEnv(t, { WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: '1', WHATSAPP_GRAPH_VERSION: 'v25.0' });
  const calls = mockFetch(t, () => jsonResponse(400, { error: { message: 'Re-engagement message', code: 131047, fbtrace_id: 'x' } }));
  const s = await startServer(t);
  const r = await s.request('POST', '/api/whatsapp/send', { body: { to: '0501234567', text: 'x' } });
  assert.equal(r.status, 422);
  assert.equal(r.json.error.code, 'whatsapp_window_closed');
  assert.equal(r.json.error.details.code, 131047);
  assert.match(calls[0].url, /\/v25\.0\//);
});

test('webhook GET verification echoes hub.challenge only with the right token', async (t) => {
  useIntegrationEnv(t, { WHATSAPP_VERIFY_TOKEN: 'my-verify' });
  const s = await startServer(t);
  const ok = await s.request('GET', '/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=my-verify&hub.challenge=1158201444');
  assert.equal(ok.status, 200);
  assert.equal(ok.text, '1158201444');
  assert.match(ok.headers['content-type'], /text\/plain/);
  const bad = await s.request('GET', '/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1');
  assert.equal(bad.status, 403);
  process.env.WHATSAPP_VERIFY_TOKEN = '';
  const unset = await s.request('GET', '/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=&hub.challenge=1');
  assert.equal(unset.status, 503);
});

const SAMPLE = {
  object: 'whatsapp_business_account',
  entry: [{
    id: 'WABA',
    changes: [{
      field: 'messages',
      value: {
        messaging_product: 'whatsapp',
        metadata: { display_phone_number: '97230000000', phone_number_id: '1' },
        contacts: [{ profile: { name: 'יוסי' }, wa_id: '972541234567' }],
        messages: [
          { from: '972541234567', id: 'wamid.IN1', timestamp: '1760860800', type: 'text', text: { body: 'המזגן מטפטף' } },
          { from: '972541234567', id: 'wamid.IN2', timestamp: '1760860801', type: 'image', image: { caption: 'תמונה', id: 'm1' } },
        ],
        statuses: [{ id: 'wamid.OUT1', status: 'delivered', timestamp: '1760860802', recipient_id: '972501111111' }],
      },
    }],
  }],
};

test('extractEvents flattens messages and statuses', () => {
  assert.deepEqual(extractEvents(SAMPLE), [
    { id: 'wamid.IN1', from: '972541234567', text: 'המזגן מטפטף', at: '2025-10-19T08:00:00.000Z', type: 'text', name: 'יוסי' },
    { id: 'wamid.IN2', from: '972541234567', text: 'תמונה', at: '2025-10-19T08:00:01.000Z', type: 'image', name: 'יוסי' },
    { id: 'wamid.OUT1', from: '972501111111', text: '', at: '2025-10-19T08:00:02.000Z', type: 'status', status: 'delivered' },
  ]);
  assert.deepEqual(extractEvents({}), []);
});

test('verifySignature checks sha256 HMAC of the raw body', () => {
  const raw = Buffer.from(JSON.stringify(SAMPLE));
  const sig = `sha256=${createHmac('sha256', 'app-secret').update(raw).digest('hex')}`;
  assert.equal(verifySignature(raw, sig, 'app-secret'), true);
  assert.equal(verifySignature(raw, sig, 'other'), false);
  assert.equal(verifySignature(raw, undefined, 'app-secret'), false);
  assert.equal(verifySignature(Buffer.concat([raw, Buffer.from(' ')]), sig, 'app-secret'), false);
});

test('webhook POST: signature enforced when WHATSAPP_APP_SECRET is set; inbox polling with since/cursor', async (t) => {
  useIntegrationEnv(t, { WHATSAPP_APP_SECRET: 'app-secret' });
  inbox.clear();
  const s = await startServer(t);
  const raw = JSON.stringify(SAMPLE);
  const sig = `sha256=${createHmac('sha256', 'app-secret').update(raw).digest('hex')}`;

  const bad = await s.request('POST', '/api/whatsapp/webhook', { body: raw, headers: { 'x-hub-signature-256': 'sha256=deadbeef' } });
  assert.equal(bad.status, 401);
  assert.equal(bad.json.error.code, 'invalid_signature');
  const missing = await s.request('POST', '/api/whatsapp/webhook', { body: raw });
  assert.equal(missing.status, 401);

  const ok = await s.request('POST', '/api/whatsapp/webhook', { body: raw, headers: { 'x-hub-signature-256': sig } });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json, { ok: true, received: 3, added: 3 });
  // Meta retries: duplicates are ignored.
  const again = await s.request('POST', '/api/whatsapp/webhook', { body: raw, headers: { 'x-hub-signature-256': sig } });
  assert.equal(again.json.added, 0);

  const all = await s.request('GET', '/api/whatsapp/inbox');
  assert.equal(all.status, 200);
  assert.equal(all.json.items.length, 3);
  assert.deepEqual(Object.keys(all.json.items[0]).sort(), ['at', 'from', 'id', 'name', 'text', 'type']);
  assert.equal(all.json.items[2].status, 'delivered');
  assert.ok(all.json.cursor);

  const after = await s.request('GET', `/api/whatsapp/inbox?since=${encodeURIComponent(all.json.cursor)}`);
  assert.deepEqual(after.json.items, []);
  const old = await s.request('GET', '/api/whatsapp/inbox?since=2000-01-01T00:00:00Z');
  assert.equal(old.json.items.length, 3);
  const invalid = await s.request('GET', '/api/whatsapp/inbox?since=yesterday');
  assert.equal(invalid.status, 400);
  inbox.clear();
});

test('Inbox is a ring buffer of the last N unique events', () => {
  const box = new Inbox(500);
  for (let i = 0; i < 520; i++) box.add({ id: `m${i}`, from: '1', text: '', at: '', type: 'text' }, i);
  const items = box.since();
  assert.equal(items.length, 500);
  assert.equal(items[0].id, 'm20');
  assert.equal(items[499].id, 'm519');
  assert.equal(box.add({ id: 'm519', type: 'text' }), false);
  assert.equal(box.add({ id: 'm0', type: 'text' }), true, 'evicted keys can be re-added');
  assert.equal(box.since(518).length, 2);
});
