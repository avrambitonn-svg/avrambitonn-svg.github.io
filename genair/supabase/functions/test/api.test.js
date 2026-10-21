// The Edge Function "api" (the built bundle) against a fake Supabase whose database is the real migrations.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { handle } from './bundle.js';
import { startFakeSupabase } from './fake-supabase.js';
import { FakePriority } from './fake-priority.js';

let fake;
let env;
const s = {}; // state carried between the tests (they run in order)

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const today = new Date().toISOString().slice(0, 10);

const SNAPSHOT = {
  collections: {
    users: [
      { id: 'u-admin', name: 'דוד כהן', role: 'admin', active: true, phone: '050-220-1100', password: 'leak' },
      { id: 'u-office', name: 'משה לוי', role: 'office', active: true, email: 'Office@Genair.co.il' },
      { id: 'u-agent', name: 'אבי מזרחי', role: 'agent', active: true, phone: '+972 52 333 4444' },
      { id: 'u-inst', name: 'סאמר חלבי', role: 'installer', active: true, phone: '0545556666' },
      { id: 'u-twin', name: 'אותו טלפון', role: 'agent', active: true, phone: '054-555-6666' },
      { id: 'u-nologin', name: 'בלי פרטים', role: 'installer', active: true },
    ],
    customers: [{ id: 'c1', name: 'משפחת נבון', phone: '0541234567', type: 'private', addresses: [{ id: 'ad1', city: 'ירושלים', street: 'הרצל', number: '24' }], sync: { status: 'pending' } }],
    contacts: [{ id: 'ct1', customerId: 'c1', name: 'יוסי נבון', phone: '0541234567', primary: true }],
    cases: [{ id: 'k1', number: 'GN-260001', title: 'דירת 4 חדרים — נבון', customerId: 'c1', addressId: 'ad1', contactIds: ['ct1'], stage: 'quote', agentId: 'u-agent', portal: { token: 'pt-k1', enabled: true }, createdAt: `${today}T08:00:00.000Z` }],
    quotes: [{ id: 'q1', caseId: 'k1', number: 'Q-1001', version: 1, status: 'sent', vatPct: 18, discountPct: 0, lines: [{ id: 'l1', description: 'מזגן 1.5 כ״ס', qty: 1, unitPrice: 5000 }], createdAt: `${today}T08:00:00.000Z` }],
  },
  config: { caseNumbering: { prefix: 'GN-', pad: 4 } },
  settings: { depositPct: 20, companyName: 'ג׳נאייר', serverUrl: 'http://device-only' },
  counters: { case: 1, service: 0 },
};

async function call(method, path, { token, body, raw, headers = {}, env: e = env, opts = {} } = {}) {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  let b;
  if (raw !== undefined) b = raw;
  else if (body !== undefined) {
    b = JSON.stringify(body);
    h['content-type'] ??= 'application/json';
  }
  const res = await handle(new Request(`http://localhost:54321/functions/v1${path}`, { method, headers: h, body: b }), e, opts);
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null;
  try {
    json = JSON.parse(buf.toString('utf8'));
  } catch {
    /* not JSON */
  }
  return { status: res.status, headers: res.headers, json, buf };
}

