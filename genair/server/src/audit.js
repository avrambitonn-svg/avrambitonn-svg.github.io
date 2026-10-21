// Security log and alerts. Every sign-in, failure, lockout, password change, user/role change, denied write, bad webhook
// and setup step becomes one JSON line (stdout, or DATA_DIR/audit.log with AUDIT_LOG=file). Passwords, tokens and full
// login names are never written. A few events also drop a notification in every admin's inbox, at most once per
// ten minutes per kind, so a lockout or a bad webhook does not stay unnoticed in a log nobody reads.
import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const MAX_LOG_BYTES = 10 * 1024 * 1024;
const ALERT_EVERY_MS = 10 * 60_000;
const lastAlert = new Map();
let sink = null;

/** Tests: receive every event instead of printing it (pass null to go back to printing). */
export function setAuditSink(fn) {
  sink = fn;
}

/** "dana@example.com" -> "d***@example.com", "0501234567" -> "***4567". */
export function maskLogin(login) {
  const s = String(login ?? '').trim();
  if (!s) return '';
  if (s.includes('@')) {
    const [name, domain] = s.split('@');
    return `${name.slice(0, 1)}***@${domain.slice(0, 60)}`;
  }
  const d = s.replace(/\D/g, '');
  return d.length >= 4 ? `***${d.slice(-4)}` : '***';
}

let writing = Promise.resolve();

async function writeFileLine(cfg, line) {
  const dir = resolve(cfg.db.dataDir);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, 'audit.log');
  try {
    if ((await stat(file)).size > MAX_LOG_BYTES) await rename(file, join(dir, 'audit.log.1'));
  } catch {
    /* no file yet */
  }
  await appendFile(file, `${line}\n`, { mode: 0o600 });
}

export function audit(cfg, event, fields = {}) {
  const entry = { t: new Date().toISOString(), event, ...fields };
  if (sink) return void sink(entry);
  const line = JSON.stringify(entry);
  if (cfg?.db?.auditLog === 'file' && cfg.db.mode === 'file') {
    writing = writing.then(() => writeFileLine(cfg, line)).catch((e) => console.error('[audit] writing the log failed:', e?.message ?? e));
    return;
  }
  if (process.env.NODE_TEST_CONTEXT) return; // keep the test output readable
  console.log(`[audit] ${line}`);
}

/** Puts a notification in every active admin's inbox (not more than once per kind per ten minutes). */
export function alertAdmins(store, kind, text, { now = Date.now } = {}) {
  if (!store) return false;
  const t = now();
  if (t - (lastAlert.get(kind) ?? 0) < ALERT_EVERY_MS) return false;
  lastAlert.set(kind, t);
  const admins = store.list('users').filter((u) => u.role === 'admin' && u.active !== false);
  if (!admins.length) return false;
  store.applyOps(
    admins.map((u) => ({
      op: 'upsert',
      collection: 'notifications',
      id: `n${randomBytes(6).toString('hex')}`,
      at: t,
      data: { at: new Date(t).toISOString(), userId: u.id, text, link: '/users', read: false },
    })),
    { clientId: 'server', userId: 'security' },
  );
  return true;
}

/** Same as alertAdmins, for code that only has the config (webhooks). Silent when there is no database. */
export async function alertAdminsFor(cfg, kind, text) {
  try {
    const { getStore } = await import('./db/index.js');
    const store = await getStore(cfg);
    return alertAdmins(store, kind, text);
  } catch {
    return false;
  }
}

export const resetAlerts = () => lastAlert.clear();
