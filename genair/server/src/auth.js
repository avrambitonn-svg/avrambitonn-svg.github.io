// Users and sessions: scrypt password hashes (kept only in the server's auth state, never in the
// shared users collection), HS256 tokens with a session id (logout revokes it), sliding refresh,
// login rate limits and the one-time bootstrap that uploads the app's data to an empty store.
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError, clientIp, isLocalRequest, readJson, safeEqual } from './http.js';
import { createWindowLimiter } from './limiter.js';
import { requireStore } from './db/index.js';
import { BAD_KEYS, COLLECTION_RE, ID_RE, SINGLETONS } from './db/store.js';

const scryptRaw = promisify(scryptCb);
// scrypt takes ~50ms of CPU and 16MB per call: at most a few at a time, and refuse a flood instead of queueing it
const SCRYPT_PARALLEL = 4;
const SCRYPT_QUEUE = 64;
let scryptActive = 0;
const scryptWaiting = [];
async function scrypt(...args) {
  if (scryptActive >= SCRYPT_PARALLEL) {
    if (scryptWaiting.length >= SCRYPT_QUEUE) throw new HttpError(503, 'busy', 'השרת עמוס כרגע. נסו שוב בעוד רגע');
    await new Promise((resolve) => scryptWaiting.push(resolve));
  }
  scryptActive++;
  try {
    return await scryptRaw(...args);
  } finally {
    scryptActive--;
    scryptWaiting.shift()?.();
  }
}
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const REFRESH_AFTER_SEC = 15 * 60;
export const ROLES = ['admin', 'office', 'agent', 'engineer', 'installer'];
// Settings that belong to one device and never go to the shared store
export const DEVICE_SETTINGS = ['serverUrl', 'appToken', 'anthropicKey'];
const SECRET_FIELDS = ['password', 'passwordHash', 'hash', 'salt', 'token', 'tempPassword'];

// ------------------------------------------------------------ passwords

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(String(password).normalize('NFC'), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored ?? '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(String(password).normalize('NFC'), Buffer.from(saltB64, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');

export function temporaryPassword(len = 10) {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(len);
  let s = Array.from(bytes, (b) => abc[b % abc.length]).join('');
  if (!/\d/.test(s)) s = s.slice(0, -1) + String(bytes[0] % 10);
  return s;
}

export function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'הסיסמה צריכה לפחות 8 תווים';
  if (pw.length > 200) return 'הסיסמה ארוכה מדי';
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

// `auth` = when the user typed the password. Refreshing keeps it, so a session ends AUTH_MAX_DAYS after the login
// however actively it is used.
export function issueToken(store, cfg, userId, { sid = randomBytes(12).toString('base64url'), pv, auth } = {}) {
  const iat = Math.floor(Date.now() / 1000);
  const authAt = auth ?? iat;
  const exp = Math.min(iat + Math.round(cfg.db.tokenTtlHours * 3600), sessionEnd(cfg, authAt));
  const claims = { sub: userId, sid, pv: pv ?? store.auth.credentials.get(userId)?.pv ?? 0, iat, exp, auth: authAt };
  return { token: signToken(claims, tokenSecret(store, cfg)), expiresAt: new Date(exp * 1000).toISOString(), claims };
}

const sessionEnd = (cfg, authAt) => authAt + Math.round(cfg.db.maxSessionDays * 86400);

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
  if (Math.floor(Date.now() / 1000) >= sessionEnd(cfg, claims.auth ?? claims.iat)) return { error: 'expired' };
  if (store.auth.revoked.has(claims.sid)) return { error: 'revoked' };
  const cred = store.auth.credentials.get(claims.sub);
  const user = store.get('users', claims.sub);
  if (!cred || !user || user.active === false || (cred.pv ?? 0) !== claims.pv) return { error: 'revoked' };
  return { user, claims };
}

