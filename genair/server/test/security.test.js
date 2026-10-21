// Security behaviour: setup code, sign-in limits, session life, who reads and writes what, links, budgets, webhooks, audit trail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forbidFetch, startServer, useEnv } from './helpers.js';
import { ADMIN_PASSWORD, bearer, bootstrapOrg, loginAs, orgSnapshot } from './fixtures.js';
import { accountKey, passwordProblem, setupCode, signToken, temporaryPassword } from '../src/auth.js';
import { setAuditSink } from '../src/audit.js';
import { clientIp, safeUrl } from '../src/http.js';
import { getStore } from '../src/db/index.js';
import { loadConfig } from '../src/config.js';
import { JsonFileAdapter } from '../src/db/adapters.js';

const now = () => Date.now();
const ops = (token, list, s) => s.request('POST', '/api/db/ops', { headers: bearer(token), body: { ops: list.map((o) => ({ at: now(), ...o })) } });
const statuses = (r) => r.json.results.map((x) => x.status + (x.error ? `:${x.error}` : ''));

async function org(t, vars = {}) {
  useEnv(t, vars);
  forbidFetch(t);
  const s = await startServer(t);
  const { token: admin } = await bootstrapOrg(s);
  const inst = await loginAs(s, admin, 'u-inst1', '0502201105');
  const agent = await loginAs(s, admin, 'u-agent1', '0502201102');
  return { s, admin, inst, agent };
}

// ------------------------------------------------------------ first setup

test('setup: the code is required; with no BOOTSTRAP_TOKEN the server makes its own', async (t) => {
  useEnv(t, { BOOTSTRAP_TOKEN: '' });
  const s = await startServer(t);
  const body = { snapshot: orgSnapshot(), adminUserId: 'u-admin', password: ADMIN_PASSWORD };
  assert.equal((await s.request('POST', '/api/auth/bootstrap', { body })).status, 401, 'no code');
  assert.equal((await s.request('POST', '/api/auth/bootstrap', { body: { ...body, bootstrapToken: 'guess' } })).status, 401, 'wrong code');
  const store = await getStore(loadConfig());
  const code = setupCode(store, loadConfig());
  assert.match(code, /^[A-Za-z0-9_-]{12}$/);
  assert.equal(setupCode(store, loadConfig()), code, 'the same code until the server restarts');
  assert.equal((await s.request('POST', '/api/auth/bootstrap', { body: { ...body, bootstrapToken: code } })).status, 201);
  assert.equal((await s.request('POST', '/api/auth/bootstrap', { body: { ...body, bootstrapToken: code } })).status, 409, 'only once');
});

test('setup: repeated wrong codes from one address are blocked', async (t) => {
  useEnv(t);
  const s = await startServer(t);
  const body = { snapshot: orgSnapshot(), adminUserId: 'u-admin', password: ADMIN_PASSWORD, bootstrapToken: 'nope' };
  for (let i = 0; i < 30; i++) await s.request('POST', '/api/auth/bootstrap', { body });
  const r = await s.request('POST', '/api/auth/bootstrap', { body: { ...body, bootstrapToken: 'test-setup-code' } });
  assert.equal(r.status, 429, 'even the right code waits after 30 wrong ones');
});

// ------------------------------------------------------------ sign-in limits

test('a stranger typing wrong passwords for the manager cannot lock the manager out', async (t) => {
  useEnv(t, { TRUST_PROXY: 'true' });
  const s = await startServer(t);
  await bootstrapOrg(s);
  const from = (ip) => ({ 'x-forwarded-for': `203.0.113.${ip}` });
  for (let i = 0; i < 12; i++) await s.request('POST', '/api/auth/login', { headers: from(7), body: { login: 'david@genair.co.il', password: `wrong-${i}-xx` } });
  assert.equal((await s.request('POST', '/api/auth/login', { headers: from(7), body: { login: 'david@genair.co.il', password: ADMIN_PASSWORD } })).status, 429, 'the attacker is blocked');
  const real = await s.request('POST', '/api/auth/login', { headers: from(9), body: { login: 'david@genair.co.il', password: ADMIN_PASSWORD } });
  assert.equal(real.status, 200, 'the manager, from another address, signs in');
});

