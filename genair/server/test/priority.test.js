// Priority mapping, payload builders and write guards. No network: every
// outbound call goes to a fetch mock, and write tests use a fake live URL
// (.invalid TLD) so nothing can ever reach the shared public sandbox.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCustomerPayload,
  buildOrderPayload,
  buildQuotePayload,
  extractPriorityMessage,
  mapCustomer,
  mapItem,
  mapPricelist,
} from '../src/priority.js';
import { priorityConfig } from '../src/config.js';
import { forbidFetch, jsonResponse, mockFetch, startServer, useIntegrationEnv } from './helpers.js';

const FAKE_LIVE = {
  PRIORITY_MODE: 'live',
  PRIORITY_URL: 'https://priority.example.invalid/odata/Priority/tabula.ini/genair/',
  PRIORITY_USER: 'apiuser',
  PRIORITY_PASSWORD: 'pw',
};
const FAKE_ROOT = 'https://priority.example.invalid/odata/Priority/tabula.ini/genair';

// ---------------------------------------------------------------- mapping

test('mapCustomer maps CUSTOMERS fields to app fields', () => {
  assert.deepEqual(
    mapCustomer({ CUSTNAME: 'C100', CUSTDES: 'יוסי כהן', PHONE: '0541234567', EMAIL: 'y@x.co.il', ADDRESS: 'הרצל 5', STATE: 'Naples, FL', STATEA: 'Naples', VATNUM: '512345678' }),
    { custname: 'C100', name: 'יוסי כהן', phone: '0541234567', email: 'y@x.co.il', address: 'הרצל 5', city: 'Naples', vatNum: '512345678' },
  );
  // Falls back to STATE when STATEA is empty; nulls become empty strings.
  assert.deepEqual(mapCustomer({ CUSTNAME: 'C1', CUSTDES: 'X', PHONE: null, STATE: 'חיפה', STATEA: null }), {
    custname: 'C1', name: 'X', phone: '', email: '', address: '', city: 'חיפה', vatNum: '',
  });
});

test('mapItem maps LOGPART fields', () => {
  assert.deepEqual(mapItem({ PARTNAME: 'AC-12', PARTDES: 'מזגן 1.5 כ"ס', BASEPLPRICE: 2490.5, BASEPLCODE: 'ש"ח', PUNITNAME: "יח'", UNITNAME: 'ea' }), {
    partname: 'AC-12', description: 'מזגן 1.5 כ"ס', price: 2490.5, currency: 'ש"ח', unit: "יח'",
  });
  assert.deepEqual(mapItem({ PARTNAME: 'P', PARTDES: 'd', BASEPLPRICE: null, BASEPLCODE: null, PUNITNAME: null, UNITNAME: 'ea' }), {
    partname: 'P', description: 'd', price: 0, currency: '', unit: 'ea',
  });
});

test('mapPricelist maps PRICELIST fields', () => {
  assert.deepEqual(mapPricelist({ PLNAME: 'Base', PLDES: 'Base Price List', CODE: '$', NAME: 'US Dollars' }), { code: 'Base', name: 'Base Price List', currency: '$' });
});

// ---------------------------------------------------------------- payload builders

test('buildCustomerPayload maps and trims, omits empty optional fields', () => {
  assert.deepEqual(buildCustomerPayload({ name: ' יוסי כהן ', phone: '054-1234567', email: 'y@x.co.il', address: '', city: 'תל אביב', vatNum: '512345678' }), {
    CUSTDES: 'יוסי כהן', PHONE: '054-1234567', EMAIL: 'y@x.co.il', STATE: 'תל אביב', VATNUM: '512345678',
  });
  assert.deepEqual(buildCustomerPayload({ name: 'A', phone: '1', custname: 'G-1' }), { CUSTNAME: 'G-1', CUSTDES: 'A', PHONE: '1' });
});

