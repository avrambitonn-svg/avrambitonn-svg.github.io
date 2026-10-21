// One sync engine per process, started with the server (PRIORITY_SYNC=on), and its routes:
// status and "sync now" for managers, and a webhook Priority can call when something changes there.
import { HttpError, readJson, safeEqual } from '../http.js';
import { alertAdminsFor, audit } from '../audit.js';
import { getStore, requireStore } from '../db/index.js';
import { requireSession } from '../auth.js';
import { createPriorityClient } from '../priority.js';
import { PrioritySync } from './engine.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { filesDir } from '../files.js';

let engine = null;

/** Starts the engine when sync is on, Priority is configured and the shared database is up. */
export async function startPrioritySync(cfg, opts = {}) {
  if (reasonOff(cfg)) return null;
  if (engine) return engine;
  const store = await getStore(cfg);
  if (!store) return null;
  const read = (id) => readFile(join(filesDir(cfg), String(id).replace(/[^A-Za-z0-9_.-]/g, ''))).catch(() => null);
  engine = new PrioritySync({ store, client: opts.client ?? createPriorityClient(cfg.priority), priority: cfg.priority, sync: cfg.prioritySync, readFile: read, ...opts }).start(opts);
  console.log(`[priority-sync] running (${cfg.priority.mode}, ${engine.canWrite ? 'read + write' : 'read only'})`);
  return engine;
}

export async function stopPrioritySync() {
  const e = engine;
  engine = null;
  await e?.stop();
}

export const currentEngine = () => engine;

function reasonOff(cfg) {
  if (!cfg.prioritySync.enabled) return 'הסנכרון האוטומטי כבוי (PRIORITY_SYNC)';
  if (cfg.db.mode === 'off') return 'אין מסד נתונים משותף בשרת (DB_MODE)';
  if (cfg.priority.mode === 'off' || !cfg.priority.configured) return 'החיבור ל-Priority לא מוגדר';
  return null;
}

async function manager(ctx) {
  const store = await requireStore(ctx.cfg);
  const { user } = requireSession(ctx.req, ctx.res, store, ctx.cfg);
  if (!['admin', 'office'].includes(user.role)) throw new HttpError(403, 'forbidden', 'רק הנהלה ומשרד');
  return user;
}

export async function syncStatus(ctx) {
  await manager(ctx);
  if (!engine) return { status: 200, body: { running: false, reason: reasonOff(ctx.cfg) ?? 'המנוע לא עלה. בדקו את יומן השרת' } };
  return { status: 200, body: { running: true, ...engine.status() } };
}

const KINDS = new Set(['hot', 'warm', 'full']);

export async function syncRun(ctx) {
  await manager(ctx);
  if (!engine) throw new HttpError(503, 'sync_off', reasonOff(ctx.cfg) ?? 'הסנכרון האוטומטי לא פועל');
  const body = await readJson(ctx.req).catch(() => ({}));
  const kind = KINDS.has(body?.kind) ? body.kind : 'full';
  await engine.trigger(kind);
  return { status: 200, body: { ok: true, kind, ...engine.status() } };
}

/**
 * Priority -> here: a business rule in Priority posts to /api/priority/webhook?key=<PRIORITY_WEBHOOK_SECRET>
 * when a document changes. The body is not trusted; it only says "look now", and the data is read
 * from Priority itself.
 */
export async function syncWebhook(ctx) {
  const secret = ctx.cfg.prioritySync.webhookSecret;
  if (!secret) throw new HttpError(503, 'webhook_off', 'PRIORITY_WEBHOOK_SECRET לא הוגדר בשרת');
  const key = ctx.url.searchParams.get('key') ?? ctx.req.headers['x-webhook-key'] ?? '';
  if (!safeEqual(String(key), secret)) {
    audit(ctx.cfg, 'webhook_rejected', { service: 'priority' });
    void alertAdminsFor(ctx.cfg, 'webhook_priority', 'התקבלה קריאה עם מפתח שגוי ל-Webhook של Priority');
    throw new HttpError(401, 'invalid_key', 'מפתח שגוי');
  }
  if (!engine) throw new HttpError(503, 'sync_off', 'הסנכרון האוטומטי לא פועל');
  const body = await readJson(ctx.req).catch(() => ({}));
  const form = String(body?.form ?? ctx.url.searchParams.get('form') ?? '').toUpperCase();
  const kind = ['CUSTOMERS', 'LOGPART', 'PARTBAL', 'OBLIGO'].includes(form) ? 'warm' : 'hot';
  engine.trigger(kind).catch(() => {}); // the engine logs its own failures
  return { status: 202, body: { ok: true, queued: kind } };
}