test('one account counts however the login is typed', async (t) => {
  assert.equal(accountKey('David@Genair.co.il '), accountKey('david@genair.co.il'));
  assert.equal(accountKey('050-220 1100'), accountKey('0502201100'));
  assert.equal(accountKey('+972502201100'), accountKey('0502201100'));
  useEnv(t);
  const s = await startServer(t);
  await bootstrapOrg(s);
  const variants = ['0502201100', '050-2201100', '050 220 1100', '+972502201100', '972502201100', '0502201100 ', '(050)2201100', '050.2201100'];
  let blocked = 0;
  for (const login of [...variants, ...variants]) if ((await s.request('POST', '/api/auth/login', { body: { login, password: 'wrong-pass-1' } })).status === 429) blocked++;
  assert.ok(blocked >= 8, `the 9th guess on the same account is refused, whatever the format (${blocked} refused)`);
});

test('X-Forwarded-For: the client is the entry the proxy appended, not the one the client wrote', () => {
  const req = (h) => ({ headers: h, socket: { remoteAddress: '10.0.0.1' } });
  assert.equal(clientIp(req({ 'x-forwarded-for': '6.6.6.6, 1.2.3.4' }), true, 1), '1.2.3.4');
  assert.equal(clientIp(req({ 'x-forwarded-for': '6.6.6.6, 1.2.3.4, 10.9.9.9' }), true, 2), '1.2.3.4');
  assert.equal(clientIp(req({ 'x-forwarded-for': '6.6.6.6' }), false), '10.0.0.1', 'ignored unless TRUST_PROXY');
  assert.equal(clientIp(req({}), true), '10.0.0.1');
});

test('a spoofed X-Forwarded-For prefix does not buy more sign-in attempts', async (t) => {
  useEnv(t, { TRUST_PROXY: 'true' });
  const s = await startServer(t);
  await bootstrapOrg(s);
  let blocked = 0;
  for (let i = 0; i < 40; i++) {
    const r = await s.request('POST', '/api/auth/login', { headers: { 'x-forwarded-for': `10.${i}.0.1, 198.51.100.4` }, body: { login: `nobody${i}@x.io`, password: 'whatever-1' } });
    if (r.status === 429) blocked++;
  }
  assert.ok(blocked >= 9, `the real address (the last entry) is limited (${blocked} refused)`);
});

test('password rules: weak and login-like passwords are refused, temporary passwords look right', () => {
  assert.ok(passwordProblem('12345678'));
  assert.ok(passwordProblem('aaaaaaaaaa'));
  assert.ok(passwordProblem('Password1'.toLowerCase()));
  assert.ok(passwordProblem('david@genair.co.il', ['david@genair.co.il']));
  assert.equal(passwordProblem('kitchen-Table-77'), null);
  for (let i = 0; i < 200; i++) {
    const p = temporaryPassword();
    assert.match(p, /^[a-hj-km-np-z2-9]{10}$/);
    assert.match(p, /\d/);
  }
});

test('changing a password: wrong current password is limited, and a weak new one is refused', async (t) => {
  const { s, admin } = await org(t);
  assert.equal((await s.request('POST', '/api/auth/password', { headers: bearer(admin), body: { current: ADMIN_PASSWORD, next: '12345678' } })).status, 400);
  for (let i = 0; i < 5; i++) assert.equal((await s.request('POST', '/api/auth/password', { headers: bearer(admin), body: { current: `bad-${i}-xxxxx`, next: 'brand-new-pass-1' } })).status, 401);
  assert.equal((await s.request('POST', '/api/auth/password', { headers: bearer(admin), body: { current: ADMIN_PASSWORD, next: 'brand-new-pass-1' } })).status, 429);
});

// ------------------------------------------------------------ sessions

