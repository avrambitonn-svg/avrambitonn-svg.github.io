// The Priority sync without a long-running process: pg_cron calls POST /api/priority/cron every minute and each
// call is one round of the server's own engine (psync/engine.js) over the request's PgStore. "hot" every call,
// "warm" every PRIORITY_SYNC_WARM_SEC, "full" every 6 hours; the push sweep of every hot / full round sends
// what users changed (there is no change event here, so pushes wait for the next minute instead of 1.5 s).
// The engine's state stays in integrations/priority. One round at a time: a lease in integrations/priority-lock.
// A round stops starting new calls to Priority at PRIORITY_EDGE_DEADLINE_SEC (default 110 s) and the next
// round carries on, so the function never runs into the Edge Functions time limit.
import { randomBytes } from 'node:crypto';
import { HttpError, readJson, safeEqual } from '../../../../server/src/http.js';
import { createPriorityClient } from '../../../../server/src/priority.js';
import { ORIGIN, PrioritySync } from '../../../../server/src/psync/engine.js';
import { requireStore } from './db.js';
import { readFileMeta, readStoredFile } from './files.js';
import { isManager, requireMember } from './access.js';

const HOUR = 3600_000;
const LOCK = { c: 'integrations', id: 'priority-lock' };
const LEASE_MS = 10 * 60_000;
export const STOPPED = 'הסבב נעצר כדי לא לחרוג מזמן הריצה של הפונקציה, וימשיך בסבב הבא';

function reasonOff(cfg) {
  if (!cfg.prioritySync.enabled) return 'הסנכרון האוטומטי כבוי (PRIORITY_SYNC)';
  if (cfg.priority.mode === 'off' || !cfg.priority.configured) return 'החיבור ל-Priority לא מוגדר';
  return null;
}

const deadlineMs = (env) => (Number(env.PRIORITY_EDGE_DEADLINE_SEC) > 0 ? Number(env.PRIORITY_EDGE_DEADLINE_SEC) : 110) * 1000;

/** The Priority client, refusing new calls after the deadline (the engine treats a timeout as "stop this round"). */
function untilDeadline(client, until) {
  const guard = (m) => async (...a) => {
    if (Date.now() > until) throw new HttpError(504, 'priority_timeout', STOPPED);
    return client[m](...a);
  };
  return { get: guard('get'), post: guard('post'), patch: guard('patch'), del: guard('del') };
}

function engineFor(cfg, store, until = Infinity) {
  return new PrioritySync({
    store,
    client: untilDeadline(cfg.edge.opts.priorityClient ?? createPriorityClient(cfg.priority), until),
    priority: cfg.priority,
    sync: cfg.prioritySync,
    readFile: (id) => readStoredFile(cfg, id).catch(() => null),
    readFileMeta: (id) => readFileMeta(cfg, id),
  });
}

/** What engine.start() writes, written only when it changed (not every minute). */
function activate(engine, now) {
  const st = engine.state();
  const want = { active: true, mode: engine.p.mode, write: engine.canWrite, streams: [...engine.cfg.streams] };
  const cur = st.engine ?? {};
  if (cur.active && cur.mode === want.mode && cur.write === want.write && String(cur.streams) === String(want.streams) && st.customersSince) return;
  engine.saveState({
    engine: { ...want, startedAt: cur.active && cur.startedAt ? cur.startedAt : new Date(now).toISOString() },
    // customers opened in Priority from now on are imported (PRIORITY_IMPORT_CUSTOMERS=new)
    customersSince: st.customersSince ?? new Date(now).toISOString(),
  });
}

/** Which rounds are due now. A full round that ran out of time is tried again after half an hour. */
export function dueKinds(state, sync, now = Date.now()) {
  const ago = (k) => now - (Date.parse(state.runs?.[k]?.at ?? '') || 0);
  const full = state.runs?.full;
  if (ago('full') >= 6 * HOUR || (full?.error === STOPPED && ago('full') >= HOUR / 2)) return ['full'];
  // a full round did the warm streams too
  return Math.min(ago('warm'), ago('full')) >= sync.warmSec * 1000 ? ['hot', 'warm'] : ['hot'];
}