test('buildCustomerPayload rejects missing / too-long fields with field details', () => {
  assert.throws(() => buildCustomerPayload({}), (err) => {
    assert.equal(err.status, 400);
    assert.equal(err.code, 'validation_error');
    assert.deepEqual(err.details.fields.map((f) => f.field), ['name', 'phone']);
    return true;
  });
  assert.throws(() => buildCustomerPayload({ name: 'x'.repeat(49), phone: '1' }), (err) => err.details.fields[0].max === 48);
});

test('buildQuotePayload builds CPROF + CPROFITEMS_SUBFORM', () => {
  assert.deepEqual(
    buildQuotePayload({
      custname: 'C100',
      details: 'התקנת מזגן',
      lines: [
        { partname: 'AC-12', qty: 2, price: 2490, description: 'מזגן עילי' },
        { partname: 'INST', qty: '1', price: '350' },
      ],
    }),
    {
      CUSTNAME: 'C100',
      DETAILS: 'התקנת מזגן',
      CPROFITEMS_SUBFORM: [
        { PARTNAME: 'AC-12', TQUANT: 2, PRICE: 2490, PDES: 'מזגן עילי' },
        { PARTNAME: 'INST', TQUANT: 1, PRICE: 350 },
      ],
    },
  );
});

test('buildOrderPayload builds ORDERS + ORDERITEMS_SUBFORM with REFERENCE', () => {
  assert.deepEqual(buildOrderPayload({ custname: 'C100', reference: 'PO-77', lines: [{ partname: 'AC-12', qty: 1, price: 0 }] }), {
    CUSTNAME: 'C100',
    REFERENCE: 'PO-77',
    ORDERITEMS_SUBFORM: [{ PARTNAME: 'AC-12', TQUANT: 1, PRICE: 0 }],
  });
});

test('line validation: no lines, bad qty, negative price, long DETAILS', () => {
  const fields = (fn) => {
    try {
      fn();
    } catch (err) {
      return err.details.fields.map((f) => f.field);
    }
    throw new Error('expected validation error');
  };
  assert.deepEqual(fields(() => buildQuotePayload({ custname: 'C', lines: [] })), ['lines']);
  assert.deepEqual(fields(() => buildOrderPayload({ custname: 'C' })), ['lines']);
  assert.deepEqual(
    fields(() => buildQuotePayload({ custname: 'C', lines: [{ partname: '', qty: 0, price: -1 }, { partname: 'P', qty: 'x' }] })),
    ['lines[0].partname', 'lines[0].qty', 'lines[0].price', 'lines[1].qty'],
  );
  assert.deepEqual(fields(() => buildQuotePayload({ custname: 'C', details: 'x'.repeat(25), lines: [{ partname: 'P', qty: 1 }] })), ['details']);
  assert.deepEqual(fields(() => buildOrderPayload({ lines: [{ partname: 'P', qty: 1 }] })), ['custname']);
});

test('extractPriorityMessage handles OData and InterfaceErrors shapes', () => {
  assert.equal(extractPriorityMessage({ error: { code: '400', message: 'לא ניתן להפעיל API למסך זה.' } }), 'לא ניתן להפעיל API למסך זה.');
  assert.equal(extractPriorityMessage({ FORM: { '@TYPE': 'ORDERS', InterfaceErrors: { text: 'שורה 1- לקוח לא קיים' } } }), 'שורה 1- לקוח לא קיים');
  assert.equal(extractPriorityMessage({ FORM: { InterfaceErrors: [{ text: 'a' }, { text: 'b' }] } }), 'a | b');
  assert.equal(extractPriorityMessage('<html>oops</html>'), '<html>oops</html>');
  assert.equal(extractPriorityMessage(null), '');
});

// ---------------------------------------------------------------- config

