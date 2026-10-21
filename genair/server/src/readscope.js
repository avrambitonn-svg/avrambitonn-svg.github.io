// What each role may read from the shared store. Writes are checked in permissions.js; this decides what leaves
// the server in snapshots, change feeds (long-poll and SSE) and fetches.
// admin / office: everything.
// agent / engineer: no money (an agent sees only their own commission lines), no item costs, no customer
//   balances, the Priority engine's state only as "running or not", and sync errors without Priority's text.
// installer: on top of that, no suppliers or purchase orders, no customer ID numbers, and quotes only once
//   approved, as the list of what to install (no prices, signature or deposit).
import { isManager } from './auth.js';

const SYNC_ERROR = 'שגיאת סנכרון. הפרטים אצל המשרד';
const HIDDEN = { installer: new Set(['suppliers', 'purchaseOrders']) };

/** Sync-state objects ({ status, error }) keep their status; Priority's own error text stays with the managers. */
function maskSyncErrors(data) {
  let out = data;
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.status === 'string' && typeof v.error === 'string' && v.error) {
      if (out === data) out = { ...data };
      out[k] = { ...v, error: SYNC_ERROR };
    }
  }
  return out;
}

function omit(data, keys) {
  if (!keys.some((k) => k in data)) return data;
  const out = { ...data };
  for (const k of keys) delete out[k];
  return out;
}

function installerQuote(q) {
  if (q.status !== 'approved') return null;
  return {
    id: q.id, caseId: q.caseId, number: q.number, version: q.version, status: q.status, createdAt: q.createdAt, decidedAt: q.decidedAt,
    lines: (q.lines ?? []).map((l) => ({ id: l.id, itemId: l.itemId, description: l.description, qty: l.qty, unit: l.unit, room: l.room, unitPrice: 0 })),
  };
}

/** Returns (collection, data) => data to send, or null to leave the record out. Managers get everything unchanged. */
export function readFilter(user) {
  if (isManager(user)) return null;
  const role = user?.role;
  const hidden = HIDDEN[role] ?? new Set();
  return (c, data) => {
    if (!data || hidden.has(c)) return null;
    switch (c) {
      case 'integrations':
        return { id: data.id, engine: { active: Boolean(data.engine?.active) } };
      case 'money':
        return role === 'agent' && data.kind === 'commission' && data.agentId === user.id ? data : null;
      case 'catalog':
        data = omit(data, ['cost']);
        break;
      case 'customers':
        data = omit(data, role === 'installer' ? ['balance', 'idNumber'] : ['balance']);
        break;
      case 'quotes':
        if (role === 'installer') return installerQuote(data);
        break;
    }
    return maskSyncErrors(data);
  };
}

/** Applies the filter to a store snapshot. A collection the role may not see arrives as an empty list. */
export function scopeSnapshot(snap, user) {
  const f = readFilter(user);
  if (!f) return snap;
  const collections = {};
  for (const [c, list] of Object.entries(snap.collections)) collections[c] = list.map((d) => f(c, d)).filter(Boolean);
  return { ...snap, collections };
}

/**
 * Applies the filter to change records ({ c, id, seq, data } / { c, id, seq, del }). A record the role may not see
 * goes out as deleted, so a copy the device already holds (e.g. a quote that is no longer approved) is dropped too.
 */
export function scopeChanges(list, user) {
  const f = readFilter(user);
  if (!f) return list;
  return list.map((ch) => {
    if (ch.del || ch.c === 'config' || ch.c === 'settings') return ch;
    const data = f(ch.c, ch.data);
    return data ? (data === ch.data ? ch : { ...ch, data }) : { c: ch.c, id: ch.id, seq: ch.seq, del: true };
  });
}
