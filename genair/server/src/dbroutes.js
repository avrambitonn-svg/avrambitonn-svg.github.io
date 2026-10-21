// /api/db/*: snapshot, changes (long-poll), events (SSE), ops (batched writes), fetch, counters.
// Every route needs a signed-in user. Writes are checked per op (permissions.js) and applied with
// per-field last-write-wins by the op's `at` (store.js).
import { HttpError, readJson } from './http.js';
import { requireStore } from './db/index.js';
import { BAD_KEYS, COLLECTION_RE, COUNTER_RE, ID_RE, SINGLETONS, SINGLETON_ID } from './db/store.js';
import { cleanSettings, cleanUser, readSession, requireSession } from './auth.js';
import { checkOp, readChanges, readSnapshot, sanitizeOp } from './permissions.js';
import { alertAdmins, audit } from './audit.js';
import { readFileMeta } from './files.js';
import { openStream, spend } from './ratelimit.js';

const MAX_OPS = 500;
const MAX_ENTITY_BYTES = 12 * 1024 * 1024;
const LONG_POLL_MAX_SEC = 25;
const HEARTBEAT_MS = 20_000;

async function session(ctx) {
  const store = await requireStore(ctx.cfg);
  const s = requireSession(ctx.req, ctx.res, store, ctx.cfg);
  return { store, user: s.user };
}

const MANAGER_ROLES = new Set(['admin', 'office']);

const invalid = (message, details) => new HttpError(400, 'validation_error', message, details);

function toMs(at) {
  if (typeof at === 'number') return at;
  if (typeof at === 'string') {
    const t = Date.parse(at);
    return Number.isNaN(t) ? NaN : t;
  }
  return NaN;
}

function cleanData(data, i) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw invalid(`ops[${i}].data חייב להיות אובייקט`);
  const out = {};
  for (const [k, v] of Object.entries(data)) if (!BAD_KEYS.has(k) && v !== undefined) out[k] = v;
  return out;
}

/** Validates and normalizes a batch of ops from a client. */
export function parseOps(list) {
  if (!Array.isArray(list) || list.length === 0) throw invalid('ops חייב להיות מערך לא ריק');
  if (list.length > MAX_OPS) throw invalid(`עד ${MAX_OPS} פעולות בבקשה`);
  return list.map((raw, i) => {
    if (!raw || typeof raw !== 'object') throw invalid(`ops[${i}] לא תקין`);
    const op = raw.op;
    if (!['upsert', 'patch', 'remove'].includes(op)) throw invalid(`ops[${i}].op לא תקין`);
    if (!COLLECTION_RE.test(raw.collection ?? '')) throw invalid(`ops[${i}].collection לא תקין`);
    const singleton = SINGLETONS.has(raw.collection);
    const id = singleton ? SINGLETON_ID : raw.id;
    if (typeof id !== 'string' || !ID_RE.test(id)) throw invalid(`ops[${i}].id לא תקין`);
    const at = toMs(raw.at);
    if (!Number.isFinite(at)) throw invalid(`ops[${i}].at חייב להיות זמן`);
    const out = { op, collection: raw.collection, id, at };
    if (op !== 'remove') {
      let data = cleanData(raw.data ?? {}, i);
      if (raw.collection === 'users') data = cleanUser(data);
      if (raw.collection === 'settings') data = cleanSettings(data);
      if (Buffer.byteLength(JSON.stringify(data)) > MAX_ENTITY_BYTES) throw invalid(`ops[${i}] גדול מדי`);
      out.data = data;
    }
    if (op === 'patch' && raw.unset !== undefined) {
      if (!Array.isArray(raw.unset) || raw.unset.length > 200 || raw.unset.some((f) => typeof f !== 'string' || BAD_KEYS.has(f))) throw invalid(`ops[${i}].unset לא תקין`);
      out.unset = raw.unset;
    }
    if (op === 'patch' && raw.ifUnset !== undefined) {
      if (typeof raw.ifUnset !== 'string' || BAD_KEYS.has(raw.ifUnset)) throw invalid(`ops[${i}].ifUnset לא תקין`);
      out.ifUnset = raw.ifUnset;
    }
    if (singleton && op === 'remove') throw invalid(`אי אפשר למחוק את ${raw.collection}`);
    return out;
  });
}

export async function snapshot(ctx) {
  const { store, user } = await session(ctx);
  return { status: 200, body: { ...readSnapshot(store.snapshot(), user), serverTime: Date.now(), me: user } };
}

export async function ops(ctx) {
  const { store, user } = await session(ctx);
  const { cfg } = ctx;
  spend('db-ops', user.id, cfg.limits.opsPerMin);
  const body = await readJson(ctx.req);
  const clientId = typeof body.clientId === 'string' ? body.clientId.slice(0, 64) : undefined;
  const manager = MANAGER_ROLES.has(user.role);
  const list = parseOps(body.ops).map((op) => sanitizeOp(op, user, store.get(op.collection, op.id)));
  // a document may point only at a file its own uploader sent (managers may link any file)
  const foreignFile = new WeakSet();
  if (!manager) {
    for (const op of list) {
      const id = op.collection === 'docs' ? op.data?.fileId : undefined;
      if (typeof id !== 'string') continue;
      const meta = await readFileMeta(cfg, id);
      if (!meta || meta.by !== user.id) foreignFile.add(op);
    }
  }
  const result = store.applyOps(list, {
    userId: user.id,
    clientId,
    check: (op, current) => (foreignFile.has(op) ? 'file_not_yours' : checkOp(op, current, user, store)),
  });
  auditOps(cfg, store, user, list, result.results);
  return { status: 200, body: { ...result, serverTime: Date.now() } };
}

