import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, useEnv } from './helpers.js';
import { bearer, bootstrapOrg, loginAs } from './fixtures.js';

const op = (o) => ({ at: Date.now(), ...o });

async function org(t) {
  useEnv(t);
  const s = await startServer(t);
  const { token: admin } = await bootstrapOrg(s);
  const agent = await loginAs(s, admin, 'u-agent1', '0502201102');
  const installer = await loginAs(s, admin, 'u-inst1', '0502201105');
  const office = await loginAs(s, admin, 'u-office', 'office@genair.co.il');
  return { s, admin, agent, installer, office };
}

const ops = (s, token, list, clientId) => s.request('POST', '/api/db/ops', { headers: bearer(token), body: { ops: list, clientId } });

test('db routes need a session', async (t) => {
  useEnv(t);
  const s = await startServer(t);
  await bootstrapOrg(s);
  for (const [m, p] of [['GET', '/api/db/snapshot'], ['GET', '/api/db/changes?since=0'], ['GET', '/api/db/events'], ['POST', '/api/db/ops'], ['POST', '/api/db/counters/reserve']]) {
    assert.equal((await s.request(m, p, { body: m === 'POST' ? {} : undefined })).status, 401, `${m} ${p}`);
  }
});

test('ops: validation errors', async (t) => {
  const { s, agent } = await org(t);
  const bad = async (list) => (await ops(s, agent, list)).status;
  assert.equal(await bad([]), 400);
  assert.equal(await bad([op({ op: 'drop', collection: 'cases', id: 'k1' })]), 400);
  assert.equal(await bad([op({ op: 'upsert', collection: 'Cases!', id: 'k1', data: {} })]), 400);
  assert.equal(await bad([op({ op: 'upsert', collection: 'cases', id: '../x', data: {} })]), 400);
  assert.equal(await bad([op({ op: 'upsert', collection: 'cases', id: 'k9', data: [] })]), 400);
  assert.equal(await bad([{ op: 'upsert', collection: 'cases', id: 'k9', data: {}, at: 'yesterday' }]), 400);
  assert.equal(await bad(Array.from({ length: 501 }, (_, i) => op({ op: 'remove', collection: 'tasks', id: `t${i}` }))), 400);
});

