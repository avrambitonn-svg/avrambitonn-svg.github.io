// What each role may read and write, and the limits that protect the server and Priority.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forbidFetch, startServer, useEnv } from './helpers.js';
import { ADMIN_PASSWORD, bearer, bootstrapOrg, loginAs } from './fixtures.js';
import { JsonFileAdapter } from '../src/db/adapters.js';
import { issueToken, readSession } from '../src/auth.js';
import { DocStore } from '../src/db/store.js';
import { loadConfig } from '../src/config.js';

async function org(t, env = {}) {
  useEnv(t, env);
  forbidFetch(t);
  const s = await startServer(t);
  const { token: admin } = await bootstrapOrg(s);
  const agent = await loginAs(s, admin, 'u-agent1', '0502201102');
  const installer = await loginAs(s, admin, 'u-inst1', '0502201105');
  const ops = (token, list) => s.request('POST', '/api/db/ops', { headers: bearer(token), body: { ops: list.map((o) => ({ at: Date.now(), ...o })) } });
  const snap = async (token) => (await s.request('GET', '/api/db/snapshot', { headers: bearer(token) })).json;
  return { s, admin, agent, installer, ops, snap };
}

test('read scope: money, costs, balances and the engine state stay with the managers', async (t) => {
  const { admin, agent, installer, ops, snap } = await org(t);
  await ops(admin, [
    { op: 'upsert', collection: 'money', id: 'mn1', data: { caseId: 'k1', kind: 'payment', amount: 1000 } },
    { op: 'upsert', collection: 'money', id: 'mn2', data: { caseId: 'k1', kind: 'commission', amount: 300, agentId: 'u-agent1' } },
    { op: 'upsert', collection: 'catalog', id: 'i1', data: { name: 'מזגן', price: 3000, cost: 1800, unit: 'יח׳' } },
    { op: 'upsert', collection: 'suppliers', id: 's1', data: { name: 'ספק', active: true } },
    { op: 'patch', collection: 'customers', id: 'c1', data: { balance: { amount: 500 }, idNumber: '123456789', sync: { status: 'error', error: 'Priority: internal detail' } } },
    { op: 'patch', collection: 'quotes', id: 'q1', data: { status: 'approved' } },
  ]);
  const a = await snap(admin);
  assert.equal(a.collections.money.length, 2);
  assert.equal(a.collections.catalog[0].cost, 1800);

  const g = await snap(agent);
  assert.deepEqual(g.collections.money.map((m) => m.id), ['mn2'], 'an agent sees only their own commission');
  assert.equal(g.collections.catalog[0].cost, undefined);
  const c1 = g.collections.customers.find((c) => c.id === 'c1');
  assert.equal(c1.balance, undefined);
  assert.equal(c1.idNumber, '123456789');
  assert.doesNotMatch(c1.sync.error, /internal detail/);
  assert.equal(c1.sync.status, 'error');
  assert.equal(g.collections.suppliers.length, 1);

  const i = await snap(installer);
  assert.deepEqual(i.collections.money, []);
  assert.deepEqual(i.collections.suppliers, [], 'hidden collections arrive empty');
  assert.equal(i.collections.customers.find((c) => c.id === 'c1').idNumber, undefined);
  assert.deepEqual(i.collections.quotes.map((q) => q.id), ['q1'], 'only approved quotes');
  const q = i.collections.quotes[0];
  assert.equal(q.lines[0].unitPrice, 0);
  assert.equal(q.lines[0].description, 'מזגן 1.5 כ״ס');
  assert.equal(q.discountPct, undefined);
  assert.equal(q.lines[0].aiReason, undefined);
});

test('read scope applies to fetch and to the change feed too', async (t) => {
  const { s, admin, installer, ops } = await org(t);
  const before = (await s.request('GET', '/api/db/changes?since=0&wait=0', { headers: bearer(installer) })).json.seq;
  await ops(admin, [{ op: 'upsert', collection: 'money', id: 'mn9', data: { caseId: 'k1', kind: 'payment', amount: 77 } }]);
  const ch = (await s.request('GET', `/api/db/changes?since=${before}&wait=0`, { headers: bearer(installer) })).json;
  const m = ch.changes.find((x) => x.id === 'mn9');
  assert.equal(m.del, true, 'goes out as deleted, without data');
  assert.equal(m.data, undefined);
  const f = await s.request('POST', '/api/db/fetch', { headers: bearer(installer), body: { items: [{ c: 'money', id: 'mn9' }] } });
  assert.equal(f.json.items[0].data, undefined);
});

