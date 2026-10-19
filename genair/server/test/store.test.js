import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DocStore } from '../src/db/store.js';
import { JsonFileAdapter, MemoryAdapter } from '../src/db/adapters.js';

const store = (opts = {}) => new DocStore({ adapter: new MemoryAdapter(), flushMs: 5, ...opts });
const up = (collection, id, data, at) => ({ op: 'upsert', collection, id, data, at });
const pa = (collection, id, data, at, extra = {}) => ({ op: 'patch', collection, id, data, at, ...extra });
const rm_ = (collection, id, at) => ({ op: 'remove', collection, id, at });

test('upsert / patch / remove with a growing change sequence', async () => {
  const s = await store().init();
  const r1 = s.applyOps([up('cases', 'k1', { title: 'א', stage: 'lead' }, 1000)]);
  assert.equal(r1.seq, 1);
  assert.deepEqual(r1.results, [{ status: 'ok', seq: 1 }]);
  assert.deepEqual(s.get('cases', 'k1'), { title: 'א', stage: 'lead', id: 'k1' });
  const r2 = s.applyOps([pa('cases', 'k1', { stage: 'quote' }, 2000), up('tasks', 't1', { title: 'x' }, 2000)]);
  assert.equal(r2.seq, 3);
  assert.equal(s.get('cases', 'k1').stage, 'quote');
  s.applyOps([rm_('tasks', 't1', 3000)]);
  assert.equal(s.get('tasks', 't1'), undefined, 'soft deleted');
  const ch = s.changesSince(1);
  assert.deepEqual(ch.changes.map((c) => [c.c, c.id, c.seq, Boolean(c.del)]), [['cases', 'k1', 2, false], ['tasks', 't1', 4, true]]);
  assert.equal(s.changesSince(99).reset, true, 'a cursor ahead of the server forces a reload');
});

test('per-field last-write-wins: concurrent patches to different fields both survive', async () => {
  const s = await store().init();
  s.applyOps([up('cases', 'k1', { stage: 'lead', notes: 'a' }, 1000)]);
  s.applyOps([pa('cases', 'k1', { stage: 'quote' }, 3000)]); // office, later clock
  const late = s.applyOps([pa('cases', 'k1', { notes: 'b' }, 2000)]); // agent's older edit arrives late
  assert.equal(late.results[0].status, 'ok');
  assert.deepEqual(s.get('cases', 'k1'), { stage: 'quote', notes: 'b', id: 'k1' });
  const stale = s.applyOps([pa('cases', 'k1', { stage: 'survey' }, 2500)]);
  assert.equal(stale.results[0].status, 'stale');
  assert.equal(s.get('cases', 'k1').stage, 'quote');
  const partial = s.applyOps([pa('cases', 'k1', { stage: 'lost', notes: 'c' }, 2900)]);
  assert.equal(partial.results[0].status, 'partial');
  assert.deepEqual(s.get('cases', 'k1'), { stage: 'quote', notes: 'c', id: 'k1' });
});

test('upsert replaces the document but keeps newer fields; unset removes; deletes win over older writes', async () => {
  const s = await store().init();
  s.applyOps([up('quotes', 'q1', { a: 1, b: 2 }, 1000), pa('quotes', 'q1', { b: 3 }, 5000)]);
  const r = s.applyOps([up('quotes', 'q1', { a: 9, c: 1 }, 2000)]);
  assert.equal(r.results[0].status, 'partial');
  assert.deepEqual(s.get('quotes', 'q1'), { a: 9, b: 3, id: 'q1', c: 1 });
  s.applyOps([pa('quotes', 'q1', {}, 6000, { unset: ['c'] })]);
  assert.equal('c' in s.get('quotes', 'q1'), false);
  assert.equal(s.applyOps([pa('quotes', 'q1', { c: 5 }, 5500)]).results[0].status, 'stale', 'an older write cannot bring an unset field back');

  s.applyOps([rm_('quotes', 'q1', 7000)]);
  assert.equal(s.applyOps([up('quotes', 'q1', { a: 1 }, 6500)]).results[0].status, 'stale');
  assert.equal(s.applyOps([pa('quotes', 'q1', { a: 1 }, 8000)]).results[0].status, 'stale', 'patching a deleted doc does nothing');
  assert.equal(s.applyOps([up('quotes', 'q1', { a: 2 }, 8000)]).results[0].status, 'ok', 'a newer upsert brings it back');
  assert.deepEqual(s.get('quotes', 'q1'), { id: 'q1', a: 2 });
  assert.equal(s.applyOps([pa('nope', 'x', { a: 1 }, 1)]).results[0].status, 'missing');
  assert.equal(s.applyOps([rm_('quotes', 'q1', 7500)]).results[0].status, 'stale', 'a delete older than the last write loses');
});