test('permissions: managers only for users/config/settings; installers limited; notifications and leaves are personal', async (t) => {
  const { s, admin, agent, installer, office } = await org(t);
  const status = async (token, o) => (await ops(s, token, [op(o)])).json.results[0].status;

  assert.equal(await status(agent, { op: 'patch', collection: 'users', id: 'u-agent1', data: { title: 'x' } }), 'denied');
  assert.equal(await status(agent, { op: 'patch', collection: 'config', data: { theme: 'navy' } }), 'denied');
  assert.equal(await status(agent, { op: 'patch', collection: 'settings', data: { vatPct: 17 } }), 'denied');
  assert.equal(await status(office, { op: 'patch', collection: 'settings', data: { vatPct: 17, serverUrl: 'x' } }), 'ok');
  assert.equal(await status(office, { op: 'patch', collection: 'users', id: 'u-agent1', data: { title: 'סוכן בכיר', password: 'p' } }), 'ok');
  assert.equal(await status(office, { op: 'patch', collection: 'users', id: 'u-agent1', data: { role: 'admin' } }), 'denied', 'only admins grant admin');
  assert.equal(await status(office, { op: 'patch', collection: 'users', id: 'u-admin', data: { title: 'x' } }), 'denied', 'only admins edit admins');
  assert.equal(await status(admin, { op: 'patch', collection: 'users', id: 'u-admin', data: { active: false } }), 'denied', 'never remove the last admin');
  assert.equal(await status(admin, { op: 'patch', collection: 'users', id: 'u-agent1', data: { role: 'boss' } }), 'denied');

  assert.equal(await status(agent, { op: 'patch', collection: 'cases', id: 'k1', data: { notes: 'agent' } }), 'ok');
  assert.equal(await status(installer, { op: 'patch', collection: 'cases', id: 'k1', data: { notes: 'x' } }), 'denied');
  assert.equal(await status(installer, { op: 'patch', collection: 'cases', id: 'k1', data: { stage: 'completed', updatedAt: 'now' } }), 'ok');
  assert.equal(await status(installer, { op: 'upsert', collection: 'quotes', id: 'qx', data: {} }), 'denied');
  assert.equal(await status(installer, { op: 'patch', collection: 'appointments', id: 'ap1', data: { status: 'done' } }), 'ok');
  assert.equal(await status(installer, { op: 'upsert', collection: 'contracts', id: 'kt1', data: { status: 'proposed' } }), 'ok');
  assert.equal(await status(installer, { op: 'upsert', collection: 'contracts', id: 'kt2', data: { status: 'active' } }), 'denied');

  assert.equal(await status(installer, { op: 'upsert', collection: 'notifications', id: 'n9', data: { userId: 'u-office', text: 'x' } }), 'ok', 'anyone may notify anyone');
  assert.equal(await status(installer, { op: 'patch', collection: 'notifications', id: 'n1', data: { read: true } }), 'denied', 'n1 is the agent\'s');
  assert.equal(await status(agent, { op: 'patch', collection: 'notifications', id: 'n1', data: { read: true } }), 'ok');
  assert.equal(await status(installer, { op: 'upsert', collection: 'leaves', id: 'lv1', data: { userId: 'u-inst1', status: 'pending' } }), 'ok');
  assert.equal(await status(installer, { op: 'patch', collection: 'leaves', id: 'lv1', data: { status: 'approved' } }), 'denied');
  assert.equal(await status(office, { op: 'patch', collection: 'leaves', id: 'lv1', data: { status: 'approved' } }), 'ok');

  const snap = (await s.request('GET', '/api/db/snapshot', { headers: bearer(agent) })).json;
  assert.equal(snap.collections.users.find((u) => u.id === 'u-agent1').password, undefined);
  assert.equal(snap.settings.serverUrl, undefined);
  assert.equal(snap.collections.cases.find((k) => k.id === 'k1').stage, 'completed');
});

test('changes: immediate, long-poll wakes on a write, reset when ahead', async (t) => {
  const { s, admin, agent } = await org(t);
  const seq0 = (await s.request('GET', '/api/db/snapshot', { headers: bearer(agent) })).json.seq;
  const empty = await s.request('GET', `/api/db/changes?since=${seq0}&wait=0`, { headers: bearer(agent) });
  assert.deepEqual(empty.json, { seq: seq0, changes: [] });

  const started = Date.now();
  const pending = s.request('GET', `/api/db/changes?since=${seq0}&wait=10`, { headers: bearer(agent) });
  await new Promise((r) => setTimeout(r, 150));
  const w = await ops(s, admin, [op({ op: 'patch', collection: 'cases', id: 'k1', data: { stage: 'survey' } })], 'admin-dev');
  assert.equal(w.json.results[0].status, 'ok');
  const r = await pending;
  assert.ok(Date.now() - started < 3000, 'answered as soon as the write landed');
  assert.equal(r.json.changes.length, 1);
  assert.equal(r.json.changes[0].c, 'cases');
  assert.equal(r.json.changes[0].data.stage, 'survey');
  assert.equal(r.json.seq, w.json.seq);

  const ahead = await s.request('GET', `/api/db/changes?since=${w.json.seq + 50}&wait=0`, { headers: bearer(agent) });
  assert.equal(ahead.json.reset, true);
  assert.equal((await s.request('GET', '/api/db/changes?since=abc', { headers: bearer(agent) })).status, 400);
});