/** The security trail of a write batch: what was refused, and every change to people, roles and the organisation's settings. */
function auditOps(cfg, store, user, list, results) {
  let denied = 0;
  list.forEach((op, i) => {
    const r = results[i];
    if (!r) return;
    if (r.status === 'denied') {
      if (denied++ < 20) audit(cfg, 'op_denied', { user: user.id, role: user.role, collection: op.collection, id: op.id, op: op.op, reason: r.error });
      return;
    }
    if (op.collection === 'users' && r.status !== 'stale' && r.status !== 'missing') {
      audit(cfg, 'user_changed', { by: user.id, target: op.id, op: op.op, role: op.data?.role, active: op.data?.active });
      if (op.data?.role === 'admin') alertAdmins(store, 'admin_granted', `הרשאת ניהול ניתנה למשתמש (${op.id}) על ידי ${user.name ?? user.id}`);
    } else if ((op.collection === 'config' || op.collection === 'settings') && r.status !== 'stale') {
      audit(cfg, 'org_settings_changed', { by: user.id, collection: op.collection, fields: Object.keys(op.data ?? {}).slice(0, 20) });
    }
  });
}

/** Current state of specific entities (after a denied or stale write the client takes the server's copy). */
export async function fetchEntities(ctx) {
  const { store, user } = await session(ctx);
  const body = await readJson(ctx.req);
  if (!Array.isArray(body.items) || body.items.length > 500) throw invalid('items חייב להיות מערך (עד 500)');
  const items = body.items
    .filter((x) => x && COLLECTION_RE.test(x.c ?? '') && ID_RE.test(x.id ?? ''))
    .map((x) => store.record(x.c, x.id) ?? { c: x.c, id: x.id, seq: 0, del: true });
  return { status: 200, body: { seq: store.seq, items: readChanges(items, user) } };
}

export async function reserveCounter(ctx) {
  const { store } = await session(ctx);
  const body = await readJson(ctx.req);
  if (typeof body.key !== 'string' || !COUNTER_RE.test(body.key)) throw invalid('key לא תקין');
  const count = body.count === undefined ? 1 : Number(body.count);
  if (!Number.isInteger(count) || count < 1 || count > 100) throw invalid('count חייב להיות בין 1 ל-100');
  return { status: 200, body: store.reserve(body.key, count) };
}

const parseSince = (v) => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== '' && Number.isInteger(n) && n >= 0 ? n : NaN;
};

/** Long-poll: answers at once when there are changes after `since`, else waits up to `wait` seconds (max 25). */
const forUser = (batch, user) => (batch.changes ? { ...batch, changes: readChanges(batch.changes, user) } : batch);

export async function changes(ctx) {
  const { store, user } = await session(ctx);
  const since = parseSince(ctx.url.searchParams.get('since'));
  if (Number.isNaN(since)) throw invalid('since חייב להיות מספר');
  const waitRaw = Number(ctx.url.searchParams.get('wait') ?? LONG_POLL_MAX_SEC);
  const waitSec = Math.max(0, Math.min(LONG_POLL_MAX_SEC, Number.isFinite(waitRaw) ? waitRaw : LONG_POLL_MAX_SEC));
  const now = store.changesSince(since);
  if (now.reset || now.changes.length || waitSec === 0) return { status: 200, body: forUser(now, user) };
  const { res } = ctx;
  const free = openStream(user.id, ctx.cfg.limits.streamsPerUser);
  try {
    await new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        store.off('change', onChange);
        res.off('close', done);
        resolve();
      };
      const onChange = () => done();
      const timer = setTimeout(done, waitSec * 1000);
      store.on('change', onChange);
      res.on('close', done); // the client went away (req 'close' fires as soon as the body is read)
    });
  } finally {
    free();
  }
  if (res.destroyed || res.writableEnded) return null;
  return { status: 200, body: forUser(store.changesSince(since), user) };
}

/** Server-sent events: `hello`, then `changes` batches (id = seq), `reset` when the client must reload; heartbeat comments. */
export async function events(ctx) {
  const { store, user } = await session(ctx);
  const { req, res, cfg } = ctx;
  const free = openStream(user.id, cfg.limits.streamsPerUser);
  const sinceQ = parseSince(ctx.url.searchParams.get('since'));
  const sinceH = parseSince(req.headers['last-event-id']);
  let since = Number.isNaN(sinceQ) ? (Number.isNaN(sinceH) ? store.seq : sinceH) : sinceQ;

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.flushHeaders?.();
  const send = (event, data, id) => {
    if (res.writableEnded) return;
    res.write(`${id !== undefined ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  res.write('retry: 3000\n\n');
  send('hello', { seq: store.seq, user: user.id });

  const backlog = store.changesSince(since);
  if (backlog.reset) send('reset', { seq: store.seq });
  else if (backlog.changes.length) send('changes', forUser(backlog, user), backlog.seq);
  since = backlog.seq;

  const onChange = (e) => {
    if (e.reset) return send('reset', { seq: e.seq });
    const list = readChanges(e.changes.filter((c) => c.seq > since), user);
    since = e.seq;
    if (!list.length) return;
    send('changes', { seq: e.seq, changes: list, origin: e.origin }, e.seq);
  };
  store.on('change', onChange);
  const beat = setInterval(() => {
    // the session may have been revoked or the user deactivated since the stream opened
    const s = readSession(req, store, cfg);
    if (!s || s.error) {
      send('signout', { reason: s?.error ?? 'missing' });
      res.end();
      return;
    }
    res.write(': ping\n\n');
  }, HEARTBEAT_MS);
  beat.unref?.();
  await new Promise((resolve) => {
    const close = () => {
      clearInterval(beat);
      store.off('change', onChange);
      free();
      resolve();
    };
    res.on('close', close);
  });
  return null;
}