test('a session cannot be renewed forever: it ends AUTH_MAX_SESSION_HOURS after sign-in', async (t) => {
  useEnv(t, { AUTH_SECRET: 'secret-for-tests-1234567890', AUTH_MAX_SESSION_HOURS: '24' });
  const s = await startServer(t);
  const { token } = await bootstrapOrg(s);
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
  assert.equal(claims.ses, claims.iat, 'the sign-in time is kept in the token');
  const old = Math.floor(Date.now() / 1000) - 25 * 3600;
  const stale = signToken({ ...claims, ses: old, iat: Math.floor(Date.now() / 1000) - 60 }, 'secret-for-tests-1234567890');
  const r = await s.request('GET', '/api/auth/me', { headers: bearer(stale) });
  assert.equal(r.status, 401);
  assert.equal(r.json.error.details.reason, 'expired');
  assert.equal((await s.request('GET', '/api/auth/me', { headers: bearer(token) })).status, 200);
  // a revoked session says so, so the device can wipe its copy
  await s.request('POST', '/api/auth/logout', { headers: bearer(token), body: {} });
  const gone = await s.request('GET', '/api/auth/me', { headers: bearer(token) });
  assert.equal(gone.json.error.details.reason, 'revoked');
});

// ------------------------------------------------------------ who reads what

test('reads: an installer gets no money, quotes, contracts, suppliers, purchasing or sync state', async (t) => {
  const { s, admin, inst } = await org(t);
  await ops(admin, [
    { op: 'upsert', collection: 'money', id: 'm1', data: { caseId: 'k1', kind: 'payment', amount: 5000 } },
    { op: 'upsert', collection: 'suppliers', id: 'su1', data: { name: 'ספק' } },
    { op: 'upsert', collection: 'catalog', id: 'i1', data: { name: 'מזגן', price: 3000, cost: 2000 } },
  ], s);
  const store = await getStore(loadConfig());
  store.applyOps([{ op: 'upsert', collection: 'integrations', id: 'priority', at: now(), data: { engine: { active: true } } }], { clientId: 'priority-sync' });
  const a = (await s.request('GET', '/api/db/snapshot', { headers: bearer(admin) })).json.collections;
  const i = (await s.request('GET', '/api/db/snapshot', { headers: bearer(inst) })).json.collections;
  for (const c of ['money', 'quotes', 'suppliers', 'integrations']) assert.ok(a[c]?.length, `admin sees ${c}`);
  for (const c of ['money', 'quotes', 'contracts', 'suppliers', 'purchaseOrders', 'integrations']) assert.equal(i[c], undefined, `installer does not see ${c}`);
  assert.ok(i.cases.length && i.appointments.length, 'field data is there');
  const item = i.catalog.find((x) => x.id === 'i1');
  assert.equal(item.price, undefined);
  assert.equal(item.cost, undefined);
  assert.equal(i.users.find((u) => u.id === 'u-admin').email, undefined, 'staff e-mail addresses are not for the field');
  assert.equal(a.users.find((u) => u.id === 'u-admin').email, 'david@genair.co.il');
  // the same through fetch
  const f = await s.request('POST', '/api/db/fetch', { headers: bearer(inst), body: { items: [{ c: 'money', id: 'm1' }, { c: 'integrations', id: 'priority' }, { c: 'cases', id: 'k1' }] } });
  assert.deepEqual(f.json.items.map((x) => x.c), ['cases']);
});

test('reads: notifications and leave requests are the person\'s own; a direct message reaches two people only', async (t) => {
  const { s, admin, inst, agent } = await org(t);
  await ops(admin, [
    { op: 'upsert', collection: 'notifications', id: 'n-admin', data: { userId: 'u-admin', text: 'לאדמין', read: false, at: new Date().toISOString() } },
    { op: 'upsert', collection: 'chat', id: 'dm1', data: { threadId: 'dm:u-admin:u-agent1', fromId: 'u-admin', body: 'סודי', at: new Date().toISOString(), readBy: ['u-admin'] } },
    { op: 'upsert', collection: 'chat', id: 'case1', data: { threadId: 'case:k1', caseId: 'k1', fromId: 'u-admin', body: 'לצוות', at: new Date().toISOString(), readBy: [] } },
    { op: 'upsert', collection: 'leaves', id: 'lv1', data: { userId: 'u-agent1', from: '2030-01-01', to: '2030-01-02', status: 'pending' } },
  ], s);
  const snap = async (tok) => (await s.request('GET', '/api/db/snapshot', { headers: bearer(tok) })).json.collections;
  const forInst = await snap(inst);
  assert.ok(!forInst.notifications.some((n) => n.id === 'n-admin'));
  assert.ok(!forInst.chat.some((m) => m.id === 'dm1'), 'a private message is not shared');
  assert.ok(forInst.chat.some((m) => m.id === 'case1'), 'the case thread is');
  assert.ok(!forInst.leaves.some((l) => l.id === 'lv1'));
  const forAgent = await snap(agent);
  assert.ok(forAgent.chat.some((m) => m.id === 'dm1'));
  assert.ok(forAgent.leaves.some((l) => l.id === 'lv1'));
  assert.ok((await snap(admin)).leaves.some((l) => l.id === 'lv1'), 'managers see all leave requests');
  // live changes are filtered the same way
  const ch = await s.request('GET', '/api/db/changes?since=0&wait=0', { headers: bearer(inst) });
  if (!ch.json.reset) assert.ok(!ch.json.changes.some((c) => c.id === 'dm1' || c.id === 'n-admin'));
});