function openEvents(port, token, since) {
  return new Promise((resolve, reject) => {
    const events = [];
    const waiters = [];
    const req = http.request({ host: '127.0.0.1', port, path: `/api/db/events${since !== undefined ? `?since=${since}` : ''}`, headers: bearer(token) }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = { event: 'message', data: '' };
          for (const line of block.split('\n')) {
            if (line.startsWith('event: ')) ev.event = line.slice(7);
            else if (line.startsWith('data: ')) ev.data += line.slice(6);
            else if (line.startsWith('id: ')) ev.id = line.slice(4);
          }
          if (!ev.data) continue;
          ev.json = JSON.parse(ev.data);
          events.push(ev);
          waiters.splice(0).forEach((w) => w());
        }
      });
      resolve({
        status: res.statusCode,
        headers: res.headers,
        events,
        next: async (name) => {
          for (;;) {
            const hit = events.find((e) => e.event === name && !e.taken);
            if (hit) {
              hit.taken = true;
              return hit;
            }
            await new Promise((r) => waiters.push(r));
          }
        },
        close: () => req.destroy(),
      });
    });
    req.on('error', (e) => (e.code === 'ECONNRESET' ? null : reject(e)));
    req.end();
  });
}

test('SSE: hello, backlog since a cursor, live changes from another user, notification for user B', async (t) => {
  const { s, admin, agent } = await org(t);
  const seq0 = (await s.request('GET', '/api/db/snapshot', { headers: bearer(agent) })).json.seq;
  await ops(s, admin, [op({ op: 'patch', collection: 'cases', id: 'k2', data: { notes: 'before connect' } })]);

  const es = await openEvents(s.port, agent, seq0);
  t.after(() => es.close());
  assert.equal(es.status, 200);
  assert.match(es.headers['content-type'], /text\/event-stream/);
  assert.equal((await es.next('hello')).json.user, 'u-agent1');
  const backlog = await es.next('changes');
  assert.equal(backlog.json.changes[0].data.notes, 'before connect');

  await ops(s, admin, [op({ op: 'upsert', collection: 'notifications', id: 'nB', data: { userId: 'u-agent1', text: 'תיק חדש בשבילך', read: false, at: new Date().toISOString() } })], 'admin-dev');
  const live = await es.next('changes');
  assert.equal(live.json.origin, 'admin-dev');
  assert.equal(live.json.changes[0].c, 'notifications');
  assert.equal(live.json.changes[0].data.text, 'תיק חדש בשבילך');
  assert.equal(Number(live.id), live.json.seq);
});

test('counters: reserved blocks never overlap between users', async (t) => {
  const { s, admin, agent } = await org(t);
  const a = await s.request('POST', '/api/db/counters/reserve', { headers: bearer(admin), body: { key: 'case', count: 10 } });
  const b = await s.request('POST', '/api/db/counters/reserve', { headers: bearer(agent), body: { key: 'case', count: 10 } });
  assert.deepEqual(a.json, { key: 'case', from: 143, to: 152 });
  assert.deepEqual(b.json, { key: 'case', from: 153, to: 162 });
  assert.equal((await s.request('POST', '/api/db/counters/reserve', { headers: bearer(agent), body: { key: 'case', count: 1000 } })).status, 400);
  assert.equal((await s.request('POST', '/api/db/counters/reserve', { headers: bearer(agent), body: { key: '__proto__ x' } })).status, 400);
});

test('fetch returns the server copy after a denied write', async (t) => {
  const { s, installer } = await org(t);
  const w = await ops(s, installer, [op({ op: 'patch', collection: 'cases', id: 'k1', data: { title: 'hacked' } })]);
  assert.equal(w.json.results[0].status, 'denied');
  const f = await s.request('POST', '/api/db/fetch', { headers: bearer(installer), body: { items: [{ c: 'cases', id: 'k1' }, { c: 'cases', id: 'nope' }] } });
  assert.equal(f.json.items[0].data.title, 'מיזוג דירה — לוי');
  assert.equal(f.json.items[1].del, true);
});

test('token refresh header after 15 minutes', async (t) => {
  const { s, admin } = await org(t);
  const realNow = Date.now;
  t.after(() => {
    Date.now = realNow;
  });
  Date.now = () => realNow() + 16 * 60_000;
  const r = await s.request('GET', '/api/auth/me', { headers: bearer(admin) });
  assert.equal(r.status, 200);
  assert.ok(r.headers['x-auth-token'], 'a fresh token comes back');
  assert.notEqual(r.headers['x-auth-token'], admin);
});
