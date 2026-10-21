// The database functions (migrations/*.sql) against a real Postgres, as the server and as each role.
// PGURL defaults to the local test cluster; the migration is applied to a fresh database on every run.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const ADMIN_URL = process.env.PGURL ?? 'postgres://postgres@localhost:54329/postgres?host=/tmp';
const DB = 'genair_unit';
let pool;

const U = {
  admin: '00000000-0000-0000-0000-00000000000a',
  office: '00000000-0000-0000-0000-00000000000b',
  agent: '00000000-0000-0000-0000-00000000000c',
  installer: '00000000-0000-0000-0000-00000000000d',
  gone: '00000000-0000-0000-0000-00000000000e',
};

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${DB} with (force)`);
  await admin.query(`create database ${DB}`);
  await admin.end();
  pool = new pg.Pool({ connectionString: ADMIN_URL.replace('/postgres?', `/${DB}?`) });
  await pool.query(readFileSync(join(here, 'stubs.sql'), 'utf8'));
  for (const f of readdirSync(join(here, '../migrations')).sort()) await pool.query(readFileSync(join(here, '../migrations', f), 'utf8'));
});
after(() => pool?.end());

beforeEach(async () => {
  await pool.query('truncate app.entities, app.counters, app.members, app.files, app.inbox, storage.objects');
  await sys([
    up('users', 'u-admin', { name: 'דוד', role: 'admin', active: true }),
    up('users', 'u-office', { name: 'משה', role: 'office', active: true }),
    up('users', 'u-agent', { name: 'אבי', role: 'agent', active: true }),
    up('users', 'u-inst', { name: 'סאמר חלבי', role: 'installer', active: true }),
    up('users', 'u-gone', { name: 'עזב', role: 'agent', active: false }),
  ]);
  for (const [k, auth] of Object.entries({ 'u-admin': U.admin, 'u-office': U.office, 'u-agent': U.agent, 'u-inst': U.installer, 'u-gone': U.gone })) {
    await pool.query('select public.sys_set_member($1, $2, $3, false)', [auth, k, `${k}@test.local`]);
  }
});

const now = () => Date.now();
const up = (collection, id, data, at = now()) => ({ op: 'upsert', collection, id, data, at });
const pa = (collection, id, data, at = now(), extra = {}) => ({ op: 'patch', collection, id, data, at, ...extra });
const rm = (collection, id, at = now()) => ({ op: 'remove', collection, id, at });

async function sys(ops, origin = 'server') {
  return (await pool.query('select public.sys_apply($1::jsonb, $2) as r', [JSON.stringify(ops), origin])).rows[0].r;
}

/** Runs `sql` as a signed-in user (role authenticated, auth.uid() = uuid), the way PostgREST does. */
async function as(uuid, sql, params = []) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    // what PostgREST sets for a signed-in request
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uuid, role: 'authenticated' })]);
    await c.query('set local role authenticated');
    const r = await c.query(sql, params);
    await c.query('commit');
    return r.rows[0] ? Object.values(r.rows[0])[0] : undefined;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
const ops = (uuid, list) => as(uuid, 'select public.db_ops($1::jsonb, $2)', [JSON.stringify(list), 'dev1']);
const snapshot = (uuid) => as(uuid, 'select public.db_snapshot()');
const get = async (c, id) => (await pool.query('select data from app.entities where collection = $1 and id = $2 and del = 0', [c, id])).rows[0]?.data;
const statuses = (r) => r.results.map((x) => x.status);

// ------------------------------------------------------------------ merge semantics (server/test/store.test.js)

test('upsert / patch / remove with a growing change sequence', async () => {
  const base = (await pool.query('select app.max_seq() s')).rows[0].s;
  const r1 = await sys([up('cases', 'k1', { title: 'א', stage: 'lead' }, 1000)]);
  assert.equal(r1.results[0].status, 'ok');
  assert.deepEqual(await get('cases', 'k1'), { title: 'א', stage: 'lead', id: 'k1' });
  await sys([pa('cases', 'k1', { stage: 'quote' }, 2000), up('tasks', 't1', { title: 'x' }, 2000)]);
  assert.equal((await get('cases', 'k1')).stage, 'quote');
  await sys([rm('tasks', 't1', 3000)]);
  assert.equal(await get('tasks', 't1'), undefined, 'soft deleted');
  const ch = await as(U.admin, 'select public.db_changes($1)', [Number(r1.seq)]);
  assert.deepEqual(ch.changes.map((c) => [c.c, c.id, Boolean(c.del)]), [['cases', 'k1', false], ['tasks', 't1', true]]);
  assert.ok(ch.changes[0].seq < ch.changes[1].seq, 'oldest first');
  assert.equal((await as(U.admin, 'select public.db_changes($1)', [Number(base) + 1e6])).reset, true, 'a cursor ahead of the server forces a reload');
});

test('per-field last-write-wins: concurrent patches to different fields both survive', async () => {
  await sys([up('cases', 'k1', { stage: 'lead', notes: 'a' }, 1000)]);
  await sys([pa('cases', 'k1', { stage: 'quote' }, 3000)]);
  assert.equal((await sys([pa('cases', 'k1', { notes: 'b' }, 2000)])).results[0].status, 'ok');
  assert.deepEqual(await get('cases', 'k1'), { stage: 'quote', notes: 'b', id: 'k1' });
  assert.equal((await sys([pa('cases', 'k1', { stage: 'survey' }, 2500)])).results[0].status, 'stale');
  assert.equal((await sys([pa('cases', 'k1', { stage: 'lost', notes: 'c' }, 2900)])).results[0].status, 'partial');
  assert.deepEqual(await get('cases', 'k1'), { stage: 'quote', notes: 'c', id: 'k1' });
});

test('upsert keeps newer fields; unset removes; deletes win over older writes', async () => {
  await sys([up('quotes', 'q1', { a: 1, b: 2 }, 1000), pa('quotes', 'q1', { b: 3 }, 5000)]);
  assert.equal((await sys([up('quotes', 'q1', { a: 9, c: 1 }, 2000)])).results[0].status, 'partial');
  assert.deepEqual(await get('quotes', 'q1'), { a: 9, b: 3, id: 'q1', c: 1 });
  await sys([pa('quotes', 'q1', {}, 6000, { unset: ['c'] })]);
  assert.equal('c' in (await get('quotes', 'q1')), false);
  assert.equal((await sys([pa('quotes', 'q1', { c: 5 }, 5500)])).results[0].status, 'stale', 'an older write cannot bring an unset field back');
  await sys([rm('quotes', 'q1', 7000)]);
  assert.equal((await sys([up('quotes', 'q1', { a: 1 }, 6500)])).results[0].status, 'stale');
  assert.equal((await sys([pa('quotes', 'q1', { a: 1 }, 8000)])).results[0].status, 'stale', 'patching a deleted doc does nothing');
  assert.equal((await sys([up('quotes', 'q1', { a: 2 }, 8000)])).results[0].status, 'ok', 'a newer upsert brings it back');
  assert.deepEqual(await get('quotes', 'q1'), { id: 'q1', a: 2 });
  assert.equal((await sys([pa('nope', 'x', { a: 1 }, 1)])).results[0].status, 'missing');
  assert.equal((await sys([rm('quotes', 'q1', 7500)])).results[0].status, 'stale', 'a delete older than the last write loses');
});

test('ifUnset claims a field once', async () => {
  await sys([up('quotes', 'q1', { approvedVia: 'portal' }, 1000)]);
  const a = await sys([pa('quotes', 'q1', { followupsAt: 'x', followupsBy: 'u1' }, 2000, { ifUnset: 'followupsAt' })]);
  const b = await sys([pa('quotes', 'q1', { followupsAt: 'y', followupsBy: 'u2' }, 2001, { ifUnset: 'followupsAt' })]);
  assert.deepEqual([a.results[0].status, b.results[0].status], ['ok', 'conflict']);
  assert.equal((await get('quotes', 'q1')).followupsBy, 'u1');
});

test('clocks that run ahead are clamped to server time', async () => {
  await sys([up('cases', 'k1', { a: 1 }, now() + 3600_000)]);
  assert.equal((await sys([pa('cases', 'k1', { a: 2 })])).results[0].status, 'ok');
});

test('results carry the record\'s final seq; the feed row moves', async () => {
  const r = await sys([up('a', '1', { x: 1 }), pa('a', '1', { y: 2 }), up('b', '2', {})]);
  assert.equal(r.results[0].seq, r.results[1].seq, 'both ops on one record report its final seq');
  assert.ok(r.results[2].seq > r.results[1].seq);
  assert.equal(Number((await pool.query('select seq from public.sync_feed')).rows[0].seq), Number(r.seq));
  assert.deepEqual(await get('a', '1'), { x: 1, id: '1', y: 2 });
});

test('validation: bad ops are refused as a whole', async () => {
  await assert.rejects(sys([{ op: 'zap', collection: 'a', id: '1', at: 1 }]), /op לא תקין/);
  await assert.rejects(sys([up('Bad', '1', {})]), /collection/);
  await assert.rejects(sys([up('a', 'x y', {})]), /id/);
  await assert.rejects(sys([rm('config', 'org')]), /אי אפשר למחוק/);
  await assert.rejects(sys([]), /מערך לא ריק/);
});

test('cleaning: secrets, device settings and unsafe links never get stored', async () => {
  await sys([
    up('users', 'u9', { name: 'x', role: 'agent', password: 'p', tempPassword: 't' }),
    up('settings', 'whatever', { depositPct: 20, serverUrl: 'http://x', anthropicKey: 'sk' }),
    up('suppliers', 's1', { name: 'a', website: 'javascript:alert(1)' }),
    up('suppliers', 's2', { name: 'b', website: 'https://ok.co.il' }),
    up('notifications', 'n1', { text: 'x', link: '//evil.com', userId: 'u-admin' }),
  ]);
  assert.deepEqual(await get('users', 'u9'), { name: 'x', role: 'agent', id: 'u9' });
  assert.deepEqual(await get('settings', 'org'), { depositPct: 20, id: 'org' });
  assert.equal((await get('suppliers', 's1')).website, undefined);
  assert.equal((await get('suppliers', 's2')).website, 'https://ok.co.il');
  assert.equal((await get('notifications', 'n1')).link, undefined);
});

test('counters reserve unique blocks', async () => {
  assert.deepEqual(await as(U.agent, 'select public.db_reserve($1, $2)', ['case', 5]), { key: 'case', from: 1, to: 5 });
  assert.deepEqual(await as(U.agent, 'select public.db_reserve($1, $2)', ['case', 1]), { key: 'case', from: 6, to: 6 });
  await assert.rejects(as(U.agent, 'select public.db_reserve($1, $2)', ['case', 101]), /count/);
  assert.deepEqual((await pool.query(`select public.sys_reserve('case', 2) r`)).rows[0].r, { key: 'case', from: 7, to: 8 });
});

// ------------------------------------------------------------------ access

test('only active members get in; nobody without a session; sys_* only for the server', async () => {
  await assert.rejects(as(U.gone, 'select public.db_snapshot()'), /צריך להתחבר/);
  await assert.rejects(as('00000000-0000-0000-0000-0000000000ff', 'select public.db_me()'), /צריך להתחבר/);
  await assert.rejects(as(U.admin, `select public.sys_dump()`), /permission denied/);
  await assert.rejects(as(U.admin, `select public.sys_apply('[]'::jsonb, 'x')`), /permission denied/);
  await assert.rejects(as(U.admin, 'select count(*) from app.entities'), /permission denied/);
  const me = await as(U.agent, 'select public.db_me()');
  assert.equal(me.user.id, 'u-agent');
  assert.equal(me.mustChange, false);
});

// ------------------------------------------------------------------ read scope (server/test/security.test.js)

test('read scope: money, costs, balances and the engine state stay with the managers', async () => {
  await sys([
    up('money', 'mn1', { caseId: 'k1', kind: 'payment', amount: 1000 }),
    up('money', 'mn2', { caseId: 'k1', kind: 'commission', amount: 300, agentId: 'u-agent' }),
    up('catalog', 'i1', { name: 'מזגן', price: 3000, cost: 1800 }),
    up('suppliers', 's1', { name: 'ספק' }),
    up('customers', 'c1', { name: 'לוי', balance: { amount: 500 }, idNumber: '123', sync: { status: 'error', error: 'Priority: internal' } }),
    up('quotes', 'q1', { caseId: 'k1', number: 'Q-1', status: 'approved', discountPct: 10, lines: [{ id: 'l1', description: 'מזגן', qty: 2, unitPrice: 3000, aiReason: 'x' }] }),
    up('quotes', 'q2', { caseId: 'k1', number: 'Q-2', status: 'sent', lines: [] }),
    up('integrations', 'priority', { engine: { active: true, mode: 'live' }, lastError: 'secret' }),
  ]);
  const a = await snapshot(U.admin);
  assert.equal(a.collections.money.length, 2);
  assert.equal(a.collections.catalog[0].cost, 1800);

  const g = await snapshot(U.agent);
  assert.deepEqual(g.collections.money.map((m) => m.id), ['mn2']);
  assert.equal(g.collections.catalog[0].cost, undefined);
  const c1 = g.collections.customers[0];
  assert.equal(c1.balance, undefined);
  assert.equal(c1.idNumber, '123');
  assert.equal(c1.sync.status, 'error');
  assert.doesNotMatch(c1.sync.error, /internal/);
  assert.deepEqual(g.collections.integrations, [{ id: 'priority', engine: { active: true } }]);
  assert.equal(g.collections.quotes.length, 2);

  const i = await snapshot(U.installer);
  assert.deepEqual(i.collections.money, []);
  assert.deepEqual(i.collections.suppliers, [], 'hidden collections arrive empty');
  assert.equal(i.collections.customers[0].idNumber, undefined);
  assert.deepEqual(i.collections.quotes.map((q) => q.id), ['q1']);
  assert.deepEqual(i.collections.quotes[0].lines, [{ id: 'l1', description: 'מזגן', qty: 2, unitPrice: 0 }]);
  assert.equal(i.collections.quotes[0].discountPct, undefined);
});

test('read scope applies to changes and fetch: hidden records go out as deleted', async () => {
  const before = (await as(U.installer, 'select public.db_changes(0)')).seq;
  await sys([up('money', 'mn9', { caseId: 'k1', kind: 'payment', amount: 77 })]);
  const ch = await as(U.installer, 'select public.db_changes($1)', [Number(before)]);
  const m = ch.changes.find((x) => x.id === 'mn9');
  assert.equal(m.del, true);
  assert.equal(m.data, undefined);
  const f = await as(U.installer, 'select public.db_fetch($1::jsonb)', [JSON.stringify([{ c: 'money', id: 'mn9' }, { c: 'money', id: 'nope' }])]);
  assert.deepEqual(f.items.map((x) => [x.id, x.del, x.data]), [['mn9', true, undefined], ['nope', true, undefined]]);
});

// ------------------------------------------------------------------ write permissions (server/test/security.test.js)

test('managers only: users, config, settings; the engine state is the server\'s', async () => {
  const r = await ops(U.agent, [pa('users', 'u-agent', { role: 'admin' }), up('settings', 'org', { depositPct: 5 }), up('integrations', 'priority', { x: 1 })]);
  assert.deepEqual(statuses(r), ['denied', 'denied', 'denied']);
  const o = await ops(U.office, [up('settings', 'org', { depositPct: 30 }), pa('users', 'u-agent', { title: 'x' }), pa('users', 'u-admin', { title: 'x' })]);
  assert.deepEqual(statuses(o), ['ok', 'ok', 'denied'], 'only an admin changes an admin');
});

test('the last active admin cannot be removed or demoted', async () => {
  const r = await ops(U.admin, [pa('users', 'u-admin', { active: false })]);
  assert.deepEqual(r.results[0], { status: 'denied', error: 'last_admin' });
  await ops(U.admin, [up('users', 'u-admin2', { name: 'שני', role: 'admin', active: true })]);
  assert.equal((await ops(U.admin, [pa('users', 'u-admin', { role: 'office' })])).results[0].status, 'ok');
});

test('installer: field work only, stock moves via own van, no deletes of what Priority holds', async () => {
  const van = 'רכב — סאמר חלבי';
  await sys([up('cases', 'k1', { stage: 'scheduled', title: 'x' }), up('units', 'un1', { serial: 'S' })]);
  const r = await ops(U.installer, [
    up('stockMoves', 'sm1', { kind: 'use', itemId: 'i1', qty: 2, from: van, userId: 'u-inst' }),
    up('stockMoves', 'sm2', { kind: 'transfer', itemId: 'i1', qty: 5, from: 'מחסן ראשי', to: 'רכב — יעקב דהן' }),
    up('stockMoves', 'sm3', { kind: 'use', itemId: 'i1', qty: 99999, from: van }),
    up('stockMoves', 'sm4', { kind: 'receive', itemId: 'i1', qty: 1, to: van }),
    rm('units', 'un1'),
    pa('cases', 'k1', { stage: 'completed', closedAt: 'x' }),
    pa('cases', 'k1', { title: 'שונה' }),
    up('quotes', 'q9', { caseId: 'k1' }),
    up('contracts', 'ct1', { status: 'proposed' }),
    up('contracts', 'ct2', { status: 'active' }),
  ]);
  assert.deepEqual(statuses(r), ['ok', 'denied', 'denied', 'denied', 'denied', 'ok', 'denied', 'denied', 'ok', 'denied']);
});

test('non-managers: append-only log; own chat (reading allowed); short in-app notifications; decided leaves stay', async () => {
  await sys([
    up('activities', 'a1', { kind: 'note', text: 'מקור' }),
    up('chat', 'ch1', { threadId: 'case:k1', fromId: 'u-admin', body: 'שלום', readBy: ['u-admin'] }),
    up('leaves', 'lv1', { userId: 'u-agent', status: 'approved' }),
    up('leaves', 'lv2', { userId: 'u-agent', status: 'pending' }),
  ]);
  const r = await ops(U.agent, [
    up('activities', 'a2', { kind: 'note', text: 'חדש' }),
    pa('activities', 'a1', { text: 'שוכתב' }),
    pa('chat', 'ch1', { readBy: ['u-admin', 'u-agent'] }),
    pa('chat', 'ch1', { body: 'זויף' }),
    up('chat', 'ch2', { threadId: 'case:k1', fromId: 'u-admin', body: 'בשם אחר', readBy: [] }),
    up('chat', 'ch3', { threadId: 'case:k1', fromId: 'u-agent', body: 'שלי', readBy: [] }),
    up('notifications', 'n9', { userId: 'u-admin', text: 'x'.repeat(301), link: '/cases/k1' }),
    up('notifications', 'n10', { userId: 'u-admin', text: 'ראו', link: '/cases/k1' }),
    pa('leaves', 'lv1', { to: '2026-11-20' }),
    pa('leaves', 'lv2', { status: 'approved' }),
    pa('leaves', 'lv2', { status: 'cancelled' }),
    up('leaves', 'lv3', { userId: 'u-office', status: 'pending' }),
  ]);
  assert.deepEqual(statuses(r), ['ok', 'denied', 'ok', 'denied', 'denied', 'ok', 'denied', 'ok', 'denied', 'denied', 'ok', 'denied']);
});

test('money lines marked as Priority\'s cannot be made or changed from the app', async () => {
  await sys([up('money', 'pv1', { kind: 'payment', amount: 5, source: 'priority' })], 'priority-sync');
  const r = await ops(U.admin, [up('money', 'fake', { kind: 'payment', amount: 1, source: 'priority' }), pa('money', 'pv1', { amount: 1 })]);
  assert.deepEqual(statuses(r), ['denied', 'denied']);
});

test('docs: a stored file only by its uploader or under its own case', async () => {
  await pool.query(`insert into storage.objects (bucket_id, name, owner) values ('files', $1, $2)`, [`${U.office}/f${'a'.repeat(24)}-x.pdf`, U.office]);
  await as(U.office, 'select public.db_register_file($1, $2, $3, $4, $5, $6, $7)', [`f${'a'.repeat(24)}`, `${U.office}/f${'a'.repeat(24)}-x.pdf`, 'k1', 'office', 'x.pdf', 'application/pdf', 4]);
  const fileId = `f${'a'.repeat(24)}`;
  const r = await ops(U.agent, [
    up('docs', 'd1', { caseId: 'k2', fileId }),
    up('docs', 'd2', { caseId: 'k1', fileId }),
    up('docs', 'd3', { caseId: 'k1', fileId: `f${'b'.repeat(24)}` }),
  ]);
  assert.deepEqual(statuses(r), ['denied', 'ok', 'denied']);
  // registering someone else's upload is refused
  await pool.query(`insert into storage.objects (bucket_id, name, owner) values ('files', $1, $2)`, [`${U.office}/f${'c'.repeat(24)}-y.pdf`, U.office]);
  await assert.rejects(as(U.agent, 'select public.db_register_file($1, $2)', [`f${'c'.repeat(24)}`, `${U.office}/f${'c'.repeat(24)}-y.pdf`]), /בתיקייה של המשתמש/);
});

test('first-run import: only into an empty database, newest-first order kept', async () => {
  await pool.query('truncate app.entities, app.counters, app.members');
  const snap = { collections: { tasks: [{ id: 't3' }, { id: 't2' }, { id: 't1' }], users: [{ id: 'u1', name: 'a', role: 'admin', password: 'x' }] }, config: { theme: 'genair' }, settings: { depositPct: 20, anthropicKey: 'sk' }, counters: { case: 10 } };
  await pool.query('select public.sys_import($1::jsonb)', [JSON.stringify(snap)]);
  await pool.query(`select public.sys_set_member($1, 'u1', 'u1@test.local', false)`, [U.admin]);
  const s = await snapshot(U.admin);
  assert.deepEqual(s.collections.tasks.map((t) => t.id), ['t3', 't2', 't1']);
  assert.deepEqual(s.config, { theme: 'genair', id: 'org' });
  assert.deepEqual(s.settings, { depositPct: 20, id: 'org' });
  assert.equal(s.collections.users[0].password, undefined);
  assert.equal(s.counters.case, 10);
  await assert.rejects(pool.query('select public.sys_import($1::jsonb)', [JSON.stringify(snap)]), /already_bootstrapped/);
});

test('server functions refuse signed-in users even if a grant lets them call', async () => {
  await pool.query('grant execute on function public.sys_dump() to authenticated');
  try {
    await assert.rejects(as(U.admin, 'select public.sys_dump()'), /server_only/);
  } finally {
    await pool.query('revoke execute on function public.sys_dump() from authenticated');
  }
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
    await c.query('set local role service_role');
    assert.ok((await c.query('select public.sys_dump() d')).rows[0].d.collections.users);
    await c.query('rollback');
  } finally {
    c.release();
  }
});
