import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forbidFetch, startServer, useEnv } from './helpers.js';
import { ADMIN_PASSWORD, bearer, bootstrapOrg, loginAs, orgSnapshot } from './fixtures.js';
import { hashPassword, signToken, verifyPassword, verifyToken } from '../src/auth.js';
import { clientIp } from '../src/http.js';

test('scrypt hashes verify and differ per salt', async () => {
  const a = await hashPassword('סיסמה-ארוכה');
  const b = await hashPassword('סיסמה-ארוכה');
  assert.notEqual(a, b);
  assert.match(a, /^scrypt\$16384\$8\$1\$/);
  assert.equal(await verifyPassword('סיסמה-ארוכה', a), true);
  assert.equal(await verifyPassword('wrong', a), false);
  assert.equal(await verifyPassword('x', 'garbage'), false);
});

test('tokens: signature, expiry, tampering', () => {
  const now = Math.floor(Date.now() / 1000);
  const t = signToken({ sub: 'u1', sid: 's', pv: 1, iat: now, exp: now + 60 }, 'secret');
  assert.equal(verifyToken(t, 'secret').sub, 'u1');
  assert.equal(verifyToken(t, 'other'), null);
  assert.equal(verifyToken(t, 'secret', now + 61), null);
  const [h, , s] = t.split('.');
  const forged = `${h}.${Buffer.from(JSON.stringify({ sub: 'u-admin', sid: 's', pv: 1, iat: now, exp: now + 60 })).toString('base64url')}.${s}`;
  assert.equal(verifyToken(forged, 'secret'), null);
});

test('bootstrap: only while empty, strips secrets and device settings, returns an admin session', async (t) => {
  useEnv(t, { AUTH_SECRET: 'test-secret-1234567890' });
  forbidFetch(t);
  const s = await startServer(t);
  const h0 = await s.request('GET', '/api/health');
  assert.deepEqual(h0.json.db, { mode: 'memory', ready: true, bootstrapped: false, bootstrapToken: false });

  const bad = await s.request('POST', '/api/auth/bootstrap', { body: { snapshot: orgSnapshot(), adminUserId: 'u-agent1', password: ADMIN_PASSWORD } });
  assert.equal(bad.status, 400, 'the bootstrap user must be an admin');
  const short = await s.request('POST', '/api/auth/bootstrap', { body: { snapshot: orgSnapshot(), adminUserId: 'u-admin', password: '123' } });
  assert.equal(short.status, 400);

  const boot = await bootstrapOrg(s);
  assert.ok(boot.token);
  assert.equal(boot.user.id, 'u-admin');
  assert.equal(boot.user.password, undefined);
  const again = await s.request('POST', '/api/auth/bootstrap', { body: { snapshot: orgSnapshot(), adminUserId: 'u-admin', password: ADMIN_PASSWORD } });
  assert.equal(again.status, 409);
  assert.equal((await s.request('GET', '/api/health')).json.db.bootstrapped, true);

  const snap = await s.request('GET', '/api/db/snapshot', { headers: bearer(boot.token) });
  assert.equal(snap.status, 200);
  assert.ok(!snap.text.includes('leak-me'), 'password fields never stored');
  assert.ok(!snap.text.includes('scrypt$'), 'hashes never sent');
  assert.equal(snap.json.settings.serverUrl, undefined, 'device-only settings stay on the device');
  assert.equal(snap.json.settings.anthropicKey, undefined);
  assert.equal(snap.json.settings.depositPct, 20);
  assert.deepEqual(snap.json.counters, { case: 142, quote: 2, service: 313 });
  assert.equal(snap.json.collections.users.length, 4);
  assert.equal(snap.json.collections.cases.find((k) => k.id === 'k1').portal.token, 'TokenK1abcdefgh', 'strong portal links stay');
});

test('bootstrap replaces short demo portal links with random ones', async (t) => {
  useEnv(t);
  const s = await startServer(t);
  const snap = orgSnapshot();
  snap.collections.cases[0].portal.token = 'pt-k1';
  const r = await s.request('POST', '/api/auth/bootstrap', { body: { snapshot: snap, adminUserId: 'u-admin', password: ADMIN_PASSWORD } });
  const d = await s.request('GET', '/api/db/snapshot', { headers: bearer(r.json.token) });
  const tok = d.json.collections.cases.find((k) => k.id === 'k1').portal.token;
  assert.match(tok, /^[A-Za-z0-9]{18}$/);
  assert.equal((await s.request('GET', '/api/portal/pt-k1')).status, 404);
  assert.equal((await s.request('GET', `/api/portal/${tok}`)).status, 200);
});

test('BOOTSTRAP_TOKEN protects the first run', async (t) => {
  useEnv(t, { BOOTSTRAP_TOKEN: 'only-the-owner' });
  const s = await startServer(t);
  const r = await s.request('POST', '/api/auth/bootstrap', { body: { snapshot: orgSnapshot(), adminUserId: 'u-admin', password: ADMIN_PASSWORD } });
  assert.equal(r.status, 401);
  await bootstrapOrg(s, { bootstrapToken: 'only-the-owner' });
});

