// The same bundle under Deno, the runtime of Supabase Edge Functions: started the way Supabase starts it
// (its Deno.serve handler), against the fake Supabase. Skipped when there is no deno (DENO_BIN or on PATH).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startFakeSupabase } from './fake-supabase.js';

const here = dirname(fileURLToPath(import.meta.url));
const DENO = process.env.DENO_BIN || 'deno';
const hasDeno = spawnSync(DENO, ['--version']).status === 0;

let fake;
let deno;
let base;

before(async () => {
  if (!hasDeno) return;
  fake = await startFakeSupabase({ db: 'genair_edge_deno' });
  // catch the handler the bundle gives Deno.serve and serve it on a free port
  const dir = mkdtempSync(join(tmpdir(), 'genair-deno-'));
  const main = join(dir, 'main.js');
  writeFileSync(main, `
    let handler;
    const real = Deno.serve;
    Deno.serve = (h) => { handler = h; return { finished: Promise.resolve() }; };
    await import(${JSON.stringify(pathToFileURL(join(here, '../api/dist/index.js')).href)});
    Deno.serve = real;
    Deno.serve({ port: 0, hostname: '127.0.0.1', onListen: ({ port }) => console.log('LISTENING ' + port) }, handler);
  `);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/proxy/i.test(k)));
  deno = spawn(DENO, ['run', '--allow-net', '--allow-env', '--allow-read', '--no-prompt', main], {
    env: { ...env, ...fake.env, BOOTSTRAP_TOKEN: 'boot-deno-1', PRIORITY_MODE: 'off', PRIORITY_CRON_SECRET: 'cron-deno' },
    stdio: ['ignore', 'pipe', 'inherit'],
    detached: true, // its own process group: a launcher script (npm's deno) and the real binary go down together
  });
  base = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('deno did not start')), 30_000);
    deno.stdout.on('data', (b) => {
      const m = /LISTENING (\d+)/.exec(String(b));
      if (m) {
        clearTimeout(t);
        resolve(`http://127.0.0.1:${m[1]}/functions/v1`);
      }
    });
    deno.on('exit', (code) => reject(new Error(`deno exited (${code})`)));
  });
});

after(async () => {
  if (deno?.pid) {
    try {
      process.kill(-deno.pid, 'SIGTERM');
    } catch {
      /* gone */
    }
  }
  await fake?.close();
});

test('under Deno: health, bootstrap, file upload and download, portal, cron key', { skip: !hasDeno && 'deno is not installed', timeout: 60_000 }, async () => {
  const health = await (await fetch(`${base}/api/health`)).json();
  assert.deepEqual(health, { ok: true, db: { mode: 'supabase', ready: true, bootstrapped: false, bootstrapToken: true } });

  const snapshot = {
    collections: {
      users: [{ id: 'u1', name: 'דוד', role: 'admin', active: true, email: 'David@Example.com' }],
      customers: [{ id: 'c1', name: 'משפחת לוי', phone: '0541112222' }],
      cases: [{ id: 'k1', title: 'מזגן', customerId: 'c1', stage: 'lead' }],
    },
    counters: { service: 7 },
  };
  const boot = await fetch(`${base}/api/auth/bootstrap`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ snapshot, adminUserId: 'u1', password: 'deno-pass-1', bootstrapToken: 'boot-deno-1' }) });
  const b = await boot.json();
  assert.equal(boot.status, 201, JSON.stringify(b));
  assert.equal([...fake.auth.users.values()][0].email, 'david@example.com');
  const token = b.session.access_token;

  const me = await (await fetch(`${base}/api/health`, { headers: { authorization: `Bearer ${token}` } })).json();
  assert.ok(me.version);

  const data = Buffer.from('שלום מדנו');
  const up = await fetch(`${base}/api/files`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'text/plain', 'x-file-name': encodeURIComponent('הערה.txt') }, body: data });
  const u = await up.json();
  assert.equal(up.status, 201, JSON.stringify(u));
  const down = await fetch(`${base}/api/files/${u.fileId}`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(down.status, 200);
  assert.equal(down.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await down.arrayBuffer()), data);

  const k1 = await fake.get('cases', 'k1');
  const sc = await fetch(`${base}/api/portal/${k1.portal.token}/service`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'לא מקרר' }) });
  assert.equal(sc.status, 201);
  assert.equal((await sc.json()).number, 'SC-0008');

  const pre = await fetch(`${base}/api/files`, { method: 'OPTIONS', headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST' } });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-headers'), /apikey/);
  assert.equal((await fetch(`${base}/api/priority/cron`, { method: 'POST', headers: { 'x-cron-key': 'nope' } })).status, 401);
  assert.equal((await fetch(`${base}/api/whatsapp/inbox`)).status, 401);
});