// ------------------------------------------------------------ who writes what

test('writes: the audit trail is stamped by the server and cannot be rewritten', async (t) => {
  const { s, admin, inst } = await org(t);
  const r = await ops(inst, [{ op: 'upsert', collection: 'activities', id: 'a1', data: { text: 'ביקרתי', kind: 'note', userId: 'u-admin', at: '1999-01-01T00:00:00Z' } }], s);
  assert.deepEqual(statuses(r), ['ok']);
  const a = (await s.request('GET', '/api/db/snapshot', { headers: bearer(admin) })).json.collections.activities.find((x) => x.id === 'a1');
  assert.equal(a.userId, 'u-inst1', 'the device cannot sign for someone else');
  assert.ok(Date.parse(a.at) > Date.now() - 60_000, 'an absurd time is replaced');
  assert.deepEqual(statuses(await ops(inst, [{ op: 'patch', collection: 'activities', id: 'a1', data: { text: 'שיניתי' } }], s)), ['denied:immutable']);
  assert.deepEqual(statuses(await ops(inst, [{ op: 'remove', collection: 'activities', id: 'a1' }], s)), ['denied:immutable']);
  assert.deepEqual(statuses(await ops(admin, [{ op: 'remove', collection: 'activities', id: 'a1' }], s)), ['ok'], 'only an admin removes a line');
});

test('writes: stock moves from a field device are checked before they can reach the ERP', async (t) => {
  const { s, admin, inst } = await org(t);
  await ops(admin, [{ op: 'upsert', collection: 'catalog', id: 'i1', data: { name: 'מזגן' } }], s);
  const mv = (id, data) => ({ op: 'upsert', collection: 'stockMoves', id, data: { at: new Date().toISOString(), ...data } });
  const r = await ops(inst, [
    mv('ok1', { kind: 'use', itemId: 'i1', qty: 1, from: 'רכב — סאמר חלבי', userId: 'u-inst1' }),
    mv('bad-kind', { kind: 'adjust', itemId: 'i1', qty: 1 }),
    mv('bad-qty', { kind: 'use', itemId: 'i1', qty: 100000 }),
    mv('neg', { kind: 'use', itemId: 'i1', qty: -3 }),
    mv('ghost', { kind: 'use', itemId: 'nope', qty: 1 }),
    mv('other', { kind: 'use', itemId: 'i1', qty: 1, userId: 'u-agent1' }),
    mv('half', { kind: 'use' }),
  ], s);
  assert.deepEqual(statuses(r), ['ok', ...Array(6).fill(0).map((_, i) => ['denied:invalid_stock_move', 'denied:invalid_stock_move', 'denied:invalid_stock_move', 'denied:invalid_stock_move', 'denied:not_yours', 'denied:invalid_stock_move'][i])]);
});