test('ifUnset claims a field once (used to run portal follow-ups on one device only)', async () => {
  const s = await store().init();
  s.applyOps([up('quotes', 'q1', { approvedVia: 'portal' }, 1000)]);
  const a = s.applyOps([pa('quotes', 'q1', { followupsAt: 'x', followupsBy: 'u1' }, 2000, { ifUnset: 'followupsAt' })]);
  const b = s.applyOps([pa('quotes', 'q1', { followupsAt: 'y', followupsBy: 'u2' }, 2001, { ifUnset: 'followupsAt' })]);
  assert.equal(a.results[0].status, 'ok');
  assert.equal(b.results[0].status, 'conflict');
  assert.equal(s.get('quotes', 'q1').followupsBy, 'u1');
});

test('clocks that run ahead are clamped to server time', async () => {
  let now = 10_000;
  const s = await store({ now: () => now }).init();
  s.applyOps([up('cases', 'k1', { a: 1 }, 10_000 + 3600_000)]); // an hour ahead
  now = 20_000;
  assert.equal(s.applyOps([pa('cases', 'k1', { a: 2 }, 20_000)]).results[0].status, 'ok');
});

test('snapshot keeps the newest-first order; counters reserve unique blocks; check() can deny', async () => {
  const s = await store().init();
  s.importSnapshot({ collections: { tasks: [{ id: 't3' }, { id: 't2' }, { id: 't1' }] }, config: { theme: 'genair' }, settings: { depositPct: 20 }, counters: { case: 10 } });
  s.applyOps([up('tasks', 't4', {}, Date.now())]);
  const snap = s.snapshot();
  assert.deepEqual(snap.collections.tasks.map((t) => t.id), ['t4', 't3', 't2', 't1']);
  assert.deepEqual(snap.config, { theme: 'genair', id: 'org' });
  assert.equal(snap.settings.depositPct, 20);
  assert.equal(snap.collections.config, undefined, 'singletons are not collections');
  assert.deepEqual(s.reserve('case', 5), { key: 'case', from: 11, to: 15 });
  assert.deepEqual(s.reserve('case', 1), { key: 'case', from: 16, to: 16 });
  assert.deepEqual(s.reserve('po', 2), { key: 'po', from: 1, to: 2 });
  const denied = s.applyOps([up('tasks', 't9', {}, Date.now())], { check: () => 'nope' });
  assert.deepEqual(denied.results[0], { status: 'denied', error: 'nope' });
  assert.equal(s.get('tasks', 't9'), undefined);
});

test('change events carry the batch; one seq per entity per batch', async () => {
  const s = await store().init();
  const seen = [];
  s.on('change', (e) => seen.push(e));
  s.applyOps([up('a', '1', { x: 1 }, 1), pa('a', '1', { y: 2 }, 2), up('b', '2', {}, 3)], { clientId: 'dev1' });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].origin, 'dev1');
  assert.deepEqual(seen[0].changes.map((c) => [c.c, c.id, c.seq]), [['a', '1', 1], ['b', '2', 2]]);
  assert.deepEqual(seen[0].changes[0].data, { x: 1, id: '1', y: 2 });
});

test('JSON file adapter: atomic save, reload, daily backup, refuses a corrupt file', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'genair-db-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const a = await new DocStore({ adapter: new JsonFileAdapter(dir), flushMs: 1 }).init();
  a.applyOps([up('cases', 'k1', { title: 'שלום' }, 1000)]);
  a.reserve('case', 3);
  a.ensureSecret();
  await a.flush();
  const raw = JSON.parse(await readFile(join(dir, 'db.json'), 'utf8'));
  assert.equal(raw.collections.cases[0].data.title, 'שלום');

  const b = await new DocStore({ adapter: new JsonFileAdapter(dir) }).init();
  assert.equal(b.get('cases', 'k1').title, 'שלום');
  assert.equal(b.seq, 1);
  assert.equal(b.auth.secret, a.auth.secret);
  assert.deepEqual(b.reserve('case', 1), { key: 'case', from: 4, to: 4 });
  b.applyOps([pa('cases', 'k1', { title: 'עדכון' }, 2000)]);
  await b.flush();
  await new Promise((r) => setTimeout(r, 5));
  const backups = await import('node:fs/promises').then((fs) => fs.readdir(join(dir, 'backups')));
  assert.equal(backups.length, 1);

  await writeFile(join(dir, 'db.json'), '{ broken');
  await assert.rejects(new DocStore({ adapter: new JsonFileAdapter(dir) }).init(), /not valid JSON/);
});

test('debounced flush writes once for a burst of changes', async () => {
  const adapter = new MemoryAdapter();
  const s = await new DocStore({ adapter, flushMs: 20 }).init();
  for (let i = 0; i < 20; i++) s.applyOps([up('tasks', `t${i}`, {}, i + 1)]);
  assert.equal(adapter.saves, 0);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(adapter.saves, 1);
  const reloaded = await new DocStore({ adapter }).init();
  assert.equal(reloaded.list('tasks').length, 20);
});
