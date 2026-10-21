// Users and sessions: scrypt password hashes (kept only in the server's auth state, never in the
// shared users collection), HS256 tokens with a session id (logout revokes it), sliding refresh,
// login rate limits and the one-time bootstrap that uploads the app's data to an empty store.
import { createHmac, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError, ipOf, readJson, safeEqual } from './http.js';
import { createWindowLimiter } from './limiter.js';
import { alertAdmins, audit, maskLogin } from './audit.js';
import { requireStore } from './db/index.js';
import { BAD_KEYS, COLLECTION_RE, ID_RE, SINGLETONS } from './db/store.js';

const scrypt = promisify(scryptCb);
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const REFRESH_AFTER_SEC = 15 * 60;
export const ROLES = ['admin', 'office', 'agent', 'engineer', 'installer'];
// Settings that belong to one device and never go to the shared store
export const DEVICE_SETTINGS = ['serverUrl', 'appToken', 'anthropicKey'];
const SECRET_FIELDS = ['password', 'passwordHash', 'hash', 'salt', 'token', 'tempPassword'];

// ------------------------------------------------------------ passwords

// scrypt is deliberately slow and memory-hungry. Without a cap a flood of sign-in attempts fills the thread pool and
// every other request (files, DNS) waits behind it, so only a few run at once and the queue is short.
const MAX_HASHES_AT_ONCE = 3;
const MAX_HASHES_WAITING = 40;
let hashesRunning = 0;
const hashQueue = [];

async function withHashSlot(fn) {
  if (hashesRunning >= MAX_HASHES_AT_ONCE) {
    if (hashQueue.length >= MAX_HASHES_WAITING) throw new HttpError(503, 'server_busy', 'השרת עמוס כרגע, נסו שוב בעוד רגע');
    await new Promise((resolve) => hashQueue.push(resolve)); // the finishing run hands its slot over
  } else {
    hashesRunning++;
  }
  try {
    return await fn();
  } finally {
    const next = hashQueue.shift();
    if (next) next();
    else hashesRunning--;
  }
}

export function hashPassword(password) {
  return withHashSlot(async () => {
    const salt = randomBytes(16);
    const key = await scrypt(String(password).normalize('NFC'), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 });
    return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
  });
}