test('writes: server-owned sync fields cannot be set from a field device; a doc cannot be made customer-visible by one', async (t) => {
  const { s, admin, inst } = await org(t);
  await ops(admin, [{ op: 'upsert', collection: 'units', id: 'un9', data: { customerId: 'c1', serial: 'S9', sync: { status: 'synced', priorityId: 'REAL-1' }, priorityId: 'REAL-1' } }], s);
  await ops(inst, [{ op: 'patch', collection: 'units', id: 'un9', data: { sync: { status: 'not_synced' }, priorityId: 'FAKE', serial: 'S9b' } }], s);
  const u = (await s.request('GET', '/api/db/snapshot', { headers: bearer(admin) })).json.collections.units.find((x) => x.id === 'un9');
  assert.equal(u.serial, 'S9b', 'the field it may edit changed');
  assert.equal(u.sync.status, 'synced');
  assert.equal(u.priorityId, 'REAL-1');
  const fresh = await ops(inst, [{ op: 'upsert', collection: 'units', id: 'un10', data: { customerId: 'c1', serial: 'S10', sync: { status: 'synced', priorityId: 'X' }, priorityId: 'Y' } }], s);
  assert.deepEqual(statuses(fresh), ['ok']);
  const u10 = (await s.request('GET', '/api/db/snapshot', { headers: bearer(admin) })).json.collections.units.find((x) => x.id === 'un10');
  assert.equal(u10.sync, undefined);
  assert.equal(u10.priorityId, undefined);
  assert.deepEqual(statuses(await ops(inst, [{ op: 'upsert', collection: 'docs', id: 'dx', data: { caseId: 'k1', folder: 'installer', name: 'x.pdf', mime: 'application/pdf', uploadedAt: new Date().toISOString(), customerVisible: true } }], s)), ['denied:installer_scope']);
  assert.deepEqual(statuses(await ops(inst, [{ op: 'upsert', collection: 'docs', id: 'dy', data: { caseId: 'k1', folder: 'installer', name: 'y.pdf', mime: 'application/pdf', uploadedAt: new Date().toISOString() } }], s)), ['ok']);
});

test('writes: a message belongs to its sender; notifications carry a safe text and an app path only; a money line cannot pose as Priority\'s', async (t) => {
  const { s, admin, inst, agent } = await org(t);
  await ops(admin, [{ op: 'upsert', collection: 'chat', id: 'c1', data: { threadId: 'case:k1', fromId: 'u-admin', body: 'שלום', at: new Date().toISOString(), readBy: [] } }], s);
  assert.deepEqual(statuses(await ops(inst, [{ op: 'patch', collection: 'chat', id: 'c1', data: { body: 'שיניתי אותך' } }], s)), ['denied:not_yours']);
  assert.deepEqual(statuses(await ops(inst, [{ op: 'patch', collection: 'chat', id: 'c1', data: { deleted: true, body: '' } }], s)), ['denied:not_yours']);
  assert.deepEqual(statuses(await ops(inst, [{ op: 'patch', collection: 'chat', id: 'c1', data: { readBy: ['u-inst1'] } }], s)), ['ok'], 'marking as read is allowed for anyone');
  assert.deepEqual(statuses(await ops(inst, [{ op: 'upsert', collection: 'chat', id: 'c2', data: { threadId: 'case:k1', fromId: 'u-admin', body: 'מתחזה', at: new Date().toISOString(), readBy: [] } }], s)), ['denied:not_yours']);

  await ops(inst, [{ op: 'upsert', collection: 'notifications', id: 'nx', data: { userId: 'u-admin', text: 'x'.repeat(1000), link: 'javascript:alert(1)', read: false, at: new Date().toISOString() } }], s);
  await ops(inst, [{ op: 'upsert', collection: 'notifications', id: 'ny', data: { userId: 'u-admin', text: 'ok', link: '/cases/k1', read: false, at: new Date().toISOString() } }], s);
  const n = (await s.request('GET', '/api/db/snapshot', { headers: bearer(admin) })).json.collections.notifications;
  assert.equal(n.find((x) => x.id === 'nx').link, undefined);
  assert.equal(n.find((x) => x.id === 'nx').text.length, 300);
  assert.equal(n.find((x) => x.id === 'ny').link, '/cases/k1');

  assert.deepEqual(statuses(await ops(agent, [{ op: 'upsert', collection: 'money', id: 'fake', data: { caseId: 'k1', kind: 'payment', amount: 1, source: 'priority' } }], s)), ['denied:priority_owned']);
});