test('installer: stock moves only to or from their own van, no deletes of what Priority holds', async (t) => {
  const { installer, ops } = await org(t);
  const van = 'רכב — סאמר חלבי';
  const r = await ops(installer, [
    { op: 'upsert', collection: 'stockMoves', id: 'sm1', data: { kind: 'use', itemId: 'i1', qty: 2, from: van, at: new Date().toISOString(), userId: 'u-inst1' } },
    { op: 'upsert', collection: 'stockMoves', id: 'sm2', data: { kind: 'transfer', itemId: 'i1', qty: 50, from: 'מחסן ראשי', to: 'רכב — יעקב דהן', at: new Date().toISOString() } },
    { op: 'upsert', collection: 'stockMoves', id: 'sm3', data: { kind: 'use', itemId: 'i1', qty: 99999, from: van, at: new Date().toISOString() } },
    { op: 'upsert', collection: 'stockMoves', id: 'sm4', data: { kind: 'receive', itemId: 'i1', qty: 1, to: van, at: new Date().toISOString() } },
    { op: 'remove', collection: 'units', id: 'un1' },
  ]);
  assert.deepEqual(r.json.results.map((x) => x.status), ['ok', 'denied', 'denied', 'denied', 'denied']);
});

test('non-managers: the activity log is append-only; chat, notifications and leaves are narrowed', async (t) => {
  const { admin, agent, ops, snap } = await org(t);
  await ops(admin, [
    { op: 'upsert', collection: 'activities', id: 'a1', data: { kind: 'note', text: 'מקור', at: new Date().toISOString() } },
    { op: 'upsert', collection: 'chat', id: 'ch1', data: { threadId: 'case:k1', fromId: 'u-admin', body: 'שלום', at: new Date().toISOString(), readBy: ['u-admin'] } },
    { op: 'upsert', collection: 'leaves', id: 'lv1', data: { userId: 'u-agent1', type: 'vacation', from: '2026-11-01', to: '2026-11-02', status: 'approved', createdAt: new Date().toISOString() } },
  ]);
  const r = await ops(agent, [
    { op: 'upsert', collection: 'activities', id: 'a2', data: { kind: 'note', text: 'חדש', at: new Date().toISOString() } },
    { op: 'patch', collection: 'activities', id: 'a1', data: { text: 'שוכתב' } },
    { op: 'patch', collection: 'chat', id: 'ch1', data: { readBy: ['u-admin', 'u-agent1'] } },
    { op: 'patch', collection: 'chat', id: 'ch1', data: { body: 'זויף' } },
    { op: 'upsert', collection: 'chat', id: 'ch2', data: { threadId: 'case:k1', fromId: 'u-admin', body: 'בשם אחר', at: new Date().toISOString(), readBy: [] } },
    { op: 'upsert', collection: 'notifications', id: 'n9', data: { userId: 'u-admin', text: 'x'.repeat(301), link: '/cases/k1', read: false, at: new Date().toISOString() } },
    { op: 'upsert', collection: 'notifications', id: 'n10', data: { userId: 'u-admin', text: 'ראו תיק', link: '/cases/k1', read: false, at: new Date().toISOString() } },
    { op: 'patch', collection: 'leaves', id: 'lv1', data: { to: '2026-11-20' } },
  ]);
  assert.deepEqual(r.json.results.map((x) => x.status), ['ok', 'denied', 'ok', 'denied', 'denied', 'denied', 'ok', 'denied']);
  // a link outside the app is dropped before the check, so the notification keeps only its text
  const ext = await ops(agent, [{ op: 'upsert', collection: 'notifications', id: 'n11', data: { userId: 'u-admin', text: 'לחצו', link: 'javascript:alert(1)', read: false, at: new Date().toISOString() } }]);
  assert.equal(ext.json.results[0].status, 'ok');
  const n = (await snap(admin)).collections.notifications.find((x) => x.id === 'n11');
  assert.equal(n.link, undefined);
});