/** What the app does with supabase.auth.signInWithPassword: returns the access token. */
async function signIn(email, password) {
  const res = await fetch(`${fake.url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: env.SUPABASE_ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  assert.equal(res.status, 200, `sign in as ${email}`);
  return (await res.json()).access_token;
}

before(async () => {
  fake = await startFakeSupabase();
  env = { ...fake.env, BOOTSTRAP_TOKEN: 'boot-123456', PRIORITY_MODE: 'off', PRIORITY_CRON_SECRET: 'cron-secret', WHATSAPP_APP_SECRET: 'wa-secret' };
});
after(() => fake?.close());

// ------------------------------------------------------------ plumbing

test('CORS: preflight from an allowed origin, refusal for another', async () => {
  const ok = await call('OPTIONS', '/api/files', { headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST' } });
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  const allow = ok.headers.get('access-control-allow-headers');
  for (const h of ['apikey', 'x-client-info', 'authorization', 'content-type', 'x-file-name', 'x-case-id', 'x-folder', 'x-drive-folder-id', 'anthropic-beta']) assert.match(allow, new RegExp(`\\b${h}\\b`));
  // the single-file Windows install runs from file:// (Origin: null)
  const file = await call('OPTIONS', '/api/ai/messages', { headers: { origin: 'null', 'access-control-request-method': 'POST' } });
  assert.equal(file.status, 204);
  assert.equal(file.headers.get('access-control-allow-origin'), 'null');
  const prod = await call('OPTIONS', '/api/files', { env: { ...env, ALLOWED_ORIGINS: 'https://genair.vercel.app' }, headers: { origin: 'https://genair.vercel.app' } });
  assert.equal(prod.headers.get('access-control-allow-origin'), 'https://genair.vercel.app');
  const bad = await call('GET', '/api/health', { headers: { origin: 'https://evil.example' } });
  assert.equal(bad.status, 403);
  assert.equal(bad.json.error.code, 'origin_not_allowed');
  const nf = await call('GET', '/api/nothing');
  assert.equal(nf.status, 404);
  // the path inside the function, with or without Supabase's /functions/v1 prefix
  const direct = await handle(new Request('http://edge/api/health'), env);
  assert.equal(direct.status, 200);
});

test('health before setup: public answer only', async () => {
  const r = await call('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true, db: { mode: 'supabase', ready: true, bootstrapped: false, bootstrapToken: true } });
});

// ------------------------------------------------------------ first setup

test('bootstrap: needs the BOOTSTRAP_TOKEN secret and the right code', async () => {
  const body = { snapshot: SNAPSHOT, adminUserId: 'u-admin', password: 'admin-pass-1', bootstrapToken: 'boot-123456' };
  const noSecret = await call('POST', '/api/auth/bootstrap', { body, env: { ...env, BOOTSTRAP_TOKEN: '' } });
  assert.equal(noSecret.status, 403);
  assert.equal(noSecret.json.error.code, 'bootstrap_token_required');
  const noCode = await call('POST', '/api/auth/bootstrap', { body: { ...body, bootstrapToken: '' } });
  assert.equal(noCode.status, 403);
  assert.equal(noCode.json.error.code, 'bootstrap_token_required');
  const wrong = await call('POST', '/api/auth/bootstrap', { body: { ...body, bootstrapToken: 'nope' } });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.json.error.code, 'invalid_bootstrap_token');
  const notAdmin = await call('POST', '/api/auth/bootstrap', { body: { ...body, adminUserId: 'u-agent' } });
  assert.equal(notAdmin.status, 400);
  const short = await call('POST', '/api/auth/bootstrap', { body: { ...body, password: '123' } });
  assert.equal(short.status, 400);
  assert.equal((await call('GET', '/api/health')).json.db.bootstrapped, false, 'nothing was imported');
});

test('bootstrap: imports, opens the admin account (phone login), signs in, only once', async () => {
  const r = await call('POST', '/api/auth/bootstrap', { body: { snapshot: SNAPSHOT, adminUserId: 'u-admin', password: 'admin-pass-1', bootstrapToken: 'boot-123456' } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.ok(r.json.session.access_token);
  assert.ok(r.json.session.refresh_token);
  assert.equal(r.json.session.expires_in, 3600);
  assert.equal(r.json.user.id, 'u-admin');
  assert.equal(r.json.user.password, undefined, 'secrets never go into users');
  assert.ok(r.json.seq > 0);
  s.admin = r.json.session.access_token;

  const account = [...fake.auth.users.values()].find((u) => u.email === '0502201100@phone.genair.app');
  assert.ok(account, 'the login email is derived from the phone');
  const members = await fake.rpc('sys_members', {});
  assert.deepEqual(members.map((m) => [m.userId, m.loginEmail, m.mustChange]), [['u-admin', '0502201100@phone.genair.app', false]]);
  const k1 = await fake.get('cases', 'k1');
  assert.match(k1.portal.token, /^[A-Za-z0-9]{18}$/, 'the demo portal link was replaced by a strong one');
  s.portalToken = k1.portal.token;
  assert.equal((await fake.get('settings', 'org')).serverUrl, undefined, 'device settings stay on the device');
  assert.equal((await fake.get('users', 'u-admin')).password, undefined);

  const again = await call('POST', '/api/auth/bootstrap', { body: { snapshot: SNAPSHOT, adminUserId: 'u-admin', password: 'admin-pass-1', bootstrapToken: 'boot-123456' } });
  assert.equal(again.status, 409);
  assert.equal(again.json.error.code, 'already_bootstrapped');
});

test('health: setup done; members also see the version and features', async () => {
  const pub = await call('GET', '/api/health');
  assert.equal(pub.json.db.bootstrapped, true);
  assert.equal(pub.json.version, undefined);
  const r = await call('GET', '/api/health', { token: s.admin });
  assert.equal(r.status, 200);
  assert.ok(r.json.version);
  assert.equal(r.json.features.priority, 'off');
  assert.equal(r.json.features.ai, false);
});

// ------------------------------------------------------------ access

test('signed-in routes: missing, invalid and revoked tokens', async () => {
  const none = await call('GET', '/api/whatsapp/inbox');
  assert.equal(none.status, 401);
  assert.equal(none.json.error.details.reason, 'expired');
  const anonKey = await call('GET', '/api/whatsapp/inbox', { token: 'sb_publishable_abc' });
  assert.equal(anonKey.status, 401);
  assert.equal(anonKey.json.error.details.reason, 'expired');
  const bad = await call('GET', '/api/whatsapp/inbox', { token: 'eyJ.eyJzdWIiOiJ4In0.sig' });
  assert.equal(bad.status, 401);
  assert.equal(bad.json.error.details.reason, 'expired');

  // a signed-in account whose user is deactivated
  const token = await fake.member('u-inst', 'inst@test.local');
  assert.equal((await call('GET', '/api/whatsapp/inbox', { token })).status, 200);
  await fake.rpc('sys_apply', { ops: [{ op: 'patch', collection: 'users', id: 'u-inst', data: { active: false }, at: Date.now() }], origin: 'test' });
  const revoked = await call('GET', '/api/whatsapp/inbox', { token });
  assert.equal(revoked.status, 401);
  assert.equal(revoked.json.error.code, 'unauthorized');
  assert.equal(revoked.json.error.details.reason, 'revoked');
  await fake.rpc('sys_apply', { ops: [{ op: 'patch', collection: 'users', id: 'u-inst', data: { active: true }, at: Date.now() }], origin: 'test' });
});

// ------------------------------------------------------------ passwords

test('admin sets a temporary password: email login, must change, signs in', async () => {
  const r = await call('POST', '/api/auth/users/u-office/password', { token: s.admin, body: {} });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.ok, true);
  assert.match(r.json.temporaryPassword, /^[a-z0-9]{10}$/);
  assert.equal(r.json.login, 'office@genair.co.il');
  const m = (await fake.rpc('sys_members', {})).find((x) => x.userId === 'u-office');
  assert.equal(m.loginEmail, 'office@genair.co.il');
  assert.equal(m.mustChange, true);
  // the app signs in with the derived email and the temporary password
  s.office = await signIn('office@genair.co.il', r.json.temporaryPassword);
  const me = await call('GET', '/api/health', { token: s.office });
  assert.ok(me.json.version, 'the new account is a member');
});

test('admin sets a password: phone login (+972 -> 05...), updated in place the second time', async () => {
  const r = await call('POST', '/api/auth/users/u-agent/password', { token: s.admin, body: { password: 'agent-pass-1' } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json, { ok: true, login: '0523334444' });
  const accounts = () => [...fake.auth.users.values()].filter((u) => u.email === '0523334444@phone.genair.app');
  assert.equal(accounts().length, 1);
  assert.equal(accounts()[0].password, 'agent-pass-1');
  const r2 = await call('POST', '/api/auth/users/u-agent/password', { token: s.admin, body: { password: 'agent-pass-2', mustChange: true } });
  assert.equal(r2.status, 200);
  assert.equal(accounts().length, 1, 'no second account');
  assert.equal(accounts()[0].password, 'agent-pass-2');
  assert.equal((await fake.rpc('sys_members', {})).find((x) => x.userId === 'u-agent').mustChange, true);
});

test('passwords: admin only, a login is needed, one login per account', async () => {
  const office = await call('POST', '/api/auth/users/u-agent/password', { token: s.office, body: { password: 'xxxxxxxx1' } });
  assert.equal(office.status, 403);
  const none = await call('POST', '/api/auth/users/u-nologin/password', { token: s.admin, body: {} });
  assert.equal(none.status, 400);
  const twin = await call('POST', '/api/auth/users/u-twin/password', { token: s.admin, body: {} });
  assert.equal(twin.status, 409);
  assert.equal(twin.json.error.code, 'login_taken');
  const missing = await call('POST', '/api/auth/users/u-ghost/password', { token: s.admin, body: {} });
  assert.equal(missing.status, 404);
  const weak = await call('POST', '/api/auth/users/u-agent/password', { token: s.admin, body: { password: 'short' } });
  assert.equal(weak.status, 400);
});

test('users screen: managers see who can sign in, with the login and last sign-in', async () => {
  const r = await call('GET', '/api/auth/users', { token: s.office });
  assert.equal(r.status, 200);
  const by = Object.fromEntries(r.json.users.map((u) => [u.id, u]));
  assert.equal(by['u-admin'].hasPassword, true);
  assert.equal(by['u-admin'].login, '0502201100');
  assert.ok(by['u-admin'].lastLoginAt, 'the admin signed in at bootstrap');
  assert.equal(by['u-office'].mustChange, true);
  assert.ok(by['u-office'].passwordSetAt);
  assert.equal(by['u-nologin'].hasPassword, false);
  assert.equal(by['u-nologin'].login, null);
  s.agent = await signIn('0523334444@phone.genair.app', 'agent-pass-2');
  assert.equal((await call('GET', '/api/auth/users', { token: s.agent })).status, 403);
});

test('a password set by the admin ends the user\'s existing sessions', async () => {
  assert.equal((await call('GET', '/api/whatsapp/inbox', { token: s.agent })).status, 200);
  const r = await call('POST', '/api/auth/users/u-agent/password', { token: s.admin, body: { password: 'agent-pass-4' } });
  assert.equal(r.status, 200);
  const old = await call('GET', '/api/whatsapp/inbox', { token: s.agent });
  assert.equal(old.status, 401);
  assert.equal(old.json.error.details.reason, 'expired');
  s.agent = await signIn('0523334444@phone.genair.app', 'agent-pass-4');
  assert.equal((await call('GET', '/api/whatsapp/inbox', { token: s.agent })).status, 200);
});

// ------------------------------------------------------------ customer portal and lead form

test('portal: the customer sees their case and approves the quote (deposit pending)', async () => {
  const view = await call('GET', `/api/portal/${s.portalToken}`);
  assert.equal(view.status, 200);
  assert.equal(view.json.case.id, 'k1');
  assert.equal(view.json.quote.id, 'q1');
  assert.equal(view.json.customer.firstName, 'משפחת נבון');
  assert.equal((await call('GET', '/api/portal/pt-k1')).status, 404, 'the weak demo token is gone');

  const sig = 'data:image/png;base64,' + PNG;
  const r = await call('POST', `/api/portal/${s.portalToken}/approve`, { body: { quoteId: 'q1', signature: { name: 'יוסי נבון', dataUrl: sig }, deposit: { method: 'bit' } } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.deposit, { amount: 1180, method: 'bit', status: 'pending' });
  const q = await fake.get('quotes', 'q1');
  assert.equal(q.status, 'approved');
  assert.equal(q.approvedVia, 'portal');
  assert.equal(q.deposit.status, 'pending');
  assert.equal(q.signature.name, 'יוסי נבון');
  assert.equal((await fake.get('cases', 'k1')).stage, 'approved');
  const notes = await fake.list('notifications');
  assert.ok(notes.some((n) => n.userId === 'u-office' && /מקדמה/.test(n.text)));
  const again = await call('POST', `/api/portal/${s.portalToken}/approve`, { body: { quoteId: 'q1', signature: { name: 'יוסי נבון', dataUrl: sig }, deposit: { method: 'bit' } } });
  assert.equal(again.status, 409);
});

test('portal: a service request gets the next number from the database counter', async () => {
  const r = await call('POST', `/api/portal/${s.portalToken}/service`, { body: { symptom: 'leak', text: 'מטפטף' } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.number, 'SC-0001');
  const r2 = await call('POST', `/api/portal/${s.portalToken}/service`, { body: { symptom: 'noise' } });
  assert.equal(r2.json.number, 'SC-0002');
  const calls = await fake.list('serviceCalls');
  assert.deepEqual(calls.map((c) => c.number), ['SC-0001', 'SC-0002']);
  assert.equal(calls[0].urgency, 'high');
});

test('lead form: customer pending review, case, photos stored as files', async () => {
  const r = await call('POST', '/api/public/leads', { body: { name: 'רונית אברהם', phone: '052-7654321', type: 'apartment', city: 'חיפה', text: 'שני מזגנים', photos: [`data:image/png;base64,${PNG}`] } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.match(r.json.number, /^GN-\d{2}0002$/, 'the case counter continues from the imported counters');
  const k = (await fake.list('cases')).find((c) => c.portal?.token === r.json.portalToken);
  const customer = await fake.get('customers', k.customerId);
  assert.equal(customer.pendingReview, true);
  assert.equal(customer.phone, '0527654321');
  const docs = (await fake.list('docs')).filter((d) => d.caseId === k.id);
  assert.equal(docs.length, 1);
  const file = await fake.rpc('sys_file', { p_id: docs[0].fileId });
  assert.equal(file.caseId, k.id);
  assert.equal(file.source, 'lead');
  assert.match(file.path, new RegExp(`^portal/${k.id}/${docs[0].fileId}-`));
  assert.deepEqual(fake.storage.get(file.path).data, Buffer.from(PNG, 'base64'));
  // the customer opens the photo through their portal link
  // opened as a plain link: no apikey, no Authorization
  const img = await call('GET', `/api/portal/${r.json.portalToken}/files/${docs[0].id}`, { headers: {} });
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.deepEqual(img.buf, Buffer.from(PNG, 'base64'));
  s.leadCustomer = k.customerId;
  const honeypot = await call('POST', '/api/public/leads', { body: { name: 'בוט', phone: '0520000000', type: 'apartment', website: 'x' } });
  assert.deepEqual(honeypot.json, { ok: true, number: null, portalToken: null });
});

// ------------------------------------------------------------ files

test('files: upload under the uploader\'s folder, download with safe headers', async () => {
  const data = Buffer.from('%PDF-1.4 test file');
  const up = await call('POST', '/api/files', { token: s.admin, raw: data, headers: { 'content-type': 'application/pdf', 'x-file-name': encodeURIComponent('הצעה חתומה.pdf'), 'x-case-id': 'k1', 'x-folder': 'customer' } });
  assert.equal(up.status, 201, JSON.stringify(up.json));
  assert.match(up.json.fileId, /^f[a-f0-9]{24}$/);
  assert.equal(up.json.name, 'הצעה חתומה.pdf');
  assert.equal(up.json.size, data.length);
  const meta = await fake.rpc('sys_file', { p_id: up.json.fileId });
  const adminAuth = [...fake.auth.users.values()].find((u) => u.email === '0502201100@phone.genair.app');
  assert.equal(meta.by, 'u-admin');
  assert.equal(meta.caseId, 'k1');
  assert.ok(meta.path.startsWith(`${adminAuth.id}/${up.json.fileId}-`), meta.path);

  const down = await call('GET', `/api/files/${up.json.fileId}`, { token: s.office });
  assert.equal(down.status, 200);
  assert.deepEqual(down.buf, data);
  assert.equal(down.headers.get('content-type'), 'application/pdf');
  assert.match(down.headers.get('content-disposition'), /^inline; filename="____ _____.pdf"; filename\*=UTF-8''/);
  assert.equal(down.headers.get('x-content-type-options'), 'nosniff');
  assert.match(down.headers.get('content-security-policy'), /sandbox/);
  const asFile = await call('GET', `/api/files/${up.json.fileId}?download=1`, { token: s.office });
  assert.match(asFile.headers.get('content-disposition'), /^attachment;/);

  const html = await call('POST', '/api/files', { token: s.admin, raw: Buffer.from('<script>x</script>'), headers: { 'content-type': 'text/html', 'x-file-name': 'x.html' } });
  const h = await call('GET', `/api/files/${html.json.fileId}`, { token: s.admin });
  assert.equal(h.headers.get('content-type'), 'application/octet-stream', 'HTML is never served as HTML');
  assert.match(h.headers.get('content-disposition'), /^attachment;/);

  assert.equal((await call('GET', `/api/files/${up.json.fileId}`)).status, 401);
  assert.equal((await call('GET', '/api/files/f000000000000000000000000', { token: s.admin })).status, 404);
  const empty = await call('POST', '/api/files', { token: s.admin, raw: Buffer.alloc(0), headers: { 'content-type': 'text/plain' } });
  assert.equal(empty.status, 400);
});

// ------------------------------------------------------------ WhatsApp inbox

test('WhatsApp: signed webhook into the database inbox, statuses kept apart, read back like before', async () => {
  const payload = {
    entry: [{ changes: [{ value: {
      contacts: [{ wa_id: '972541234567', profile: { name: 'יוסי' } }],
      messages: [{ id: 'wamid.1', from: '972541234567', timestamp: '1760000000', type: 'text', text: { body: 'שלום' } }],
      statuses: [{ id: 'wamid.out', recipient_id: '972541234567', timestamp: '1760000001', status: 'sent' }, { id: 'wamid.out', recipient_id: '972541234567', timestamp: '1760000002', status: 'delivered' }],
    } }] }],
  };
  const raw = Buffer.from(JSON.stringify(payload));
  const sign = (b) => `sha256=${createHmac('sha256', 'wa-secret').update(b).digest('hex')}`;
  const bad = await call('POST', '/api/whatsapp/webhook', { raw, headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=00' } });
  assert.equal(bad.status, 401);
  const r = await call('POST', '/api/whatsapp/webhook', { raw, headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(raw) } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true, received: 3, added: 3 });
  const dup = await call('POST', '/api/whatsapp/webhook', { raw, headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(raw) } });
  assert.equal(dup.json.added, 0, 'Meta retries are dropped');

  const list = await call('GET', '/api/whatsapp/inbox', { token: s.office });
  assert.equal(list.status, 200);
  assert.equal(list.json.items.length, 3);
  const msg = list.json.items.find((i) => i.type === 'text');
  assert.deepEqual(msg, { id: 'wamid.1', from: '972541234567', text: 'שלום', at: new Date(1760000000 * 1000).toISOString(), type: 'text', name: 'יוסי' });
  assert.deepEqual(list.json.items.filter((i) => i.type === 'status').map((i) => [i.id, i.status]).sort(), [['wamid.out', 'delivered'], ['wamid.out', 'sent']]);
  assert.ok(list.json.cursor);
  const later = await call('GET', `/api/whatsapp/inbox?since=${encodeURIComponent(list.json.cursor)}`, { token: s.office });
  assert.deepEqual(later.json.items, []);
  assert.equal((await call('GET', '/api/whatsapp/inbox?since=nope', { token: s.office })).status, 400);
});

// ------------------------------------------------------------ Priority sync

const syncEnv = () => ({
  ...env,
  PRIORITY_SYNC: 'on',
  PRIORITY_MODE: 'live',
  PRIORITY_URL: 'https://priority.example/odata/Priority/tabula.ini/demo',
  PRIORITY_USER: 'api',
  PRIORITY_PASSWORD: 'secret',
  PRIORITY_ALLOW_WRITE: 'true',
  PRIORITY_SYNC_STREAMS: 'customers,orders,invoices,receipts',
});

test('cron: needs PRIORITY_CRON_SECRET and the right x-cron-key; does nothing while sync is off', async () => {
  const noSecret = await call('POST', '/api/priority/cron', { env: { ...env, PRIORITY_CRON_SECRET: '' }, headers: { 'x-cron-key': 'x' } });
  assert.equal(noSecret.status, 503);
  const wrong = await call('POST', '/api/priority/cron', { headers: { 'x-cron-key': 'nope' } });
  assert.equal(wrong.status, 401);
  const none = await call('POST', '/api/priority/cron');
  assert.equal(none.status, 401);
  const off = await call('POST', '/api/priority/cron', { headers: { 'x-cron-key': 'cron-secret' } });
  assert.equal(off.status, 200);
  assert.match(off.json.skipped, /PRIORITY_SYNC/);
});

test('cron: one round of the engine pushes to Priority and persists through sys_apply', async () => {
  const priority = new FakePriority();
  const r = await call('POST', '/api/priority/cron', { env: syncEnv(), opts: { priorityClient: priority }, headers: { 'x-cron-key': 'cron-secret' } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.kinds, ['full'], 'the first round is a full one');
  assert.equal(r.json.runs.full.ok, true, JSON.stringify(r.json));

  assert.deepEqual(priority.writes().map((w) => w[1]), ['CUSTOMERS', 'ORDERS'], 'the customer, then (queued behind it) the quote approved in the portal as an order');
  assert.equal(priority.t.CUSTOMERS.length, 1, 'the reviewed customer was opened in Priority; the lead waits for review');
  assert.equal(priority.t.CUSTOMERS[0].CUSTNAME, 'GN000001', 'numbered from the database counter');
  const c1 = await fake.get('customers', 'c1');
  assert.equal(c1.sync.status, 'synced');
  assert.equal(c1.sync.priorityId, 'GN000001');
  assert.equal(c1.temp, false);
  const by = (await fake.pool.query("select by from app.entities where collection = 'customers' and id = 'c1'")).rows[0].by;
  assert.equal(by, 'priority-sync');
  const q1 = await fake.get('quotes', 'q1');
  assert.equal(q1.sync.status, 'synced');
  assert.equal(q1.sync.priorityId, priority.t.ORDERS[0].ORDNAME);
  const lead = await fake.get('customers', s.leadCustomer);
  assert.equal(lead.sync.status, 'pending');
  assert.match(lead.sync.error, /ממתין לאישור/);

  const state = await fake.get('integrations', 'priority');
  assert.equal(state.engine.active, true);
  assert.equal(state.engine.write, true);
  assert.ok(state.runs.full.at);
  assert.ok(state.customersSince);
  assert.equal((await fake.get('integrations', 'priority-lock')).lease, undefined, 'the lock is released');

  const next = await call('POST', '/api/priority/cron', { env: syncEnv(), opts: { priorityClient: priority }, headers: { 'x-cron-key': 'cron-secret' } });
  assert.deepEqual(next.json.kinds, ['hot'], 'then hot rounds; warm when PRIORITY_SYNC_WARM_SEC passed');
  assert.equal(priority.writes().length, 2, 'nothing new to send');
});

test('cron: one round at a time (lease), an expired lease is taken over', async () => {
  const lease = (until) => fake.rpc('sys_apply', { ops: [{ op: 'patch', collection: 'integrations', id: 'priority-lock', data: { lease: { token: `aa${until}`, until: new Date(until).toISOString() } }, at: Date.now() }], origin: 'test' });
  await lease(Date.now() + 60_000);
  const priority = new FakePriority();
  const busy = await call('POST', '/api/priority/cron', { env: syncEnv(), opts: { priorityClient: priority }, headers: { 'x-cron-key': 'cron-secret' } });
  assert.deepEqual(busy.json, { ok: true, skipped: 'busy' });
  assert.equal(priority.calls.length, 0);
  await lease(Date.now() - 1000);
  const took = await call('POST', '/api/priority/cron', { env: syncEnv(), opts: { priorityClient: priority }, headers: { 'x-cron-key': 'cron-secret' } });
  assert.deepEqual(took.json.kinds, ['hot']);
  assert.equal((await fake.get('integrations', 'priority-lock')).lease, undefined);
});

test('sync status and run: managers only', async () => {
  const st = await call('GET', '/api/priority/sync/status', { token: s.office, env: syncEnv() });
  assert.equal(st.status, 200);
  assert.equal(st.json.running, true);
  assert.ok(st.json.runs.full);
  assert.equal(st.json.canWrite, true);
  assert.equal((await call('GET', '/api/priority/sync/status', { token: s.agent, env: syncEnv() })).status, 403);
  const run = await call('POST', '/api/priority/sync/run', { token: s.office, env: syncEnv(), opts: { priorityClient: new FakePriority() }, body: { kind: 'hot' } });
  assert.equal(run.status, 200, JSON.stringify(run.json));
  assert.equal(run.json.kind, 'hot');
  const off = await call('GET', '/api/priority/sync/status', { token: s.office });
  assert.equal(off.json.running, false);
});

test('Priority webhook: secret key', async () => {
  const e = { ...syncEnv(), PRIORITY_WEBHOOK_SECRET: 'hook-secret' };
  assert.equal((await call('POST', '/api/priority/webhook?key=nope', { env: e, body: {} })).status, 401);
  const r = await call('POST', '/api/priority/webhook?key=hook-secret', { env: e, opts: { priorityClient: new FakePriority() }, body: { form: 'ORDERS' } });
  assert.equal(r.status, 202);
  assert.deepEqual(r.json, { ok: true, queued: 'hot' });
});

// ------------------------------------------------------------ AI proxy (streaming) and portal upload

test('AI proxy: the server\'s module streams Anthropic\'s server-sent events through', async () => {
  const realFetch = globalThis.fetch;
  let seen;
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith('https://api.anthropic.com/')) return realFetch(url, init);
    seen = { url: String(url), headers: init.headers, body: Buffer.from(init.body).toString('utf8') };
    if (init.headers['x-api-key'] === 'sk-wrong') return new Response('{"type":"error","error":{"type":"authentication_error"}}', { status: 401, headers: { 'content-type': 'application/json' } });
    const enc = new TextEncoder();
    const body = new ReadableStream({
      async start(c) {
        c.enqueue(enc.encode('event: message_start\ndata: {"type":"message_start"}\n\n'));
        await new Promise((r) => setTimeout(r, 20));
        c.enqueue(enc.encode('event: message_stop\ndata: {"type":"message_stop"}\n\n'));
        c.close();
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream', 'request-id': 'req_1' } });
  };
  try {
    const e = { ...env, ANTHROPIC_API_KEY: 'sk-test' };
    const req = { model: 'claude-opus-5-5', max_tokens: 100, stream: true, messages: [{ role: 'user', content: 'שלום' }] };
    const r = await call('POST', '/api/ai/messages', { token: s.office, env: e, body: req });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'text/event-stream');
    assert.equal(r.headers.get('request-id'), 'req_1');
    assert.equal(r.buf.toString('utf8'), 'event: message_start\ndata: {"type":"message_start"}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n');
    assert.equal(seen.headers['x-api-key'], 'sk-test');
    assert.deepEqual(JSON.parse(seen.body), req, 'the original bytes are forwarded');
    const bad = await call('POST', '/api/ai/messages', { token: s.office, env: e, body: { ...req, model: 'other' } });
    assert.equal(bad.status, 400);
    assert.equal((await call('POST', '/api/ai/messages', { env: e, body: req })).status, 401);
    // a wrong ANTHROPIC_API_KEY is not the user's session: never 401 on a signed-in call
    const key = await call('POST', '/api/ai/messages', { token: s.office, env: { ...env, ANTHROPIC_API_KEY: 'sk-wrong' }, body: req });
    assert.equal(key.status, 502);
    assert.equal(key.json.error.type, 'authentication_error');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('portal upload: a photo from the customer, filed under the case', async () => {
  const data = Buffer.from(PNG, 'base64');
  const r = await call('POST', `/api/portal/${s.portalToken}/upload`, { raw: data, headers: { 'content-type': 'image/png', 'x-file-name': encodeURIComponent('נזילה.png') } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const doc = await fake.get('docs', r.json.id);
  assert.equal(doc.caseId, 'k1');
  assert.equal(doc.source, 'portal');
  const meta = await fake.rpc('sys_file', { p_id: doc.fileId });
  assert.match(meta.path, new RegExp(`^portal/k1/${doc.fileId}-`));
  assert.equal(meta.name, 'נזילה.png');
  const back = await call('GET', r.json.url);
  assert.deepEqual(back.buf, data);
  const exe = await call('POST', `/api/portal/${s.portalToken}/upload`, { raw: Buffer.from('MZ'), headers: { 'content-type': 'application/x-msdownload' } });
  assert.equal(exe.status, 415);
});

// ------------------------------------------------------------ hardening

test('portal upload: bytes that do not match the declared type are refused', async () => {
  const r = await call('POST', `/api/portal/${s.portalToken}/upload`, { raw: Buffer.from('<html><script>alert(1)</script></html>'), headers: { 'content-type': 'image/png', 'x-file-name': 'a.png' } });
  assert.equal(r.status, 415);
  assert.equal(r.json.error.code, 'type_mismatch');
});

test('installers have no AI or Priority routes; answers carry security headers', async () => {
  const token = await fake.member('u-nologin', 'nologin@test.local'); // an installer
  const ai = await call('POST', '/api/ai/messages', { token, body: {} });
  assert.equal(ai.status, 403);
  assert.equal((await call('GET', '/api/priority/items', { token })).status, 403);
  assert.equal(ai.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(ai.headers.get('x-frame-options'), 'DENY');
});

test('security log: a wrong cron key and a password set by the admin are recorded', async () => {
  await call('POST', '/api/priority/cron', { headers: { 'x-cron-key': 'wrong' } });
  await call('POST', '/api/auth/users/u-agent/password', { token: s.admin, body: { password: 'agent-pass-2' } });
  const rows = (await fake.pool.query('select action, actor, detail from app.audit order by id')).rows;
  assert.ok(rows.some((r) => r.action === 'priority_cron_rejected'), JSON.stringify(rows));
  assert.ok(rows.some((r) => r.action === 'password_set' && r.actor === 'u-admin' && r.detail.target === 'u-agent'));
  assert.ok(rows.some((r) => r.action === 'bootstrap'));
});