test('writes: a link field never keeps a javascript: or data: address', async (t) => {
  const { s, admin, agent } = await org(t);
  await ops(agent, [
    { op: 'upsert', collection: 'suppliers', id: 'su1', data: { name: 'א', website: 'javascript:alert(document.cookie)' } },
    { op: 'upsert', collection: 'suppliers', id: 'su2', data: { name: 'ב', website: 'example.com/shop' } },
    { op: 'upsert', collection: 'docs', id: 'd9', data: { caseId: 'k1', folder: 'office', name: 'x', mime: 'text/html', uploadedAt: new Date().toISOString(), url: 'data:text/html,<script>alert(1)</script>', webViewLink: 'https://drive.google.com/file/d/1' } },
  ], s);
  const c = (await s.request('GET', '/api/db/snapshot', { headers: bearer(admin) })).json.collections;
  assert.equal(c.suppliers.find((x) => x.id === 'su1').website, undefined);
  assert.equal(c.suppliers.find((x) => x.id === 'su2').website, 'https://example.com/shop');
  const d = c.docs.find((x) => x.id === 'd9');
  assert.equal(d.url, undefined);
  assert.equal(d.webViewLink, 'https://drive.google.com/file/d/1');
  for (const bad of ['javascript:1', 'JaVaScRiPt:1', 'data:text/html,x', 'vbscript:x', '//evil.example', ' java\tscript:1']) assert.equal(safeUrl(bad), undefined, bad);
});

test('writes: a document may point only at a file its own sender uploaded', async (t) => {
  const { s, admin, inst, agent } = await org(t);
  const up = await s.request('POST', '/api/files', { headers: { ...bearer(admin), 'content-type': 'application/pdf', 'x-file-name': 'secret.pdf' }, body: Buffer.from('%PDF-1.4 secret') });
  const mine = await s.request('POST', '/api/files', { headers: { ...bearer(inst), 'content-type': 'application/pdf', 'x-file-name': 'mine.pdf' }, body: Buffer.from('%PDF-1.4 mine') });
  const doc = (id, fileId) => ({ op: 'upsert', collection: 'docs', id, data: { caseId: 'k1', folder: 'office', name: 'x.pdf', mime: 'application/pdf', uploadedAt: new Date().toISOString(), fileId } });
  assert.deepEqual(statuses(await ops(inst, [doc('d-steal', up.json.fileId)], s)), ['denied:file_not_yours']);
  assert.deepEqual(statuses(await ops(inst, [doc('d-mine', mine.json.fileId)], s)), ['ok']);
  assert.deepEqual(statuses(await ops(agent, [doc('d-agent', up.json.fileId)], s)), ['denied:file_not_yours']);
  assert.deepEqual(statuses(await ops(admin, [doc('d-admin', mine.json.fileId)], s)), ['ok'], 'managers may link any file');
});

// ------------------------------------------------------------ budgets

test('budgets: a user that sends too many write batches, uploads or streams is slowed down', async (t) => {
  const { s, inst } = await org(t, { LIMIT_OPS_PER_MIN: '5', LIMIT_FILES_PER_10MIN: '2', LIMIT_STREAMS_PER_USER: '1' });
  const codes = [];
  for (let i = 0; i < 8; i++) codes.push((await ops(inst, [{ op: 'upsert', collection: 'tasks', id: `t${i}`, data: { title: 'x' } }], s)).status);
  assert.deepEqual(codes, [200, 200, 200, 200, 200, 429, 429, 429]);
  const f = () => s.request('POST', '/api/files', { headers: { ...bearer(inst), 'content-type': 'image/png', 'x-file-name': 'a.png' }, body: Buffer.from('x') });
  assert.deepEqual([(await f()).status, (await f()).status, (await f()).status], [201, 201, 429]);
});

test('budgets: only one long-poll at a time when LIMIT_STREAMS_PER_USER=1', async (t) => {
  const { s, agent } = await org(t, { LIMIT_STREAMS_PER_USER: '1' });
  const seq = (await s.request('GET', '/api/db/changes?since=0&wait=0', { headers: bearer(agent) })).json.seq;
  const first = s.request('GET', `/api/db/changes?since=${seq}&wait=2`, { headers: bearer(agent) });
  await new Promise((r) => setTimeout(r, 150));
  const second = await s.request('GET', `/api/db/changes?since=${seq}&wait=2`, { headers: bearer(agent) });
  assert.equal(second.status, 429);
  assert.equal(second.json.error.code, 'too_many_streams');
  await ops(agent, [{ op: 'upsert', collection: 'tasks', id: 'wake', data: { title: 'x' } }], s);
  assert.equal((await first).status, 200);
  assert.equal((await s.request('GET', `/api/db/changes?since=${seq}&wait=0`, { headers: bearer(agent) })).status, 200, 'the slot is free again');
});