test('login by phone or email, me, logout revokes the session', async (t) => {
  useEnv(t);
  const s = await startServer(t);
  await bootstrapOrg(s);
  const byPhone = await s.request('POST', '/api/auth/login', { body: { login: '050-220-1100', password: ADMIN_PASSWORD } });
  assert.equal(byPhone.status, 200);
  assert.equal(byPhone.json.user.id, 'u-admin');
  const byEmail = await s.request('POST', '/api/auth/login', { body: { login: 'DAVID@genair.co.il', password: ADMIN_PASSWORD } });
  assert.equal(byEmail.status, 200);
  const wrong = await s.request('POST', '/api/auth/login', { body: { login: 'david@genair.co.il', password: 'nope-nope' } });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.json.error.code, 'invalid_credentials');
  const noUser = await s.request('POST', '/api/auth/login', { body: { login: '0599999999', password: 'whatever1' } });
  assert.equal(noUser.status, 401, 'same answer for unknown users');

  const me = await s.request('GET', '/api/auth/me', { headers: bearer(byPhone.json.token) });
  assert.equal(me.status, 200);
  assert.equal(me.json.user.name, 'דוד מזרחי');
  assert.equal((await s.request('GET', '/api/auth/me')).status, 401);
  assert.equal((await s.request('GET', '/api/auth/me', { headers: bearer('abc.def.ghi') })).status, 401);

  await s.request('POST', '/api/auth/logout', { headers: bearer(byPhone.json.token) });
  assert.equal((await s.request('GET', '/api/auth/me', { headers: bearer(byPhone.json.token) })).status, 401, 'logged out');
  assert.equal((await s.request('GET', '/api/auth/me', { headers: bearer(byEmail.json.token) })).status, 200, 'other sessions stay');
});

test('login attempts are rate limited per login', async (t) => {
  useEnv(t);
  const s = await startServer(t);
  await bootstrapOrg(s);
  let last;
  for (let i = 0; i < 9; i++) last = await s.request('POST', '/api/auth/login', { body: { login: 'david@genair.co.il', password: `bad-${i}-xxxx` } });
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers['retry-after']) > 0);
  const ok = await s.request('POST', '/api/auth/login', { body: { login: 'david@genair.co.il', password: ADMIN_PASSWORD } });
  assert.equal(ok.status, 429, 'locked even with the right password until the window ends');
});

test('admin sets / resets passwords; temporary password must be changed; others are signed out', async (t) => {
  useEnv(t);
  const s = await startServer(t);
  const { token: admin } = await bootstrapOrg(s);
  const tmp = await s.request('POST', '/api/auth/users/u-office/password', { headers: bearer(admin), body: {} });
  assert.equal(tmp.status, 200);
  assert.match(tmp.json.temporaryPassword, /^[a-z2-9]{10}$/);
  const login = await s.request('POST', '/api/auth/login', { body: { login: 'office@genair.co.il', password: tmp.json.temporaryPassword } });
  assert.equal(login.json.mustChange, true);
  const office = login.json.token;

  // office may not set passwords (admin only)
  assert.equal((await s.request('POST', '/api/auth/users/u-agent1/password', { headers: bearer(office), body: { password: 'x'.repeat(10) } })).status, 403);
  const list = await s.request('GET', '/api/auth/users', { headers: bearer(office) });
  assert.deepEqual(list.json.users.find((u) => u.id === 'u-office').hasPassword, true);
  assert.equal(list.json.users.find((u) => u.id === 'u-agent1').hasPassword, false);
  assert.ok(!list.text.includes('scrypt'));

  const changed = await s.request('POST', '/api/auth/password', { headers: bearer(office), body: { current: tmp.json.temporaryPassword, next: 'office-new-pass' } });
  assert.equal(changed.status, 200);
  assert.equal((await s.request('GET', '/api/auth/me', { headers: bearer(office) })).status, 401, 'old token invalid after a password change');
  assert.equal((await s.request('GET', '/api/auth/me', { headers: bearer(changed.json.token) })).json.mustChange, false);

  // a reset by the admin signs the user out everywhere
  await s.request('POST', '/api/auth/users/u-office/password', { headers: bearer(admin), body: { password: 'reset-by-admin' } });
  assert.equal((await s.request('GET', '/api/auth/me', { headers: bearer(changed.json.token) })).status, 401);
});

test('deactivating a user ends their session at once', async (t) => {
  useEnv(t);
  const s = await startServer(t);
  const { token: admin } = await bootstrapOrg(s);
  const agent = await loginAs(s, admin, 'u-agent1', '0502201102');
  assert.equal((await s.request('GET', '/api/auth/me', { headers: bearer(agent) })).status, 200);
  await s.request('POST', '/api/db/ops', { headers: bearer(admin), body: { ops: [{ op: 'patch', collection: 'users', id: 'u-agent1', data: { active: false }, at: Date.now() }] } });
  assert.equal((await s.request('GET', '/api/auth/me', { headers: bearer(agent) })).status, 401);
});