test('priorityConfig: demo, live user/password, live PAT, off, invalid mode', () => {
  const demo = priorityConfig({});
  assert.equal(demo.mode, 'demo');
  assert.equal(demo.serviceRoot, 'https://t.eu.priority-connect.online/odata/Priority/tabbtd38.ini/usdemo');
  assert.equal(demo.user, 'apidemo');
  assert.equal(demo.allowWrite, false);
  const live = priorityConfig(FAKE_LIVE);
  assert.equal(live.serviceRoot, FAKE_ROOT);
  assert.equal(live.configured, true);
  const pat = priorityConfig({ PRIORITY_MODE: 'live', PRIORITY_URL: FAKE_ROOT, PRIORITY_PAT: 'TOKEN123' });
  assert.equal(pat.user, 'TOKEN123');
  assert.equal(pat.password, 'PAT');
  assert.equal(priorityConfig({ PRIORITY_MODE: 'live' }).configured, false);
  assert.equal(priorityConfig({ PRIORITY_MODE: 'off' }).mode, 'off');
  assert.equal(priorityConfig({ PRIORITY_MODE: 'bogus' }).mode, 'demo');
  assert.equal(priorityConfig({ PRIORITY_ALLOW_WRITE: 'true' }).allowWrite, true);
  assert.equal(priorityConfig({ PRIORITY_ALLOW_WRITE: 'false' }).allowWrite, false);
});

// ---------------------------------------------------------------- routes

test('writes are blocked (403) unless PRIORITY_ALLOW_WRITE=true, without any network call', async (t) => {
  useIntegrationEnv(t, { PRIORITY_MODE: 'demo' });
  const calls = forbidFetch(t);
  const s = await startServer(t);
  for (const path of ['/api/priority/customers', '/api/priority/quotes', '/api/priority/orders']) {
    const r = await s.request('POST', path, { body: { custname: 'C', name: 'n', phone: '1', lines: [{ partname: 'P', qty: 1 }] } });
    assert.equal(r.status, 403, path);
    assert.equal(r.json.error.code, 'priority_write_disabled');
    assert.match(r.json.error.message, /PRIORITY_ALLOW_WRITE/);
  }
  assert.equal(calls.length, 0);
});

test('the public demo company is never written to, even with PRIORITY_ALLOW_WRITE=true', async (t) => {
  useIntegrationEnv(t, { PRIORITY_MODE: 'demo', PRIORITY_ALLOW_WRITE: 'true' });
  const calls = forbidFetch(t);
  const s = await startServer(t);
  const r = await s.request('POST', '/api/priority/customers', { body: { name: 'n', phone: '1' } });
  assert.equal(r.status, 403);
  assert.equal(r.json.error.code, 'priority_demo_readonly');
  assert.equal(calls.length, 0);
});

test('dryRun validates and returns the payload even while writes are disabled', async (t) => {
  useIntegrationEnv(t, { PRIORITY_MODE: 'demo' });
  const calls = forbidFetch(t);
  const s = await startServer(t);
  const r = await s.request('POST', '/api/priority/orders?dryRun=1', { body: { custname: 'C1', lines: [{ partname: 'P', qty: 2, price: 10 }] } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { dryRun: true, form: 'ORDERS', payload: { CUSTNAME: 'C1', ORDERITEMS_SUBFORM: [{ PARTNAME: 'P', TQUANT: 2, PRICE: 10 }] } });
  const bad = await s.request('POST', '/api/priority/quotes?dryRun=1', { body: { lines: [] } });
  assert.equal(bad.status, 400);
  assert.equal(calls.length, 0);
});

test('POST /api/priority/quotes sends CPROF deep insert with auth headers and returns cprofnum', async (t) => {
  useIntegrationEnv(t, { ...FAKE_LIVE, PRIORITY_ALLOW_WRITE: 'true', PRIORITY_APP_ID: 'APP1', PRIORITY_APP_KEY: 'KEY1' });
  const calls = mockFetch(t, () => jsonResponse(201, { CPROFNUM: 'PQ26000099', CUSTNAME: 'C100' }));
  const s = await startServer(t);
  const r = await s.request('POST', '/api/priority/quotes', {
    body: { custname: 'C100', details: 'מזגן לסלון', lines: [{ partname: 'AC-12', qty: 1, price: 2490 }] },
  });
  assert.equal(r.status, 201);
  assert.deepEqual(r.json, { cprofnum: 'PQ26000099' });
  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.equal(url, `${FAKE_ROOT}/CPROF`);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.authorization, `Basic ${Buffer.from('apiuser:pw').toString('base64')}`);
  assert.equal(init.headers['x-app-id'], 'APP1');
  assert.equal(init.headers['x-app-key'], 'KEY1');
  assert.equal(init.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(init.body), {
    CUSTNAME: 'C100',
    DETAILS: 'מזגן לסלון',
    CPROFITEMS_SUBFORM: [{ PARTNAME: 'AC-12', TQUANT: 1, PRICE: 2490 }],
  });
});