test('docs: a server file can be filed only by its uploader or under its own case', async (t) => {
  const { s, admin, agent, ops } = await org(t);
  const up = await s.request('POST', '/api/files', { headers: { ...bearer(admin), 'content-type': 'application/pdf', 'x-file-name': 'x.pdf', 'x-case-id': 'k1' }, body: Buffer.from('%PDF') });
  const fileId = up.json.fileId;
  const r = await ops(agent, [
    { op: 'upsert', collection: 'docs', id: 'dx1', data: { caseId: 'k2', folder: 'customer', name: 'x.pdf', mime: 'application/pdf', fileId, uploadedAt: new Date().toISOString() } },
    { op: 'upsert', collection: 'docs', id: 'dx2', data: { caseId: 'k1', folder: 'office', name: 'x.pdf', mime: 'application/pdf', fileId, uploadedAt: new Date().toISOString() } },
    { op: 'upsert', collection: 'docs', id: 'dx3', data: { caseId: 'k1', folder: 'office', name: 'y.pdf', mime: 'application/pdf', fileId: 'f000000000000000000000000', uploadedAt: new Date().toISOString() } },
  ]);
  assert.deepEqual(r.json.results.map((x) => x.status), ['denied', 'ok', 'denied']);
});

test('links: javascript: and other schemes are dropped on write', async (t) => {
  const { admin, ops, snap } = await org(t);
  await ops(admin, [
    { op: 'upsert', collection: 'suppliers', id: 's1', data: { name: 'ספק', website: 'javascript:alert(1)' } },
    { op: 'upsert', collection: 'suppliers', id: 's2', data: { name: 'ספק 2', website: 'https://example.co.il' } },
  ]);
  const list = (await snap(admin)).collections.suppliers;
  assert.equal(list.find((x) => x.id === 's1').website, undefined);
  assert.equal(list.find((x) => x.id === 's2').website, 'https://example.co.il');
});

test('a client never creates money lines marked as Priority\'s', async (t) => {
  const { admin, ops } = await org(t);
  const r = await ops(admin, [{ op: 'upsert', collection: 'money', id: 'fake', data: { caseId: 'k1', kind: 'payment', amount: 1, source: 'priority' } }]);
  assert.equal(r.json.results[0].status, 'denied');
});

test('login: one lockout per account however the phone is typed, per address', async (t) => {
  const { s } = await org(t, { TRUST_PROXY: 'true' });
  const tryLogin = (login, ip) => s.request('POST', '/api/auth/login', { headers: { 'x-forwarded-for': ip }, body: { login, password: 'wrong-password' } });
  for (const login of ['0502201100', '+972-50-220-1100', '972502201100', '050 220 1100', '0502201100', '+972502201100', '0502201100', '0502201100']) {
    assert.equal((await tryLogin(login, '198.51.100.1')).status, 401);
  }
  assert.equal((await tryLogin('050-2201100', '198.51.100.1')).status, 429, 'all spellings count together');
  const other = await s.request('POST', '/api/auth/login', { headers: { 'x-forwarded-for': '198.51.100.2' }, body: { login: '0502201100', password: ADMIN_PASSWORD } });
  assert.equal(other.status, 200, 'the real user, from their own network, is not locked out');
});

test('password change: wrong current password is rate limited', async (t) => {
  const { s, agent } = await org(t);
  let last;
  for (let i = 0; i < 6; i++) last = await s.request('POST', '/api/auth/password', { headers: bearer(agent), body: { current: 'nope-nope', next: 'new-password-1' } });
  assert.equal(last.status, 429);
});

