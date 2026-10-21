// Logins on Supabase Auth: first setup (bootstrap), the users screen and passwords set by an admin.
// Each employee's account email is derived, not typed (CONTRACT.md "Logins"): the phone as
// <05...>@phone.genair.app, else the email. The link account <-> app user is app.members (sys_set_member).
import { HttpError, clientIp, readJson, safeEqual } from '../../../../server/src/http.js';
import { createWindowLimiter } from '../../../../server/src/limiter.js';
import { passwordProblem, temporaryPassword, validSnapshot } from '../../../../server/src/auth.js';
import { requireStore } from './db.js';
import { isManager } from './access.js';
import { RpcError } from './supabase.js';

export const PHONE_DOMAIN = 'phone.genair.app';

const phoneDigits = (p) => {
  const d = String(p ?? '').replace(/\D/g, '');
  return d.startsWith('972') ? `0${d.slice(3)}` : d;
};

/** What the employee types: their phone (05...) or, without one, their email. null when they have neither. */
export function userLogin(u) {
  const p = phoneDigits(u?.phone);
  if (p.length >= 9) return p;
  const e = String(u?.email ?? '').trim().toLowerCase();
  return e.includes('@') ? e : null;
}

/** CONTRACT.md loginEmail: an address stays (lowercased), a phone becomes <phone>@phone.genair.app. */
export function loginEmail(input) {
  const s = String(input ?? '').trim();
  if (!s) return null;
  if (s.includes('@')) return s.toLowerCase();
  const p = phoneDigits(s);
  return p.length >= 9 ? `${p}@${PHONE_DOMAIN}` : null;
}

const userLoginEmail = (u) => loginEmail(userLogin(u));

const noLogin = () =>
  new HttpError(400, 'validation_error', 'למשתמש אין טלפון או אימייל, ולכן אין לו שם משתמש להתחברות. צריך להוסיף טלפון או אימייל בכרטיס המשתמש', {
    fields: [{ field: 'phone' }, { field: 'email' }],
  });

const loginTaken = () => new HttpError(409, 'login_taken', 'למשתמש אחר יש אותו טלפון או אימייל, ולכן אותו שם משתמש. צריך לתקן באחד מהם');

// ------------------------------------------------------------ users screen

/** GET /api/auth/users (admin, office): who can sign in. */
export async function listCredentials({ cfg, caller }) {
  if (!isManager(caller.user)) throw new HttpError(403, 'forbidden', 'אין הרשאה');
  const store = await requireStore(cfg);
  const [members, accounts] = await Promise.all([
    cfg.edge.rpc('sys_members'),
    cfg.edge.sb.listUsers().catch((e) => {
      console.error('[genair-api] listing auth users failed:', e?.message ?? e);
      return [];
    }),
  ]);
  const byUser = new Map((members ?? []).map((m) => [m.userId, m]));
  const lastSignIn = new Map(accounts.map((a) => [a.id, a.last_sign_in_at ?? null]));
  const users = store.list('users').map((u) => {
    const m = byUser.get(u.id);
    return {
      id: u.id,
      hasPassword: Boolean(m),
      mustChange: Boolean(m?.mustChange),
      lastLoginAt: (m && lastSignIn.get(m.authId)) ?? null,
      passwordSetAt: m?.passwordSetAt ?? null,
      login: userLogin(u),
    };
  });
  return { status: 200, body: { users } };
}

/** POST /api/auth/users/:id/password (admin): set a password, or get a one-time temporary password back when none is given. */
export async function setUserPassword({ req, cfg, params, caller }) {
  if (caller.user.role !== 'admin') throw new HttpError(403, 'forbidden', 'רק מנהל מערכת יכול לקבוע סיסמה למשתמש אחר');
  const store = await requireStore(cfg);
  const target = store.get('users', params.id);
  if (!target) throw new HttpError(404, 'not_found', 'המשתמש לא נמצא');
  const body = await readJson(req);
  let temporary;
  let password = body.password;
  if (password === undefined || password === null || password === '') password = temporary = temporaryPassword();
  const problem = passwordProblem(password);
  if (problem) throw new HttpError(400, 'validation_error', problem, { fields: [{ field: 'password', message: problem }] });
  const login = userLogin(target);
  const email = loginEmail(login);
  if (!email) throw noLogin();
  if (store.list('users').some((u) => u.id !== target.id && userLoginEmail(u) === email)) throw loginTaken();
  const members = (await cfg.edge.rpc('sys_members')) ?? [];
  if (members.some((m) => m.loginEmail === email && m.userId !== target.id)) throw loginTaken();
  const mine = members.find((m) => m.userId === target.id);
  const account = mine
    ? await cfg.edge.sb.updateUser(mine.authId, { email, password, email_confirm: true })
    : await cfg.edge.sb.upsertUser(email, password);
  const mustChange = Boolean(temporary) || body.mustChange === true;
  await cfg.edge.rpc('sys_set_member', { p_auth_id: account?.id ?? mine.authId, p_user_id: target.id, p_login_email: email, p_must_change: mustChange });
  return { status: 200, body: temporary ? { ok: true, temporaryPassword: temporary, login } : { ok: true, login } };
}