test('POST customers / orders return custname / ordname; PAT auth', async (t) => {
  useIntegrationEnv(t, { PRIORITY_MODE: 'live', PRIORITY_URL: FAKE_ROOT, PRIORITY_PAT: 'MYPAT', PRIORITY_ALLOW_WRITE: 'true' });
  const calls = mockFetch(t, (url) =>
    url.endsWith('/CUSTOMERS') ? jsonResponse(201, { CUSTNAME: 'G-0001', CUSTDES: 'x' }) : jsonResponse(201, { ORDNAME: 'SO26000001' }),
  );
  const s = await startServer(t);
  const c = await s.request('POST', '/api/priority/customers', { body: { name: 'דני', phone: '0501111111', city: 'חולון' } });
  assert.equal(c.status, 201);
  assert.deepEqual(c.json, { custname: 'G-0001' });
  assert.deepEqual(JSON.parse(calls[0].init.body), { CUSTDES: 'דני', PHONE: '0501111111', STATE: 'חולון' });
  assert.equal(calls[0].init.headers.authorization, `Basic ${Buffer.from('MYPAT:PAT').toString('base64')}`);
  const o = await s.request('POST', '/api/priority/orders', { body: { custname: 'G-0001', reference: 'R1', lines: [{ partname: 'P', qty: 1, price: 5 }] } });
  assert.equal(o.status, 201);
  assert.deepEqual(o.json, { ordname: 'SO26000001' });
  assert.equal(calls[1].url, `${FAKE_ROOT}/ORDERS`);
});

test('Priority business errors surface as 502 with the Hebrew Priority message', async (t) => {
  useIntegrationEnv(t, { ...FAKE_LIVE, PRIORITY_ALLOW_WRITE: 'true' });
  mockFetch(t, () => jsonResponse(409, { FORM: { '@TYPE': 'ORDERS', InterfaceErrors: { text: 'שורה 1- לקוח לא קיים' } } }));
  const s = await startServer(t);
  const r = await s.request('POST', '/api/priority/orders', { body: { custname: 'NOPE', lines: [{ partname: 'P', qty: 1 }] } });
  assert.equal(r.status, 502);
  assert.equal(r.json.error.code, 'priority_rejected');
  assert.match(r.json.error.message, /לקוח לא קיים/);
  assert.equal(r.json.error.details.status, 409);
});