/** Requires a session; refreshes the token (x-auth-token response header) once it is 15 minutes old. */
export function requireSession(req, res, store, cfg) {
  const s = readSession(req, store, cfg);
  // details.reason tells the app whether to keep this device's data (expired: the same user logs in again) or wipe it (revoked)
  if (!s || s.error) throw new HttpError(401, 'unauthorized', s?.error === 'expired' ? 'פג תוקף ההתחברות, צריך להתחבר שוב' : 'צריך להתחבר למערכת', { reason: s?.error ?? 'missing' });
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec - s.claims.iat > REFRESH_AFTER_SEC) {
    const t = issueToken(store, cfg, s.user.id, { sid: s.claims.sid, pv: s.claims.pv, auth: s.claims.auth ?? s.claims.iat });
    res.setHeader('x-auth-token', t.token);
  }
  return s;
}

export const isManager = (user) => user?.role === 'admin' || user?.role === 'office';

// ------------------------------------------------------------ login

// Wrong passwords: per address; per account from one address (so a stranger cannot lock a user out from their
// own network); and a high ceiling per account from everywhere together, against a spread-out attack.
const failuresByIp = createWindowLimiter({ max: 30, windowMs: 15 * 60_000 });
const failuresByLogin = createWindowLimiter({ max: 8, windowMs: 15 * 60_000 });
const failuresByAccount = createWindowLimiter({ max: 100, windowMs: 15 * 60_000 });
const failuresByPasswordChange = createWindowLimiter({ max: 5, windowMs: 15 * 60_000 });
export const resetLoginLimits = () => {
  failuresByIp.clear();
  failuresByLogin.clear();
  failuresByAccount.clear();
  failuresByPasswordChange.clear();
};

/** One key per account however it is typed: +972-50..., 050..., Name@Mail. */
function loginKey(raw) {
  if (raw.includes('@')) return `e:${raw.toLowerCase()}`;
  const p = normPhone(raw);
  return p.length >= 9 ? `p:${p}` : `x:${raw.toLowerCase()}`;
}

const normPhone = (p) => {
  const d = String(p ?? '').replace(/\D/g, '');
  return d.startsWith('972') ? `0${d.slice(3)}` : d;
};

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
  const ip = clientIp(req, cfg.db.trustProxy);
  const account = loginKey(loginId);
  const lk = `${account}|${ip}`;
  for (const [lim, key] of [[failuresByIp, ip], [failuresByLogin, lk], [failuresByAccount, account]]) {
    const v = lim.peek(key);
    if (!v.allowed) throw tooMany(v.retryAfterMs);
  }
  const user = findUserByLogin(store, loginId);
  const cred = user && store.auth.credentials.get(user.id);
  const ok = await verifyPassword(password, cred?.hash ?? DUMMY_HASH);
  if (!user || !cred || !ok) {
    failuresByIp.hit(ip);
    failuresByLogin.hit(lk);
    failuresByAccount.hit(account);
    throw new HttpError(401, 'invalid_credentials', 'הפרטים לא נכונים');
  }
  failuresByLogin.reset(lk);
  store.setCredential(user.id, { ...cred, lastLoginAt: new Date().toISOString() });
  const t = issueToken(store, cfg, user.id);
  return { status: 200, body: { token: t.token, expiresAt: t.expiresAt, user, mustChange: Boolean(cred.mustChange) } };
}

export async function logout({ req, res, cfg }) {
  const store = await requireStore(cfg);
  const s = readSession(req, store, cfg);
  // kept until no token of this session can be valid any more, refreshed or not
  if (s?.claims) store.revoke(s.claims.sid, Math.max(s.claims.exp, sessionEnd(cfg, s.claims.auth ?? s.claims.iat)) + 3600);
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
  const problem = passwordProblem(password);
  if (problem) throw new HttpError(400, 'validation_error', problem, { fields: [{ field: 'password', message: problem }] });
  const prev = store.auth.credentials.get(target.id);
  store.setCredential(target.id, { hash: await hashPassword(password), pv: (prev?.pv ?? 0) + 1, at: new Date().toISOString(), by: s.user.id, mustChange: Boolean(temporary) || body.mustChange === true, lastLoginAt: prev?.lastLoginAt });
  return { status: 200, body: temporary ? { ok: true, temporaryPassword: temporary } : { ok: true } };
}