/** Waits for what the round queued behind itself (a new customer's quotes and contacts go out at once). */
async function settle(engine) {
  for (let c = null; c !== engine.chain; ) {
    c = engine.chain;
    await c;
  }
}

// ------------------------------------------------------------ one round at a time

async function applyLock(cfg, op) {
  const r = await cfg.edge.rpc('sys_apply', { ops: [{ collection: LOCK.c, id: LOCK.id, at: Date.now(), ...op }], origin: ORIGIN });
  return r?.results?.[0]?.status;
}

/** Takes the lease, or null while another round holds it. `store` was loaded just before (to see a stale lease). */
async function acquire(cfg, store) {
  const lease = { token: randomBytes(9).toString('hex'), until: new Date(Date.now() + LEASE_MS).toISOString() };
  const status = await applyLock(cfg, { op: 'patch', data: { lease }, ifUnset: 'lease' });
  if (status === 'ok') return lease;
  // the first round ever creates the lock; sys_reserve tells exactly one caller it was first
  const first = async (key) => Number((await cfg.edge.rpc('sys_reserve', { p_key: key, p_count: 1 }))?.from) === 1;
  if (status === 'missing') {
    if (!(await first('psync.lock'))) return null;
    await applyLock(cfg, { op: 'upsert', data: { lease } });
    return lease;
  }
  // held: taken over only when it expired (a round that was killed), and by exactly one caller
  const held = store.get(LOCK.c, LOCK.id)?.lease;
  if (status !== 'conflict' || !held?.token || Date.parse(held.until) > Date.now()) return null;
  if (!(await first(`psync.break.${String(held.token).replace(/[^a-f0-9]/g, '').slice(0, 24)}`))) return null;
  await applyLock(cfg, { op: 'patch', data: { lease } });
  return lease;
}

const release = (cfg) => applyLock(cfg, { op: 'patch', unset: ['lease'] }).catch((e) => console.error('[priority-sync] releasing the lock failed:', e?.message ?? e));

/**
 * One round: { busy: true } when another one is running, else { kinds, ms, lastError, runs }.
 * kinds: which rounds to run (default: what is due).
 */
export async function runRound(cfg, { kinds } = {}) {
  const t0 = Date.now();
  const until = t0 + deadlineMs(cfg.edge.env);
  const store = await requireStore(cfg);
  if (!(await acquire(cfg, store))) return { busy: true };
  try {
    const engine = engineFor(cfg, store, until);
    activate(engine, t0);
    const todo = kinds ?? dueKinds(engine.state(), cfg.prioritySync, t0);
    const done = [];
    for (const kind of todo) {
      if (Date.now() > until) break;
      await engine.run(kind); // never throws: errors land in the engine's state
      await settle(engine);
      done.push(kind);
      await store.persist();
    }
    const st = engine.state();
    return { kinds: done, ms: Date.now() - t0, lastError: st.lastError ?? null, runs: Object.fromEntries(done.map((k) => [k, st.runs?.[k] ?? null])), canWrite: engine.canWrite };
  } finally {
    await store.persist().catch((e) => console.error('[priority-sync] saving failed:', e?.message ?? e));
    await release(cfg);
  }
}

/** Turned off: the sync screen stops showing the engine as running. */
async function deactivate(cfg) {
  const store = await requireStore(cfg);
  const st = store.get('integrations', 'priority');
  if (!st?.engine?.active) return;
  store.applyOps([{ op: 'patch', collection: 'integrations', id: 'priority', data: { engine: { ...st.engine, active: false } }, at: Date.now() }], { clientId: ORIGIN, userId: ORIGIN });
}