test('GET customers: builds $select/$filter/$top/$skip and maps rows', async (t) => {
  useIntegrationEnv(t, FAKE_LIVE);
  const calls = mockFetch(t, () => jsonResponse(200, { value: [{ CUSTNAME: 'C1', CUSTDES: 'Denver', PHONE: '03', EMAIL: null, ADDRESS: null, STATE: null, STATEA: null, VATNUM: null }] }));
  const s = await startServer(t);
  const r = await s.request('GET', `/api/priority/customers?search=${encodeURIComponent("o'b")}&top=10&skip=20`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { items: [{ custname: 'C1', name: 'Denver', phone: '03', email: '', address: '', city: '', vatNum: '' }], top: 10, skip: 20 });
  const u = new URL(calls[0].url);
  assert.equal(u.origin + u.pathname, `${FAKE_ROOT}/CUSTOMERS`);
  assert.equal(u.searchParams.get('$select'), 'CUSTNAME,CUSTDES,PHONE,EMAIL,ADDRESS,STATE,STATEA,VATNUM');
  assert.equal(u.searchParams.get('$top'), '10');
  assert.equal(u.searchParams.get('$skip'), '20');
  const filter = u.searchParams.get('$filter');
  assert.match(filter, /contains\(CUSTDES,'o''b'\)/);
  assert.match(filter, /contains\(PHONE,'o''b'\)/);
  assert.equal(calls[0].init.method, 'GET');
});

test('GET items / pricelists map rows', async (t) => {
  useIntegrationEnv(t, FAKE_LIVE);
  mockFetch(t, (url) =>
    url.includes('/LOGPART')
      ? jsonResponse(200, { value: [{ PARTNAME: 'AC', PARTDES: 'מזגן', BASEPLPRICE: 100, BASEPLCODE: 'שח', PUNITNAME: "יח'" }] })
      : jsonResponse(200, { value: [{ PLNAME: 'Base', PLDES: 'בסיס', CODE: 'שח' }] }),
  );
  const s = await startServer(t);
  const i = await s.request('GET', `/api/priority/items?search=${encodeURIComponent('מזגן')}`);
  assert.deepEqual(i.json, { items: [{ partname: 'AC', description: 'מזגן', price: 100, currency: 'שח', unit: "יח'" }], top: 50, skip: 0 });
  const p = await s.request('GET', '/api/priority/pricelists');
  assert.deepEqual(p.json, { items: [{ code: 'Base', name: 'בסיס', currency: 'שח' }] });
});

test('mode off -> 503 priority_off; live without credentials -> 503 priority_not_configured', async (t) => {
  useIntegrationEnv(t, { PRIORITY_MODE: 'off' });
  const calls = forbidFetch(t);
  const s = await startServer(t);
  const off = await s.request('GET', '/api/priority/customers');
  assert.equal(off.status, 503);
  assert.equal(off.json.error.code, 'priority_off');
  process.env.PRIORITY_MODE = 'live';
  const nc = await s.request('GET', '/api/priority/items');
  assert.equal(nc.status, 503);
  assert.equal(nc.json.error.code, 'priority_not_configured');
  const test2 = await s.request('GET', '/api/priority/test');
  assert.equal(test2.status, 503);
  assert.equal(test2.json.ok, false);
  assert.equal(test2.json.error.code, 'priority_not_configured');
  assert.equal(calls.length, 0);
});

test('GET /api/priority/test: ok:true with latency, ok:false on auth failure', async (t) => {
  useIntegrationEnv(t, FAKE_LIVE);
  let status = 200;
  mockFetch(t, () => (status === 200 ? jsonResponse(200, { value: [{ CUSTNAME: 'A' }, { CUSTNAME: 'B' }] }) : new Response('', { status })));
  const s = await startServer(t);
  const ok = await s.request('GET', '/api/priority/test');
  assert.equal(ok.status, 200);
  assert.equal(ok.json.ok, true);
  assert.equal(ok.json.mode, 'live');
  assert.equal(ok.json.serviceRoot, FAKE_ROOT);
  assert.deepEqual(ok.json.sample, { customers: 2 });
  assert.equal(typeof ok.json.latencyMs, 'number');
  status = 401;
  const bad = await s.request('GET', '/api/priority/test');
  assert.equal(bad.status, 502);
  assert.equal(bad.json.ok, false);
  assert.equal(bad.json.error.code, 'priority_auth_failed');
  assert.ok(!bad.text.includes('pw'), 'password must not leak');
});