// ------------------------------------------------------------ integrations

test('AI proxy: max_tokens is required and capped', async (t) => {
  const { s, agent } = await org(t, { ANTHROPIC_API_KEY: 'k', AI_MAX_TOKENS: '1000' });
  const call = (body) => s.request('POST', '/api/ai/messages', { headers: bearer(agent), body });
  assert.equal((await call({ model: 'claude-sonnet-5-5', messages: [] })).json.error.code, 'max_tokens_not_allowed');
  assert.equal((await call({ model: 'claude-sonnet-5-5', max_tokens: 5000, messages: [] })).json.error.code, 'max_tokens_not_allowed');
  assert.equal((await call({ model: 'claude-sonnet-5-5', max_tokens: '10', messages: [] })).json.error.code, 'max_tokens_not_allowed');
});

test('WhatsApp: the webhook refuses to work unsigned; a bad signature is logged and alerts the admins', async (t) => {
  const events = [];
  const { s, admin } = await org(t, { WHATSAPP_VERIFY_TOKEN: 'vt' });
  setAuditSink((e) => events.push(e));
  const unsigned = await s.request('POST', '/api/whatsapp/webhook', { body: { entry: [] } });
  assert.equal(unsigned.status, 503);
  assert.equal(unsigned.json.error.code, 'whatsapp_secret_missing');
  process.env.WHATSAPP_APP_SECRET = 'app-secret';
  const bad = await s.request('POST', '/api/whatsapp/webhook', { headers: { 'x-hub-signature-256': 'sha256=00' }, body: { entry: [] } });
  assert.equal(bad.status, 401);
  assert.ok(events.some((e) => e.event === 'webhook_rejected' && e.service === 'whatsapp'));
  await new Promise((r) => setTimeout(r, 50));
  const n = (await s.request('GET', '/api/db/snapshot', { headers: bearer(admin) })).json.collections.notifications;
  assert.ok(n.some((x) => x.userId === 'u-admin' && x.text.includes('וואטסאפ')), 'the admin sees an alert');
});

test('WhatsApp: a signed-in user can message people in the system, not any number', async (t) => {
  const { s, agent } = await org(t, { WHATSAPP_TOKEN: 'tok', WHATSAPP_PHONE_NUMBER_ID: '123' });
  const real = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => (globalThis.fetch = real));
  const send = (to) => s.request('POST', '/api/whatsapp/send', { headers: bearer(agent), body: { to, text: 'שלום' } });
  assert.equal((await send('054-1111111')).status, 200, 'a customer');
  assert.equal((await send('0502201105')).status, 200, 'a colleague');
  const stranger = await send('0509998877');
  assert.equal(stranger.status, 403);
  assert.equal(stranger.json.error.code, 'recipient_unknown');
  assert.equal(sent.length, 2);
});

test('Drive and calendar: only folders, files and calendars the system knows', async (t) => {
  const { s, agent } = await org(t, { GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'sa@x.iam', private_key: 'not-a-key' }), GOOGLE_CALENDAR_ID: 'team@x', GOOGLE_DRIVE_PARENT_ID: 'ROOT' });
  const post = (path, body) => s.request('POST', path, { headers: bearer(agent), body });
  assert.equal((await post('/api/google/drive/folders', { name: 'x', parentId: 'SOMEONE_ELSES_FOLDER' })).json.error.code, 'drive_target_not_allowed');
  assert.equal((await post('/api/google/drive/files/anyFileIdAtAll/trash', {})).json.error.code, 'drive_target_not_allowed');
  assert.equal((await post('/api/google/drive/files/anyFileIdAtAll/move', { to: 'ROOT' })).json.error.code, 'drive_target_not_allowed');
  assert.equal((await s.request('POST', '/api/google/drive/files?folderId=ELSEWHERE', { headers: { ...bearer(agent), 'content-type': 'text/plain', 'x-file-name': 'a.txt' }, body: 'hi' })).json.error.code, 'drive_target_not_allowed');
  const cal = await post('/api/google/calendar/events', { calendarId: 'victim@gmail.com', summary: 's', start: '2030-01-01T10:00:00Z', end: '2030-01-01T11:00:00Z' });
  assert.equal(cal.json.error.code, 'calendar_not_allowed');
});