test('integration routes: only this machine before setup; then a session (APP_TOKEN alone is not enough)', async (t) => {
  useEnv(t, { ANTHROPIC_API_KEY: '' });
  forbidFetch(t);
  const s = await startServer(t);
  const remote = { 'x-forwarded-for': '203.0.113.9' };
  // nothing configured: open to local development only (503 = AI not configured, not 401)
  assert.equal((await s.request('POST', '/api/ai/messages', { body: {} })).status, 503);
  assert.equal((await s.request('POST', '/api/ai/messages', { headers: remote, body: {} })).status, 401, 'never open to the internet');
  process.env.APP_TOKEN = 'shared';
  assert.equal((await s.request('POST', '/api/ai/messages', { headers: { ...remote, 'x-app-token': 'shared' }, body: {} })).status, 503, 'APP_TOKEN before setup');
  delete process.env.APP_TOKEN;
  const { token } = await bootstrapOrg(s);
  assert.equal((await s.request('POST', '/api/ai/messages', { body: {} })).status, 401, 'after bootstrap a session is needed');
  assert.equal((await s.request('POST', '/api/ai/messages', { headers: bearer(token), body: {} })).status, 503);
  process.env.APP_TOKEN = 'shared';
  assert.equal((await s.request('POST', '/api/ai/messages', { headers: { 'x-app-token': 'shared' }, body: {} })).status, 401, 'the shared token does not identify a user');
  assert.equal((await s.request('POST', '/api/ai/messages', { headers: { 'x-app-token': 'bad' }, body: {} })).status, 401);
});

test('integration-only server (DB_MODE=off): APP_TOKEN, or this machine when none is set', async (t) => {
  useEnv(t, { ANTHROPIC_API_KEY: '', DB_MODE: 'off' });
  forbidFetch(t);
  const s = await startServer(t);
  const remote = { 'x-forwarded-for': '203.0.113.9' };
  assert.equal((await s.request('POST', '/api/ai/messages', { body: {} })).status, 503);
  assert.equal((await s.request('POST', '/api/ai/messages', { headers: remote, body: {} })).status, 401);
  process.env.APP_TOKEN = 'shared';
  assert.equal((await s.request('POST', '/api/ai/messages', { body: {} })).status, 401, 'a configured token is needed even locally');
  assert.equal((await s.request('POST', '/api/ai/messages', { headers: { ...remote, 'x-app-token': 'shared' }, body: {} })).status, 503);
});

test('health: no version or integrations without credentials', async (t) => {
  useEnv(t, {});
  const s = await startServer(t);
  const remote = { 'x-forwarded-for': '203.0.113.9' };
  const open = await s.request('GET', '/api/health', { headers: remote });
  assert.equal(open.status, 200);
  assert.deepEqual(Object.keys(open.json).sort(), ['db', 'ok']);
  assert.equal(open.json.db.bootstrapToken, true, 'setup from outside needs the code');
  const { token } = await bootstrapOrg(s);
  const full = await s.request('GET', '/api/health', { headers: { ...remote, ...bearer(token) } });
  assert.ok(full.json.version && full.json.features);
});

test('bootstrap: from outside the server machine only with BOOTSTRAP_TOKEN', async (t) => {
  useEnv(t, {});
  const s = await startServer(t);
  const remote = { 'x-forwarded-for': '203.0.113.9' };
  const body = { snapshot: { collections: { users: [{ id: 'u1', name: 'מנהל', role: 'admin', phone: '0501111111' }] } }, adminUserId: 'u1', password: 'long-password-1' };
  const r = await s.request('POST', '/api/auth/bootstrap', { headers: remote, body });
  assert.equal(r.status, 403);
  assert.equal(r.json.error.code, 'bootstrap_token_required');
  process.env.BOOTSTRAP_TOKEN = 'setup-code';
  assert.equal((await s.request('POST', '/api/auth/bootstrap', { headers: remote, body })).status, 401);
  assert.equal((await s.request('POST', '/api/auth/bootstrap', { headers: remote, body: { ...body, bootstrapToken: 'setup-code' } })).status, 201);
});

test('clientIp: only the entries added by trusted proxies count', () => {
  const req = (fwd) => ({ headers: { 'x-forwarded-for': fwd }, socket: { remoteAddress: '10.0.0.2' } });
  assert.equal(clientIp(req('6.6.6.6, 1.2.3.4'), 1), '1.2.3.4', 'the client-written first entry is ignored');
  assert.equal(clientIp(req('6.6.6.6, 1.2.3.4, 10.0.0.1'), 2), '1.2.3.4');
  assert.equal(clientIp(req('1.2.3.4'), true), '1.2.3.4');
  assert.equal(clientIp(req('6.6.6.6'), 0), '10.0.0.2', 'without TRUST_PROXY the header is ignored');
});