test('sessions end AUTH_MAX_DAYS after the login, refresh or not', async (t) => {
  useEnv(t, { AUTH_MAX_DAYS: '1' });
  const cfg = loadConfig();
  const store = await new DocStore().init();
  store.applyOps([{ op: 'upsert', collection: 'users', id: 'u1', data: { name: 'x', role: 'admin', active: true }, at: Date.now() }], {});
  store.setCredential('u1', { hash: 'x', pv: 1 });
  const twoDaysAgo = Math.floor(Date.now() / 1000) - 2 * 86400;
  const { token } = issueToken(store, cfg, 'u1', { auth: twoDaysAgo });
  assert.equal(readSession({ headers: { authorization: `Bearer ${token}` } }, store, cfg).error, 'expired');
  const fresh = issueToken(store, cfg, 'u1');
  assert.equal(readSession({ headers: { authorization: `Bearer ${fresh.token}` } }, store, cfg).user.id, 'u1');
});

test('DB_ENCRYPTION_KEY: db.json and its backups are encrypted, and read back with the key', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'genair-enc-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const state = { version: 1, seq: 3, collections: { customers: [{ id: 'c1', data: { id: 'c1', name: 'משפחת לוי' } }] } };
  await new JsonFileAdapter(dir, { encryptionKey: 'k'.repeat(40) }).save(state);
  const raw = await readFile(join(dir, 'db.json'), 'utf8');
  assert.doesNotMatch(raw, /משפחת לוי|c1/);
  assert.deepEqual(await new JsonFileAdapter(dir, { encryptionKey: 'k'.repeat(40) }).load(), state);
  await assert.rejects(new JsonFileAdapter(dir).load(), /encrypted/);
  await assert.rejects(new JsonFileAdapter(dir, { encryptionKey: 'wrong' }).load(), /could not be decrypted/);
});

test('AI: max_tokens has a ceiling', async (t) => {
  useEnv(t, { ANTHROPIC_API_KEY: 'sk-test', AI_MAX_TOKENS: '1000' });
  forbidFetch(t);
  const s = await startServer(t);
  const r = await s.request('POST', '/api/ai/messages', { body: { model: 'claude-sonnet-5-5', max_tokens: 64000, messages: [] } });
  assert.equal(r.status, 400);
  assert.equal(r.json.error.code, 'max_tokens_not_allowed');
});

test('WhatsApp webhook: refused without WHATSAPP_APP_SECRET', async (t) => {
  useEnv(t, {});
  const s = await startServer(t);
  const r = await s.request('POST', '/api/whatsapp/webhook', { body: { entry: [] } });
  assert.equal(r.status, 503);
});

test('database writes are rate limited per user', async (t) => {
  const { agent, ops } = await org(t);
  let last;
  for (let i = 0; i < 1201; i++) last = await ops(agent, [{ op: 'patch', collection: 'tasks', id: `t${i}`, data: { title: 'x' } }]);
  assert.equal(last.status, 429);
});

test('installers have no AI or Priority routes; WhatsApp only to known numbers', async (t) => {
  const { s, installer, admin } = await org(t, { ANTHROPIC_API_KEY: 'sk-test', WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: '1' });
  assert.equal((await s.request('POST', '/api/ai/messages', { headers: bearer(installer), body: {} })).status, 403);
  assert.equal((await s.request('GET', '/api/priority/items', { headers: bearer(installer) })).status, 403);
  const r = await s.request('POST', '/api/whatsapp/send', { headers: bearer(admin), body: { to: '0549999999', text: 'שלום' } });
  assert.equal(r.status, 403);
  assert.equal(r.json.error.code, 'unknown_recipient');
});

test('activity log: managers cannot rewrite it, only an admin deletes', async (t) => {
  const { admin, ops } = await org(t);
  await ops(admin, [{ op: 'upsert', collection: 'activities', id: 'a1', data: { kind: 'note', text: 'x' } }]);
  const r = await ops(admin, [{ op: 'patch', collection: 'activities', id: 'a1', data: { text: 'y' } }, { op: 'remove', collection: 'activities', id: 'a1' }]);
  assert.deepEqual(r.json.results.map((x) => x.status), ['denied', 'ok']);
});

test('API answers carry security headers', async (t) => {
  useEnv(t, {});
  const s = await startServer(t);
  const r = await s.request('GET', '/api/health');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['x-frame-options'], 'DENY');
});
