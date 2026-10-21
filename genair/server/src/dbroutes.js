// /api/db/*: snapshot, changes (long-poll), events (SSE), ops (batched writes), fetch, counters.
// Every route needs a signed-in user. Writes are checked per op (permissions.js) and applied with
// per-field last-write-wins by the op's `at` (store.js).
import { HttpError, readJson } from './http.js';
import { createWindowLimiter } from './limiter.js';
import { requireStore } from './db/index.js';
import { BAD_KEYS, COLLECTION_RE, COUNTER_RE, ID_RE, SINGLETONS, SINGLETON_ID } from './db/store.js';
import { cleanSettings, cleanUser, readSession, requireSession } from './auth.js';
import { checkOp } from './permissions.js';
import { scopeChanges, scopeSnapshot } from './readscope.js';
import { readFileMeta } from './files.js';

const MAX_OPS = 500;
const MAX_ENTITY_BYTES = 12 * 1024 * 1024;
const LONG_POLL_MAX_SEC = 25;
const HEARTBEAT_MS = 20_000;
const MAX_STREAMS_PER_USER = 8; // open SSE connections (tabs and devices) per user

const opsByUser = createWindowLimiter({ max: 1200, windowMs: 10 * 60_000, name: 'db.ops' });
const reserveByUser = createWindowLimiter({ max: 300, windowMs: 10 * 60_000, name: 'db.reserve' });
const streams = new Map(); // userId -> open SSE connections
export const resetDbLimits = () => {
  opsByUser.clear();
  reserveByUser.clear();
  streams.clear();
};

function perUser(lim, user) {
  const v = lim.hit(user.id);
  if (!v.allowed) {
    const e = new HttpError(429, 'too_many_requests', 'יותר מדי בקשות בזמן קצר. השינויים נשמרים במכשיר ויישלחו בעוד כמה דקות');
    e.retryAfter = Math.ceil(v.retryAfterMs / 1000);
    throw e;
  }
}

async function session(ctx) {
  const store = await requireStore(ctx.cfg);
  const s = requireSession(ctx.req, ctx.res, store, ctx.cfg);
  return { store, user: s.user };
}

const invalid = (message, details) => new HttpError(400, 'validation_error', message, details);

function toMs(at) {
  if (typeof at === 'number') return at;
  if (typeof at === 'string') {
    const t = Date.parse(at);
    return Number.isNaN(t) ? NaN : t;
  }
  return NaN;
}

// fields the app turns into links: only web, mail and phone links (or a path inside the app) are kept, so a
// stored value can never become a javascript: link in someone else's browser
const LINK_FIELDS = new Set(['url', 'website', 'webViewLink', 'htmlLink', 'link']);
const SAFE_LINK = /^(https?:\/\/|mailto:|tel:|\/(?!\/))/i;

function cleanData(data, i) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw invalid(`ops[${i}].data חייב להיות אובייקט`);
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (BAD_KEYS.has(k) || v === undefined) continue;
    if (LINK_FIELDS.has(k) && typeof v === 'string' && v && !SAFE_LINK.test(v.trim())) continue;
    out[k] = v;
  }
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
  return { status: 200, body: { ...scopeSnapshot(store.snapshot(), user), serverTime: Date.now(), me: user } };
}

export async function ops(ctx) {
  const { store, user } = await session(ctx);
  perUser(opsByUser, user);
  const body = await readJson(ctx.req);
  const list = parseOps(body.ops);
  const clientId = typeof body.clientId === 'string' ? body.clientId.slice(0, 64) : undefined;
  // the meta of every server file a doc points at, for the ownership check
  const files = new Map();
  for (const op of list) {
    const id = op.collection === 'docs' ? op.data?.fileId : undefined;
    if (typeof id === 'string' && !files.has(id)) files.set(id, await readFileMeta(ctx.cfg, id));
  }
  const result = store.applyOps(list, { userId: user.id, clientId, check: (op, current) => checkOp(op, current, user, store, files) });
  return { status: 200, body: { ...result, serverTime: Date.now() } };
}

/** Current state of specific entities (after a denied or stale write the client takes the server's copy). */
export async function fetchEntities(ctx) {
  const { store, user } = await session(ctx);
  const body = await readJson(ctx.req);
  if (!Array.isArray(body.items) || body.items.length > 500) throw invalid('items חייב להיות מערך (עד 500)');
  const items = body.items
    .filter((x) => x && COLLECTION_RE.test(x.c ?? '') && ID_RE.test(x.id ?? ''))
    .map((x) => store.record(x.c, x.id) ?? { c: x.c, id: x.id, seq: 0, del: true });
  return { status: 200, body: { seq: store.seq, items: scopeChanges(items, user) } };
}

export async function reserveCounter(ctx) {
  const { store, user } = await session(ctx);
  perUser(reserveByUser, user);
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
export async function changes(ctx) {
  const { store, user } = await session(ctx);
  const scoped = (r) => (r.changes.length ? { ...r, changes: scopeChanges(r.changes, user) } : r);
  const since = parseSince(ctx.url.searchParams.get('since'));
  if (Number.isNaN(since)) throw invalid('since חייב להיות מספר');
  const waitRaw = Number(ctx.url.searchParams.get('wait') ?? LONG_POLL_MAX_SEC);
  const waitSec = Math.max(0, Math.min(LONG_POLL_MAX_SEC, Number.isFinite(waitRaw) ? waitRaw : LONG_POLL_MAX_SEC));
  const now = store.changesSince(since);
  if (now.reset || now.changes.length || waitSec === 0) return { status: 200, body: scoped(now) };
  const { res } = ctx;
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
  if (res.destroyed || res.writableEnded) return null;
  return { status: 200, body: scoped(store.changesSince(since)) };
}

/** Server-sent events: `hello`, then `changes` batches (id = seq), `reset` when the client must reload; heartbeat comments. */
export async function events(ctx) {
  const { store, user: first } = await session(ctx);
  let user = first; // re-read on every heartbeat: a role change applies to the open stream too
  const { req, res, cfg } = ctx;
  const open = streams.get(first.id) ?? 0;
  if (open >= MAX_STREAMS_PER_USER) {
    const e = new HttpError(429, 'too_many_streams', 'יותר מדי חיבורים פתוחים למשתמש הזה');
    e.retryAfter = 30;
    throw e;
  }
  streams.set(first.id, open + 1);
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
  else if (backlog.changes.length) send('changes', { ...backlog, changes: scopeChanges(backlog.changes, user) }, backlog.seq);
  since = backlog.seq;

  const onChange = (e) => {
    if (e.reset) return send('reset', { seq: e.seq });
    const list = e.changes.filter((c) => c.seq > since);
    if (!list.length) return;
    since = e.seq;
    send('changes', { seq: e.seq, changes: scopeChanges(list, user), origin: e.origin }, e.seq);
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
    user = s.user;
    res.write(': ping\n\n');
  }, HEARTBEAT_MS);
  beat.unref?.();
  await new Promise((resolve) => {
    const close = () => {
      clearInterval(beat);
      store.off('change', onChange);
      const n = (streams.get(first.id) ?? 1) - 1;
      if (n > 0) streams.set(first.id, n);
      else streams.delete(first.id);
      resolve();
    };
    res.on('close', close);
  });
  return null;
}