export async function verifyPassword(password, stored) {
  const parts = String(stored ?? '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  return withHashSlot(async () => {
    const key = await scrypt(String(password).normalize('NFC'), Buffer.from(saltB64, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
    return key.length === expected.length && timingSafeEqual(key, expected);
  });
}

const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');

export function temporaryPassword(len = 10) {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  // rejection sampling: 256 is not a multiple of 31, so a plain modulo would favour the first letters
  const limit = 256 - (256 % abc.length);
  let s = '';
  while (s.length < len) for (const b of randomBytes(len * 2)) if (b < limit && s.length < len) s += abc[b % abc.length];
  if (!/\d/.test(s)) s = s.slice(0, -1) + String(randomInt(2, 10));
  return s;
}

const COMMON_PASSWORDS = new Set([
  '12345678', '123456789', '1234567890', '87654321', '11111111', '00000000', 'password', 'password1', 'passw0rd', 'qwertyui', 'qwerty123',
  'iloveyou', 'admin123', 'letmein1', 'welcome1', 'abc12345', 'aa123456', 'a1234567', '1q2w3e4r', '0501234567', 'genair123', 'genair1234',
]);

/** null when the password is acceptable, else the reason (Hebrew, shown to the user). `who` = login names it must not equal. */
export function passwordProblem(pw, who = []) {
  if (typeof pw !== 'string' || pw.length < 8) return 'הסיסמה צריכה לפחות 8 תווים';
  if (pw.length > 200) return 'הסיסמה ארוכה מדי';
  const low = pw.toLowerCase();
  if (COMMON_PASSWORDS.has(low) || /^(.)\1+$/.test(pw)) return 'הסיסמה קלה מדי לניחוש, בחרו סיסמה אחרת';
  if (who.some((w) => w && String(w).toLowerCase() === low)) return 'הסיסמה לא יכולה להיות זהה לשם המשתמש';
  return null;
}

// ------------------------------------------------------------ tokens

const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
const HEADER = b64({ alg: 'HS256', typ: 'JWT' });

export function signToken(claims, secret) {
  const body = `${HEADER}.${b64(claims)}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

export function verifyToken(token, secret, nowSec = Math.floor(Date.now() / 1000)) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3 || parts[0] !== HEADER) return null;
  const sig = createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest('base64url');
  if (!safeEqual(sig, parts[2])) return null;
  let claims;
  try {
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!claims || typeof claims.sub !== 'string' || !(claims.exp > nowSec)) return null;
  return claims;
}

export const tokenSecret = (store, cfg) => cfg.db.authSecret || store.ensureSecret();

export function issueToken(store, cfg, userId, { sid = randomBytes(12).toString('base64url'), pv, ses } = {}) {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + Math.round(cfg.db.tokenTtlHours * 3600);
  // ses = when the sign-in began; renewing a token keeps it, so a session cannot be kept alive forever
  const claims = { sub: userId, sid, pv: pv ?? store.auth.credentials.get(userId)?.pv ?? 0, ses: ses ?? iat, iat, exp };
  return { token: signToken(claims, tokenSecret(store, cfg)), expiresAt: new Date(exp * 1000).toISOString(), claims };
}

function bearer(req) {
  const h = String(req.headers.authorization ?? '');
  return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : '';
}

/** { user, claims } for a valid session token, null without one, { error } for a bad or expired one. */
export function readSession(req, store, cfg) {
  const token = bearer(req);
  if (!token) return null;
  const claims = verifyToken(token, tokenSecret(store, cfg));
  if (!claims) return { error: 'expired' };
  const maxAge = (cfg.db.maxSessionHours ?? 168) * 3600;
  if (Math.floor(Date.now() / 1000) - (claims.ses ?? claims.iat) > maxAge) return { error: 'expired' };
  if (store.auth.revoked.has(claims.sid)) return { error: 'revoked' };
  const cred = store.auth.credentials.get(claims.sub);
  const user = store.get('users', claims.sub);
  if (!cred || !user || user.active === false || (cred.pv ?? 0) !== claims.pv) return { error: 'revoked' };
  return { user, claims };
}

/** Requires a session; refreshes the token (x-auth-token response header) once it is 15 minutes old. */
export function requireSession(req, res, store, cfg) {
  const s = readSession(req, store, cfg);
  if (!s || s.error) {
    throw new HttpError(401, 'unauthorized', s?.error === 'expired' ? 'פג תוקף ההתחברות, צריך להתחבר שוב' : 'צריך להתחבר למערכת', { reason: s?.error ?? 'missing' });
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec - s.claims.iat > REFRESH_AFTER_SEC) {
    const t = issueToken(store, cfg, s.user.id, { sid: s.claims.sid, pv: s.claims.pv, ses: s.claims.ses ?? s.claims.iat });
    res.setHeader('x-auth-token', t.token);
  }
  return s;
}

export const isManager = (user) => user?.role === 'admin' || user?.role === 'office';

// ------------------------------------------------------------ login

// Three counters: this address (any account), this account from this address, and this account from anywhere. The
// per-account-from-anywhere limit is high on purpose: a stranger who types wrong passwords for the manager's login must
// not be able to lock the manager out (the "account + address" limit is what stops guessing from one place).
const failuresByIp = createWindowLimiter({ max: 30, windowMs: 15 * 60_000 });
const failuresByAccountIp = createWindowLimiter({ max: 8, windowMs: 15 * 60_000 });
const failuresByAccount = createWindowLimiter({ max: 60, windowMs: 15 * 60_000 });
const passwordChangeFailures = createWindowLimiter({ max: 5, windowMs: 15 * 60_000 });
export const resetLoginLimits = () => {
  failuresByIp.clear();
  failuresByAccountIp.clear();
  failuresByAccount.clear();
  passwordChangeFailures.clear();
};

const normPhone = (p) => {
  const d = String(p ?? '').replace(/\D/g, '');
  return d.startsWith('972') ? `0${d.slice(3)}` : d;
};

/** One key per account however it was typed: "A@x.io " and "a@x.io" are the same, so are "050-123 4567" and "0501234567". */
export function accountKey(login) {
  const raw = String(login ?? '').trim();
  if (raw.includes('@')) return raw.toLowerCase();
  const p = normPhone(raw);
  return p.length >= 9 ? `p:${p}` : raw.toLowerCase();
}

export function findUserByLogin(store, login) {
  const raw = String(login ?? '').trim();
  if (!raw) return undefined;
  const users = store.list('users').filter((u) => u.active !== false);
  if (raw.includes('@')) return users.find((u) => String(u.email ?? '').toLowerCase() === raw.toLowerCase());
  const p = normPhone(raw);
  return p.length >= 9 ? users.find((u) => normPhone(u.phone) === p) : undefined;
}

function tooMany(retryMs) {
  const e = new HttpError(429, 'too_many_attempts', `יותר מדי ניסיונות. אפשר לנסות שוב בעוד ${Math.ceil(retryMs / 60000)} דקות`);
  e.retryAfter = Math.ceil(retryMs / 1000);
  return e;
}

export async function login({ req, cfg }) {
  const store = await requireStore(cfg);
  const body = await readJson(req);
  const loginId = typeof body.login === 'string' ? body.login.trim().slice(0, 120) : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!loginId || !password) throw new HttpError(400, 'validation_error', 'צריך טלפון או אימייל וסיסמה', { fields: [!loginId && { field: 'login' }, !password && { field: 'password' }].filter(Boolean) });
  const ip = ipOf(req, cfg);
  const acct = accountKey(loginId);
  const pairs = [[failuresByIp, ip], [failuresByAccountIp, `${acct}|${ip}`], [failuresByAccount, acct]];
  for (const [lim, key] of pairs) {
    const v = lim.peek(key);
    if (!v.allowed) {
      audit(cfg, 'login_blocked', { login: maskLogin(loginId), ip });
      throw tooMany(v.retryAfterMs);
    }
  }
  const user = findUserByLogin(store, loginId);
  const cred = user && store.auth.credentials.get(user.id);
  const ok = await verifyPassword(password, cred?.hash ?? DUMMY_HASH);
  if (!user || !cred || !ok) {
    let locked = false;
    for (const [lim, key] of pairs) {
      const v = lim.hit(key);
      if (v.count === lim.max) locked = true; // this very attempt used up the last try: the next one is refused
    }
    audit(cfg, 'login_failed', { login: maskLogin(loginId), ip, known: Boolean(user) });
    if (locked) {
      audit(cfg, 'login_locked', { login: maskLogin(loginId), ip });
      alertAdmins(store, 'login_locked', `ניסיונות כניסה כושלים חוזרים (${maskLogin(loginId)}). כדאי לבדוק שזה לא ניסיון פריצה`);
    }
    throw new HttpError(401, 'invalid_credentials', 'הפרטים לא נכונים');
  }
  failuresByAccountIp.reset(`${acct}|${ip}`);
  store.setCredential(user.id, { ...cred, lastLoginAt: new Date().toISOString() });
  const t = issueToken(store, cfg, user.id);
  audit(cfg, 'login_ok', { user: user.id, role: user.role, ip });
  return { status: 200, body: { token: t.token, expiresAt: t.expiresAt, user, mustChange: Boolean(cred.mustChange) } };
}

export async function logout({ req, res, cfg }) {
  const store = await requireStore(cfg);
  const s = readSession(req, store, cfg);
  if (s?.claims) {
    store.revoke(s.claims.sid, s.claims.exp + 13 * 3600);
    audit(cfg, 'logout', { user: s.user.id });
  }
  res.removeHeader?.('x-auth-token');
  return { status: 200, body: { ok: true } };
}

export async function me({ req, res, cfg }) {
  const store = await requireStore(cfg);
  const s = requireSession(req, res, store, cfg);
  return { status: 200, body: { user: s.user, expiresAt: new Date(s.claims.exp * 1000).toISOString(), mustChange: Boolean(store.auth.credentials.get(s.user.id)?.mustChange) } };
}

/** Admin: set a password, or get a one-time temporary password back when none is given. */
export async function setUserPassword({ req, res, cfg, params }) {
  const store = await requireStore(cfg);
  const s = requireSession(req, res, store, cfg);
  if (s.user.role !== 'admin') throw new HttpError(403, 'forbidden', 'רק מנהל מערכת יכול לקבוע סיסמה למשתמש אחר');
  const target = store.get('users', params.id);
  if (!target) throw new HttpError(404, 'not_found', 'המשתמש לא נמצא');
  const body = await readJson(req);
  let temporary;
  let password = body.password;
  if (password === undefined || password === null || password === '') password = temporary = temporaryPassword();
  const problem = passwordProblem(password, [target.email, target.phone]);
  if (problem) throw new HttpError(400, 'validation_error', problem, { fields: [{ field: 'password', message: problem }] });
  const prev = store.auth.credentials.get(target.id);
  audit(cfg, 'password_reset', { by: s.user.id, target: target.id, temporary: Boolean(temporary) });
  store.setCredential(target.id, { hash: await hashPassword(password), pv: (prev?.pv ?? 0) + 1, at: new Date().toISOString(), by: s.user.id, mustChange: Boolean(temporary) || body.mustChange === true, lastLoginAt: prev?.lastLoginAt });
  return { status: 200, body: temporary ? { ok: true, temporaryPassword: temporary } : { ok: true } };
}

/** The signed-in user changes their own password. Other sessions are signed out; this one gets a new token. */
export async function changePassword({ req, res, cfg }) {
  const store = await requireStore(cfg);
  const s = requireSession(req, res, store, cfg);
  const body = await readJson(req);
  const cred = store.auth.credentials.get(s.user.id);
  const blocked = passwordChangeFailures.peek(s.user.id);
  if (!blocked.allowed) throw tooMany(blocked.retryAfterMs);
  if (!(await verifyPassword(String(body.current ?? ''), cred?.hash ?? DUMMY_HASH))) {
    passwordChangeFailures.hit(s.user.id);
    audit(cfg, 'password_change_failed', { user: s.user.id });
    throw new HttpError(401, 'invalid_credentials', 'הסיסמה הנוכחית לא נכונה');
  }
  passwordChangeFailures.reset(s.user.id);
  const problem = passwordProblem(body.next, [s.user.email, s.user.phone]);
  if (problem) throw new HttpError(400, 'validation_error', problem, { fields: [{ field: 'next', message: problem }] });
  const pv = (cred?.pv ?? 0) + 1;
  store.setCredential(s.user.id, { ...cred, hash: await hashPassword(body.next), pv, at: new Date().toISOString(), by: s.user.id, mustChange: false });
  const t = issueToken(store, cfg, s.user.id, { sid: s.claims.sid, pv, ses: s.claims.ses ?? s.claims.iat });
  res.setHeader('x-auth-token', t.token);
  audit(cfg, 'password_changed', { user: s.user.id });
  return { status: 200, body: { ok: true, token: t.token, expiresAt: t.expiresAt } };
}

/** Admin / office: which users can sign in (never the hashes). */
export async function listCredentials({ req, res, cfg }) {
  const store = await requireStore(cfg);
  const s = requireSession(req, res, store, cfg);
  if (!isManager(s.user)) throw new HttpError(403, 'forbidden', 'אין הרשאה');
  const users = store.list('users').map((u) => {
    const c = store.auth.credentials.get(u.id);
    return { id: u.id, hasPassword: Boolean(c), mustChange: Boolean(c?.mustChange), lastLoginAt: c?.lastLoginAt ?? null, passwordSetAt: c?.at ?? null };
  });
  return { status: 200, body: { users } };
}

// ------------------------------------------------------------ bootstrap

export function cleanUser(u) {
  const out = { ...u };
  for (const k of SECRET_FIELDS) delete out[k];
  return out;
}

export function cleanSettings(s) {
  const out = { ...s };
  for (const k of DEVICE_SETTINGS) delete out[k];
  return out;
}

// Demo data has short, guessable portal links (pt-k1); real ones are 18 random characters.
const PORTAL_ABC = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function strongPortal(portal) {
  const p = portal && typeof portal === 'object' ? { ...portal } : { enabled: true };
  if (typeof p.token !== 'string' || !/^[A-Za-z0-9]{12,64}$/.test(p.token)) {
    p.token = Array.from(randomBytes(18), (b) => PORTAL_ABC[b % PORTAL_ABC.length]).join('');
  }
  return p;
}

function validSnapshot(snap) {
  const bad = (message) => new HttpError(400, 'validation_error', message);
  if (!snap || typeof snap !== 'object' || Array.isArray(snap)) throw bad('חסר snapshot');
  const collections = {};
  const src = snap.collections ?? {};
  if (typeof src !== 'object' || Array.isArray(src)) throw bad('collections חייב להיות אובייקט');
  for (const [c, list] of Object.entries(src)) {
    if (!COLLECTION_RE.test(c) || SINGLETONS.has(c)) throw bad(`שם אוסף לא תקין: ${c}`);
    if (!Array.isArray(list) || list.length > 50_000) throw bad(`האוסף ${c} חייב להיות מערך`);
    const seen = new Set();
    collections[c] = list.filter((x) => {
      if (!x || typeof x !== 'object' || Array.isArray(x) || !ID_RE.test(x.id) || seen.has(x.id)) return false;
      seen.add(x.id);
      return true;
    }).map((x) => {
      const o = {};
      for (const [k, v] of Object.entries(x)) if (!BAD_KEYS.has(k)) o[k] = v;
      if (c === 'cases') o.portal = strongPortal(o.portal);
      return c === 'users' ? cleanUser(o) : o;
    });
  }
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
  const counters = {};
  for (const [k, v] of Object.entries(obj(snap.counters) ?? {})) if (Number.isFinite(Number(v)) && Number(v) >= 0) counters[k] = Math.floor(Number(v));
  return { collections, config: obj(snap.config), settings: obj(snap.settings) && cleanSettings(snap.settings), counters };
}

/**
 * The code a person must type to finish the first setup. BOOTSTRAP_TOKEN when set; otherwise a random code made when the
 * server starts and printed in its log, so only whoever runs the server can finish the setup (not whoever reaches the
 * address first). It is new on every start and is never stored.
 */
export function setupCode(store, cfg) {
  return cfg.db.bootstrapToken || (store.setupCode ??= randomBytes(9).toString('base64url'));
}

/** First run only: uploads the app's data and sets the admin's password. */
export async function bootstrap({ req, cfg }) {
  const store = await requireStore(cfg);
  const ip = ipOf(req, cfg);
  if (!failuresByIp.peek(ip).allowed) throw tooMany(failuresByIp.peek(ip).retryAfterMs);
  if (!store.isEmpty()) throw new HttpError(409, 'already_bootstrapped', 'המערכת כבר הוקמה. מתחברים עם משתמש וסיסמה');
  const body = await readJson(req);
  if (!safeEqual(String(body.bootstrapToken ?? ''), setupCode(store, cfg))) {
    failuresByIp.hit(ip);
    audit(cfg, 'bootstrap_denied', { ip });
    throw new HttpError(401, 'invalid_bootstrap_token', 'קוד ההקמה שגוי. הקוד מופיע ביומן השרת בעת ההפעלה (או ב-BOOTSTRAP_TOKEN)');
  }
  const snap = validSnapshot(body.snapshot);
  const admin = (snap.collections.users ?? []).find((u) => u.id === body.adminUserId);
  if (!admin || admin.role !== 'admin' || admin.active === false) throw new HttpError(400, 'validation_error', 'צריך לבחור משתמש פעיל בתפקיד ניהול', { fields: [{ field: 'adminUserId' }] });
  const problem = passwordProblem(body.password, [admin.email, admin.phone]);
  if (problem) throw new HttpError(400, 'validation_error', problem, { fields: [{ field: 'password', message: problem }] });
  const hash = await hashPassword(body.password);
  if (!store.isEmpty()) throw new HttpError(409, 'already_bootstrapped', 'המערכת כבר הוקמה');
  store.importSnapshot(snap, { userId: admin.id });
  store.setCredential(admin.id, { hash, pv: 1, at: new Date().toISOString(), by: admin.id });
  const t = issueToken(store, cfg, admin.id);
  await store.flush();
  audit(cfg, 'bootstrap_done', { admin: admin.id, ip });
  return { status: 201, body: { token: t.token, expiresAt: t.expiresAt, user: admin, seq: store.seq } };
}