// ------------------------------------------------------------ routes

async function manager(ctx) {
  const { user } = await requireMember(ctx.cfg, ctx.req);
  if (!isManager(user)) throw new HttpError(403, 'forbidden', 'רק הנהלה ומשרד');
  return user;
}

export async function syncStatus(ctx) {
  await manager(ctx);
  const off = reasonOff(ctx.cfg);
  if (off) return { status: 200, body: { running: false, reason: off } };
  const engine = engineFor(ctx.cfg, await requireStore(ctx.cfg));
  return { status: 200, body: { running: true, ...engine.status() } };
}

const KINDS = new Set(['hot', 'warm', 'full']);
const busy = () => new HttpError(409, 'sync_busy', 'סבב סנכרון כבר רץ כרגע. אפשר לנסות שוב בעוד דקה');

export async function syncRun(ctx) {
  await manager(ctx);
  const off = reasonOff(ctx.cfg);
  if (off) throw new HttpError(503, 'sync_off', off);
  const body = await readJson(ctx.req).catch(() => ({}));
  const kind = KINDS.has(body?.kind) ? body.kind : 'full';
  const r = await runRound(ctx.cfg, { kinds: [kind] });
  if (r.busy) throw busy();
  const engine = engineFor(ctx.cfg, await requireStore(ctx.cfg));
  return { status: 200, body: { ok: true, kind, ...engine.status(), round: r } };
}

/**
 * Priority -> here: a business rule in Priority posts to /api/priority/webhook?key=<PRIORITY_WEBHOOK_SECRET>.
 * The body only says "look now"; the data is read from Priority itself.
 */
export async function syncWebhook(ctx) {
  const secret = ctx.cfg.prioritySync.webhookSecret;
  if (!secret) throw new HttpError(503, 'webhook_off', 'PRIORITY_WEBHOOK_SECRET לא הוגדר בשרת');
  const key = ctx.url.searchParams.get('key') ?? ctx.req.headers['x-webhook-key'] ?? '';
  if (!safeEqual(String(key), secret)) throw new HttpError(401, 'invalid_key', 'מפתח שגוי');
  const off = reasonOff(ctx.cfg);
  if (off) throw new HttpError(503, 'sync_off', off);
  const body = await readJson(ctx.req).catch(() => ({}));
  const form = String(body?.form ?? ctx.url.searchParams.get('form') ?? '').toUpperCase();
  const kind = ['CUSTOMERS', 'LOGPART', 'PARTBAL', 'OBLIGO'].includes(form) ? 'warm' : 'hot';
  const round = runRound(ctx.cfg, { kinds: [kind] }).catch((e) => console.error('[priority-sync]', e?.message ?? e));
  // answer Priority at once when the platform lets the round finish after the response
  if (ctx.cfg.edge.opts.waitUntil) ctx.cfg.edge.opts.waitUntil(round);
  else await round;
  return { status: 202, body: { ok: true, queued: kind } };
}

/** POST /api/priority/cron (x-cron-key: PRIORITY_CRON_SECRET) - pg_cron, every minute. */
export async function syncCron(ctx) {
  const secret = String(ctx.cfg.edge.env.PRIORITY_CRON_SECRET ?? '').trim();
  if (!secret) throw new HttpError(503, 'cron_off', 'PRIORITY_CRON_SECRET לא הוגדר בפונקציה');
  if (!safeEqual(String(ctx.req.headers['x-cron-key'] ?? ''), secret)) throw new HttpError(401, 'invalid_key', 'מפתח שגוי');
  const off = reasonOff(ctx.cfg);
  if (off) {
    await deactivate(ctx.cfg);
    return { status: 200, body: { ok: true, skipped: off } };
  }
  const r = await runRound(ctx.cfg);
  if (r.busy) return { status: 200, body: { ok: true, skipped: 'busy' } };
  return { status: 200, body: { ok: true, ...r } };
}