/** The signed-in user changes their own password. Other sessions are signed out; this one gets a new token. */
export async function changePassword({ req, res, cfg }) {
  const store = await requireStore(cfg);
  const s = requireSession(req, res, store, cfg);
  const body = await readJson(req);
  const cred = store.auth.credentials.get(s.user.id);
  const v = failuresByPasswordChange.peek(s.user.id);
  if (!v.allowed) throw tooMany(v.retryAfterMs);
  if (!(await verifyPassword(String(body.current ?? ''), cred?.hash ?? DUMMY_HASH))) {
    failuresByPasswordChange.hit(s.user.id);
    throw new HttpError(401, 'invalid_credentials', 'הסיסמה הנוכחית לא נכונה');
  }
  failuresByPasswordChange.reset(s.user.id);
  const problem = passwordProblem(body.next);
  if (problem) throw new HttpError(400, 'validation_error', problem, { fields: [{ field: 'next', message: problem }] });
  const pv = (cred?.pv ?? 0) + 1;
  store.setCredential(s.user.id, { ...cred, hash: await hashPassword(body.next), pv, at: new Date().toISOString(), by: s.user.id, mustChange: false });
  const t = issueToken(store, cfg, s.user.id, { sid: s.claims.sid, pv, auth: s.claims.auth ?? s.claims.iat });
  res.setHeader('x-auth-token', t.token);
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

/** First run only: uploads the app's data and sets the admin's password. */
export async function bootstrap({ req, cfg }) {
  const store = await requireStore(cfg);
  const ip = clientIp(req, cfg.db.trustProxy);
  if (!failuresByIp.peek(ip).allowed) throw tooMany(failuresByIp.peek(ip).retryAfterMs);
  if (!store.isEmpty()) throw new HttpError(409, 'already_bootstrapped', 'המערכת כבר הוקמה. מתחברים עם משתמש וסיסמה');
  const body = await readJson(req);
  // without a setup code, whoever reaches an empty server first would become its admin (also after a lost disk),
  // so only a request from the server machine itself may set it up without one
  if (!cfg.db.bootstrapToken && !isLocalRequest(req)) {
    throw new HttpError(403, 'bootstrap_token_required', 'כדי להקים את המערכת מרחוק צריך להגדיר בשרת קוד הקמה (BOOTSTRAP_TOKEN) ולהזין אותו כאן');
  }
  if (cfg.db.bootstrapToken && !safeEqual(String(body.bootstrapToken ?? ''), cfg.db.bootstrapToken)) {
    failuresByIp.hit(ip);
    throw new HttpError(401, 'invalid_bootstrap_token', 'קוד ההקמה (BOOTSTRAP_TOKEN) שגוי');
  }
  const snap = validSnapshot(body.snapshot);
  const admin = (snap.collections.users ?? []).find((u) => u.id === body.adminUserId);
  if (!admin || admin.role !== 'admin' || admin.active === false) throw new HttpError(400, 'validation_error', 'צריך לבחור משתמש פעיל בתפקיד ניהול', { fields: [{ field: 'adminUserId' }] });
  const problem = passwordProblem(body.password);
  if (problem) throw new HttpError(400, 'validation_error', problem, { fields: [{ field: 'password', message: problem }] });
  const hash = await hashPassword(body.password);
  if (!store.isEmpty()) throw new HttpError(409, 'already_bootstrapped', 'המערכת כבר הוקמה');
  store.importSnapshot(snap, { userId: admin.id });
  store.setCredential(admin.id, { hash, pv: 1, at: new Date().toISOString(), by: admin.id });
  const t = issueToken(store, cfg, admin.id);
  await store.flush();
  return { status: 201, body: { token: t.token, expiresAt: t.expiresAt, user: admin, seq: store.seq } };
}