// ------------------------------------------------------------ audit trail, headers, files on disk

test('audit trail: sign-ins, failures, lockouts, password changes and refused writes are logged, with no passwords', async (t) => {
  const events = [];
  useEnv(t);
  setAuditSink((e) => events.push(e));
  const s = await startServer(t);
  const { token: admin } = await bootstrapOrg(s);
  await s.request('POST', '/api/auth/login', { body: { login: 'david@genair.co.il', password: 'wrong-pass-99' } });
  await s.request('POST', '/api/auth/login', { body: { login: 'david@genair.co.il', password: ADMIN_PASSWORD } });
  const inst = await loginAs(s, admin, 'u-inst1', '0502201105');
  await ops(inst, [{ op: 'upsert', collection: 'config', id: 'org', data: { x: 1 } }], s);
  await ops(admin, [{ op: 'patch', collection: 'users', id: 'u-agent1', data: { role: 'admin' } }], s);
  const changed = await s.request('POST', '/api/auth/password', { headers: bearer(admin), body: { current: ADMIN_PASSWORD, next: 'a-better-password-9' } });
  const admin2 = changed.json.token; // the old token ends with the old password
  for (let i = 0; i < 10; i++) await s.request('POST', '/api/auth/login', { body: { login: 'david@genair.co.il', password: `guess-${i}-zzzz` } });
  const kinds = new Set(events.map((e) => e.event));
  for (const k of ['bootstrap_done', 'login_failed', 'login_ok', 'password_reset', 'op_denied', 'user_changed', 'password_changed', 'login_blocked', 'login_locked']) assert.ok(kinds.has(k), `logged: ${k}`);
  const text = JSON.stringify(events);
  for (const secret of [ADMIN_PASSWORD, 'wrong-pass-99', 'guess-1-zzzz', 'a-better-password-9', 'scrypt$']) assert.ok(!text.includes(secret), `never logged: ${secret}`);
  assert.ok(!text.includes('david@genair.co.il'), 'logins are masked');
  assert.ok(events.some((e) => e.event === 'login_failed' && e.login === 'd***@genair.co.il'));
  const n = (await s.request('GET', '/api/db/snapshot', { headers: bearer(admin2) })).json.collections.notifications;
  assert.ok(n.some((x) => x.text.includes('ניסיונות כניסה כושלים')), 'the lockout reached the admin');
  assert.ok(n.some((x) => x.text.includes('הרשאת ניהול')), 'a new admin reached the admin');
});

test('every API answer carries security headers', async (t) => {
  useEnv(t, { TRUST_PROXY: 'true' });
  const s = await startServer(t);
  const r = await s.request('GET', '/api/health', { headers: { 'x-forwarded-proto': 'https' } });
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['x-frame-options'], 'DENY');
  assert.equal(r.headers['referrer-policy'], 'no-referrer');
  assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.match(r.headers['strict-transport-security'], /max-age=/);
  const plain = await s.request('GET', '/api/health');
  assert.equal(plain.headers['strict-transport-security'], undefined, 'HSTS only over https');
});

test('the database file and uploaded files are private to the account that runs the server', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'genair-perm-'));
  useEnv(t, { DB_MODE: 'file', DATA_DIR: dir, DB_FLUSH_MS: '1' });
  const s = await startServer(t);
  const { token } = await bootstrapOrg(s);
  await s.request('POST', '/api/files', { headers: { ...bearer(token), 'content-type': 'text/plain', 'x-file-name': 'a.txt' }, body: 'hello' });
  const store = await getStore(loadConfig());
  await store.flush();
  const mode = async (p) => (await stat(p)).mode & 0o777;
  assert.equal(await mode(join(dir, 'db.json')), 0o600);
  assert.equal(await mode(dir), 0o700);
  assert.equal(await mode(join(dir, 'files')), 0o700);
  const saved = JSON.parse(await readFile(join(dir, 'db.json'), 'utf8'));
  assert.ok(saved.auth.secret, 'the signing secret is in the file, which is why the file is private');
  assert.equal(await new JsonFileAdapter(dir).load().then((x) => x.version), 1);
});
