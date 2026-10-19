// READ-ONLY checks against Priority's public sandbox, through the real handler.
// Runs only with RUN_LIVE=1 (needs outbound HTTPS):  npm run test:live
// The sandbox is shared by everyone: this file must never send POST/PATCH/DELETE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, useEnv } from './helpers.js';

const live = process.env.RUN_LIVE === '1';
const opts = { skip: live ? false : 'set RUN_LIVE=1 to run against the Priority sandbox', timeout: 90_000 };

// Writes forced off: the 403 guard fires before any network call.
const DEMO = { PRIORITY_MODE: 'demo', PRIORITY_ALLOW_WRITE: 'false' };

test('live: /api/priority/test reaches the sandbox', opts, async (t) => {
  useEnv(t, DEMO);
  const s = await startServer(t);
  const r = await s.request('GET', '/api/priority/test');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.mode, 'demo');
  assert.match(r.json.serviceRoot, /priority-connect\.online/);
  assert.ok(r.json.sample.customers > 0);
  assert.ok(r.json.latencyMs >= 0);
});

test('live: customers list, paging and search', opts, async (t) => {
  useEnv(t, DEMO);
  const s = await startServer(t);
  const r = await s.request('GET', '/api/priority/customers?top=3');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.items.length, 3);
  assert.equal(r.json.top, 3);
  for (const c of r.json.items) {
    assert.deepEqual(Object.keys(c), ['custname', 'name', 'phone', 'email', 'address', 'city', 'vatNum']);
    assert.ok(c.custname);
  }
  const page2 = await s.request('GET', '/api/priority/customers?top=3&skip=3');
  assert.notEqual(page2.json.items[0].custname, r.json.items[0].custname);

  // Case-insensitive-ish search (lowercase input finds "Denver ...").
  const q = await s.request('GET', '/api/priority/customers?top=5&search=denver');
  assert.equal(q.status, 200, q.text);
  assert.ok(q.json.items.length > 0);
  assert.ok(q.json.items.every((c) => /denver/i.test(c.name) || /denver/i.test(c.phone) || /denver/i.test(c.custname)));

  // Hebrew + quote escaping go through without OData errors.
  const heb = await s.request('GET', `/api/priority/customers?top=3&search=${encodeURIComponent('בדיקה')}`);
  assert.equal(heb.status, 200, heb.text);
  const quote = await s.request('GET', `/api/priority/customers?top=3&search=${encodeURIComponent("O'B")}`);
  assert.equal(quote.status, 200, quote.text);

  // Phone search.
  const phone = await s.request('GET', '/api/priority/customers?top=3&search=0546');
  assert.equal(phone.status, 200, phone.text);
  assert.ok(phone.json.items.some((c) => c.phone.includes('0546')));
});

test('live: items and pricelists', opts, async (t) => {
  useEnv(t, DEMO);
  const s = await startServer(t);
  const items = await s.request('GET', '/api/priority/items?top=5');
  assert.equal(items.status, 200, items.text);
  assert.equal(items.json.items.length, 5);
  for (const i of items.json.items) {
    assert.deepEqual(Object.keys(i), ['partname', 'description', 'price', 'currency', 'unit']);
    assert.equal(typeof i.price, 'number');
  }
  const search = await s.request('GET', '/api/priority/items?top=3&search=laptop');
  assert.equal(search.status, 200, search.text);

  const pl = await s.request('GET', '/api/priority/pricelists');
  assert.equal(pl.status, 200, pl.text);
  assert.ok(pl.json.items.length > 0);
  assert.deepEqual(Object.keys(pl.json.items[0]), ['code', 'name', 'currency']);
});

test('live: writes stay blocked in demo mode (no request is sent)', opts, async (t) => {
  useEnv(t, DEMO);
  const s = await startServer(t);
  const r = await s.request('POST', '/api/priority/customers', { body: {} });
  assert.equal(r.status, 403);
  assert.equal(r.json.error.code, 'priority_write_disabled');
});
