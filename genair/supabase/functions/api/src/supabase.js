// Supabase from inside the function, with plain fetch: the database (PostgREST RPC as the service role),
// Auth (the signed-in user, and the admin API for employees' accounts) and Storage (bucket "files").
import { HttpError } from '../../../../server/src/http.js';

const TIMEOUT_MS = 30_000;

/** An error from a database function: PostgREST's { code, message, details }. */
export class RpcError extends Error {
  constructor(status, body) {
    super(body?.message ?? `rpc failed (${status})`);
    this.name = 'RpcError';
    this.status = status;
    this.code = body?.code ?? null;
    this.details = body?.details ?? null;
  }
}

const dbDown = () => new HttpError(503, 'db_unavailable', 'מסד הנתונים לא זמין כרגע');

const segs = (path) => String(path).split('/').map(encodeURIComponent).join('/');

async function readJsonBody(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY (all provided by Supabase in Edge Functions).
 */
export function createSupabase(env, fetchImpl = (...a) => globalThis.fetch(...a)) {
  const base = String(env.SUPABASE_URL ?? '').replace(/\/+$/, '');
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY ?? '');
  const anon = String(env.SUPABASE_ANON_KEY ?? '') || key;
  const service = { apikey: key, authorization: `Bearer ${key}` };

  async function call(path, init = {}) {
    if (!base || !key) throw new HttpError(503, 'supabase_not_configured', 'חסרים SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY בפונקציה');
    try {
      return await fetchImpl(`${base}${path}`, { ...init, signal: init.signal ?? AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw dbDown();
    }
  }

  /** Calls public.<name>(args) as the service role. Returns its JSON result. */
  async function rpc(name, args = {}) {
    const res = await call(`/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { ...service, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(args),
    });
    const data = await readJsonBody(res);
    if (!res.ok) {
      if (res.status >= 500 || res.status === 404) console.error(`[genair-api] rpc ${name} failed: ${res.status} ${data?.message ?? ''}`);
      throw new RpcError(res.status, data && typeof data === 'object' ? data : { message: String(data ?? '') });
    }
    return data;
  }

  // ------------------------------------------------------------ Auth

  /** The Supabase user of an access token, or null when the token is not valid (expired, signed out, wrong). */
  async function getUser(token) {
    const res = await call('/auth/v1/user', { headers: { apikey: anon, authorization: `Bearer ${token}` } });
    if (res.status === 401 || res.status === 403 || res.status === 400) return null;
    const data = await readJsonBody(res);
    if (!res.ok || !data?.id) throw new HttpError(503, 'auth_unavailable', 'שירות ההתחברות לא זמין כרגע');
    return data;
  }

  async function admin(method, path, body) {
    const res = await call(`/auth/v1/admin${path}`, {
      method,
      headers: { ...service, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, ok: res.ok, data: await readJsonBody(res) };
  }

  const authFailed = (r) => new HttpError(502, 'auth_admin_failed', 'שירות ההתחברות דחה את הבקשה', { status: r.status, message: r.data?.msg ?? r.data?.message ?? null });

  /** Every auth user (the admin API pages by 1000). */
  async function listUsers() {
    const out = [];
    for (let page = 1; page <= 20; page++) {
      const r = await admin('GET', `/users?page=${page}&per_page=1000`);
      if (!r.ok) throw authFailed(r);
      const list = Array.isArray(r.data?.users) ? r.data.users : [];
      out.push(...list);
      if (list.length < 1000) break;
    }
    return out;
  }

  /** Creates a confirmed email + password account, or sets the password of the one that already has this email. */
  async function upsertUser(email, password) {
    const r = await admin('POST', '/users', { email, password, email_confirm: true });
    if (r.ok && r.data?.id) return r.data;
    const exists = r.status === 422 || r.status === 409 || /already|exists/i.test(String(r.data?.msg ?? r.data?.message ?? r.data?.error_code ?? ''));
    if (!exists) throw authFailed(r);
    const found = (await listUsers()).find((u) => String(u.email ?? '').toLowerCase() === email);
    if (!found) throw authFailed(r);
    return updateUser(found.id, { password, email_confirm: true });
  }

  async function updateUser(id, attrs) {
    const r = await admin('PUT', `/users/${encodeURIComponent(id)}`, attrs);
    if (r.status === 422 || r.status === 409) throw new HttpError(409, 'login_taken', 'כתובת ההתחברות כבר רשומה לחשבון אחר');
    if (!r.ok) throw authFailed(r);
    return r.data;
  }

  /** Signs in with email + password: { access_token, refresh_token, expires_in, ... } or null. */
  async function signIn(email, password) {
    const res = await call('/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { apikey: anon, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await readJsonBody(res);
    return res.ok && data?.access_token ? data : null;
  }

  // ------------------------------------------------------------ Storage (bucket "files", private)

  async function upload(path, data, mime) {
    const res = await call(`/storage/v1/object/files/${segs(path)}`, {
      method: 'POST',
      headers: { ...service, 'content-type': mime, 'x-upsert': 'false', 'cache-control': 'private, max-age=3600' },
      body: data,
    });
    if (!res.ok) {
      const body = await readJsonBody(res);
      console.error(`[genair-api] storage upload failed: ${res.status} ${body?.message ?? body?.error ?? ''}`);
      if (res.status === 413 || /size/i.test(String(body?.message ?? body?.error ?? ''))) {
        throw new HttpError(413, 'payload_too_large', 'הקובץ גדול מדי לאחסון (מקסימום 25MB)');
      }
      throw new HttpError(502, 'storage_failed', 'שמירת הקובץ נכשלה');
    }
  }

  /** The object's Response (streamable), or null when it is not there. */
  async function download(path) {
    const res = await call(`/storage/v1/object/authenticated/files/${segs(path)}`, { headers: service, signal: AbortSignal.timeout(120_000) });
    if (res.ok) return res;
    try {
      await res.body?.cancel();
    } catch {
      /* ignore */
    }
    if (res.status === 400 || res.status === 404) return null;
    throw new HttpError(502, 'storage_failed', 'קריאת הקובץ מהאחסון נכשלה');
  }

  return { rpc, getUser, listUsers, upsertUser, updateUser, signIn, upload, download };
}
