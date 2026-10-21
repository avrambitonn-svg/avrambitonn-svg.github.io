// A stand-in for the Supabase project the function talks to: PostgREST RPC runs the real SQL functions
// (../../migrations on a fresh local Postgres database, as the service role), Auth and Storage are in memory.
// PGURL defaults to the local test cluster used by ../../tests/db.test.js.
import { createServer } from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const ADMIN_URL = process.env.PGURL ?? 'postgres://postgres@localhost:54329/postgres?host=/tmp';

export const SERVICE_KEY = 'test-service-role-key';
export const ANON_KEY = 'test-anon-key';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

export async function startFakeSupabase({ db = 'genair_edge' } = {}) {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${db} with (force)`);
  await admin.query(`create database ${db}`);
  await admin.end();
  const pool = new pg.Pool({ connectionString: ADMIN_URL.replace('/postgres?', `/${db}?`) });
  await pool.query(readFileSync(join(here, '../../tests/stubs.sql'), 'utf8'));
  const mig = join(here, '../../migrations');
  for (const f of readdirSync(mig).sort()) await pool.query(readFileSync(join(mig, f), 'utf8'));

  const auth = { users: new Map(), tokens: new Map() };
  const storage = new Map(); // path -> { data, mime }
  const calls = [];

  function issueToken(userId) {
    const token = `${b64({ alg: 'HS256' })}.${b64({ sub: userId, role: 'authenticated' })}.${randomBytes(8).toString('hex')}`;
    auth.tokens.set(token, userId);
    return token;
  }
  const publicUser = (u) => ({ id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated', last_sign_in_at: u.last_sign_in_at, email_confirmed_at: u.email_confirmed_at });

  async function rpc(name, args) {
    const names = Object.keys(args ?? {});
    for (const n of [name, ...names]) if (!/^[a-z_]+$/.test(n)) throw Object.assign(new Error('bad name'), { code: '42601' });
    const values = names.map((n) => (args[n] === null || args[n] === undefined ? null : typeof args[n] === 'object' ? JSON.stringify(args[n]) : String(args[n])));
    const c = await pool.connect();
    try {
      await c.query('begin');
      // what PostgREST sets for a request with the service role key
      await c.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
      await c.query('set local role service_role');
      const r = await c.query(`select public.${name}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as r`, values);
      await c.query('commit');
      return r.rows[0].r;
    } catch (e) {
      await c.query('rollback').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  const readBody = (req) =>
    new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  const isService = (req) => req.headers.apikey === SERVICE_KEY && req.headers.authorization === `Bearer ${SERVICE_KEY}`;

  const server = createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const body = await readBody(req);
    calls.push([req.method, u.pathname]);
    try {
      // ---------------------------------------------------------------- PostgREST
      let m = /^\/rest\/v1\/rpc\/(\w+)$/.exec(u.pathname);
      if (m && req.method === 'POST') {
        if (!isService(req)) return send(res, 401, { code: '42501', message: 'service role only' });
        try {
          const r = await rpc(m[1], body.length ? JSON.parse(body) : {});
          if (r === '') return send(res, 204); // void
          return send(res, 200, r);
        } catch (e) {
          return send(res, e.code === '42501' ? 403 : 400, { code: e.code ?? null, message: e.message, details: e.detail ?? null, hint: e.hint ?? null });
        }
      }

      // ---------------------------------------------------------------- Auth
      if (u.pathname === '/auth/v1/user' && req.method === 'GET') {
        const token = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
        const id = auth.tokens.get(token);
        const user = id && auth.users.get(id);
        return user ? send(res, 200, publicUser(user)) : send(res, 403, { code: 403, error_code: 'bad_jwt', msg: 'invalid JWT' });
      }
      if (u.pathname === '/auth/v1/token' && req.method === 'POST') {
        if (req.headers.apikey !== ANON_KEY) return send(res, 401, { message: 'no apikey' });
        const { email, password } = JSON.parse(body);
        const user = [...auth.users.values()].find((x) => x.email === email);
        if (!user || user.password !== password) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
        user.last_sign_in_at = new Date().toISOString();
        return send(res, 200, { access_token: issueToken(user.id), refresh_token: randomBytes(8).toString('hex'), expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: publicUser(user) });
      }
      if (u.pathname.startsWith('/auth/v1/admin/')) {
        if (!isService(req)) return send(res, 401, { message: 'service role only' });
        if (u.pathname === '/auth/v1/admin/users' && req.method === 'GET') return send(res, 200, { users: [...auth.users.values()].map(publicUser), aud: 'authenticated' });
        const taken = (email, except) => [...auth.users.values()].some((x) => x.email === email && x.id !== except);
        if (u.pathname === '/auth/v1/admin/users' && req.method === 'POST') {
          const { email, password, email_confirm } = JSON.parse(body);
          if (taken(email)) return send(res, 422, { code: 422, error_code: 'email_exists', msg: 'A user with this email address has already been registered' });
          const user = { id: randomUUID(), email, password, email_confirmed_at: email_confirm ? new Date().toISOString() : null, last_sign_in_at: null };
          auth.users.set(user.id, user);
          return send(res, 200, publicUser(user));
        }
        m = /^\/auth\/v1\/admin\/users\/([\w-]+)$/.exec(u.pathname);
        if (m && req.method === 'PUT') {
          const user = auth.users.get(m[1]);
          if (!user) return send(res, 404, { msg: 'User not found' });
          const attrs = JSON.parse(body);
          if (attrs.email && taken(attrs.email, user.id)) return send(res, 422, { code: 422, error_code: 'email_exists', msg: 'email taken' });
          if (attrs.email) user.email = attrs.email;
          if (attrs.password) {
            user.password = attrs.password;
            // like GoTrue (UpdatePassword -> Logout): every session of the account ends
            for (const [t, id] of auth.tokens) if (id === user.id) auth.tokens.delete(t);
          }
          return send(res, 200, publicUser(user));
        }
      }

      // ---------------------------------------------------------------- Storage
      m = /^\/storage\/v1\/object\/(authenticated\/)?files\/(.+)$/.exec(u.pathname);
      if (m) {
        if (!isService(req)) return send(res, 400, { statusCode: '403', error: 'Unauthorized' });
        const path = m[2].split('/').map(decodeURIComponent).join('/');
        if (req.method === 'POST' && !m[1]) {
          if (storage.has(path)) return send(res, 400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
          if (body.length > 26214400) return send(res, 413, { statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' });
          storage.set(path, { data: body, mime: req.headers['content-type'] });
          return send(res, 200, { Key: `files/${path}`, Id: randomUUID() });
        }
        if (req.method === 'GET') {
          const obj = storage.get(path);
          if (!obj) return send(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
          res.writeHead(200, { 'content-type': obj.mime, 'content-length': obj.data.length });
          return res.end(obj.data);
        }
      }
      send(res, 404, { message: `fake supabase: no route ${req.method} ${u.pathname}` });
    } catch (e) {
      send(res, 500, { message: e.message });
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;

  return {
    url,
    pool,
    auth,
    storage,
    calls,
    rpc,
    issueToken,
    env: { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, SUPABASE_ANON_KEY: ANON_KEY },
    /** Creates a Supabase account linked to an app user, signed in: returns its access token. */
    async member(userId, email = `${userId}@test.local`) {
      const user = { id: randomUUID(), email, password: 'x'.repeat(12), email_confirmed_at: new Date().toISOString(), last_sign_in_at: null };
      auth.users.set(user.id, user);
      await rpc('sys_set_member', { p_auth_id: user.id, p_user_id: userId, p_login_email: email, p_must_change: false });
      return issueToken(user.id);
    },
    get: async (c, id) => (await pool.query('select data from app.entities where collection = $1 and id = $2 and del = 0', [c, id])).rows[0]?.data,
    list: async (c) => (await pool.query('select data from app.entities where collection = $1 and del = 0 order by cseq', [c])).rows.map((r) => r.data),
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await pool.end();
    },
  };
}