// ------------------------------------------------------------ first setup

const failuresByIp = createWindowLimiter({ max: 30, windowMs: 15 * 60_000 });
export const resetBootstrapLimits = () => failuresByIp.clear();

function tooMany(retryMs) {
  const e = new HttpError(429, 'too_many_attempts', `יותר מדי ניסיונות. אפשר לנסות שוב בעוד ${Math.ceil(retryMs / 60000)} דקות`);
  e.retryAfter = Math.ceil(retryMs / 1000);
  return e;
}

const already = () => new HttpError(409, 'already_bootstrapped', 'המערכת כבר הוקמה. מתחברים עם משתמש וסיסמה');

/**
 * POST /api/auth/bootstrap { snapshot, adminUserId, password, bootstrapToken } - first run only, and only with
 * the BOOTSTRAP_TOKEN secret. Imports the app's data, opens the admin's account, signs in.
 * If the data went in but opening the account failed (no member yet), the same call finishes the job.
 */
export async function bootstrap({ req, cfg }) {
  const secret = String(cfg.edge.env.BOOTSTRAP_TOKEN ?? '').trim();
  const ip = clientIp(req, 0);
  const peek = failuresByIp.peek(ip);
  if (!peek.allowed) throw tooMany(peek.retryAfterMs);
  if (!secret) throw new HttpError(403, 'bootstrap_token_required', 'כדי להקים את המערכת צריך להגדיר בפונקציה קוד הקמה (BOOTSTRAP_TOKEN) ולהזין אותו כאן');
  const { rpc, sb } = cfg.edge;
  const empty = await rpc('sys_is_empty');
  const resume = !empty && !((await rpc('sys_members')) ?? []).length;
  if (!empty && !resume) throw already();
  const body = await readJson(req);
  if (!safeEqual(String(body.bootstrapToken ?? ''), secret)) {
    failuresByIp.hit(ip);
    throw new HttpError(401, 'invalid_bootstrap_token', 'קוד ההקמה (BOOTSTRAP_TOKEN) שגוי');
  }
  const problem = passwordProblem(body.password);
  let admin;
  let seq;
  if (empty) {
    const snap = validSnapshot(body.snapshot);
    admin = (snap.collections.users ?? []).find((u) => u.id === body.adminUserId);
    if (!admin || admin.role !== 'admin' || admin.active === false) throw new HttpError(400, 'validation_error', 'צריך לבחור משתמש פעיל בתפקיד ניהול', { fields: [{ field: 'adminUserId' }] });
    if (problem) throw new HttpError(400, 'validation_error', problem, { fields: [{ field: 'password', message: problem }] });
    if (!loginEmail(userLogin(admin))) throw noLogin();
    try {
      seq = (await rpc('sys_import', { snapshot: snap })).seq;
    } catch (e) {
      if (e instanceof RpcError && /already_bootstrapped/.test(e.message)) throw already();
      throw e;
    }
  } else {
    // the data is already in (an earlier attempt stopped after the import): only the account is missing
    const store = await requireStore(cfg);
    admin = store.get('users', String(body.adminUserId ?? ''));
    if (!admin || admin.role !== 'admin' || admin.active === false) throw new HttpError(400, 'validation_error', 'צריך לבחור משתמש פעיל בתפקיד ניהול', { fields: [{ field: 'adminUserId' }] });
    if (problem) throw new HttpError(400, 'validation_error', problem, { fields: [{ field: 'password', message: problem }] });
    if (!loginEmail(userLogin(admin))) throw noLogin();
    seq = store.seq;
  }
  const email = loginEmail(userLogin(admin));
  const account = await sb.upsertUser(email, body.password);
  await rpc('sys_set_member', { p_auth_id: account.id, p_user_id: admin.id, p_login_email: email, p_must_change: false });
  const s = await sb.signIn(email, body.password);
  const session = s ? { access_token: s.access_token, refresh_token: s.refresh_token, expires_in: s.expires_in, expires_at: s.expires_at } : null;
  return { status: 201, body: { session, user: admin, seq, login: userLogin(admin) } };
}
