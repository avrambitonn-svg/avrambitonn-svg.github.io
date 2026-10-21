// Who may read and write what in the shared store.
//
// Writes (checkOp, per op):
//   admin / office: everything. agent / engineer: everything except users, config and org settings.
//   installer: field work only (appointments, service calls, stock, docs, messages, chat, tasks, notifications,
//   leaves, units, activities), plus the few case / contract fields that closing a job updates.
//   Nobody but the server writes the sync state (Priority links, statuses) or the audit trail's past.
// Reads (canRead / readFilter): everyone signed in sees the working data; money, quotes, contracts, suppliers and
//   purchase orders are not for installers, the Priority sync state is for managers only, people see only their own
//   notifications and leave requests (managers see all leaves), and a direct message only reaches its two people.
import { ROLES } from './auth.js';
import { SYSTEM } from './db/store.js';
import { cleanLinks } from './http.js';

const MANAGERS = new Set(['admin', 'office']);
const MANAGER_ONLY = new Set(['users', 'config', 'settings']);
const INSTALLER = new Set(['appointments', 'serviceCalls', 'stock', 'stockMoves', 'docs', 'messages', 'chat', 'tasks', 'notifications', 'leaves', 'units', 'activities']);
// fields an installer's device writes when a job is finished (setStage, flow engine, maintenance visit)
const INSTALLER_PATCH = { cases: new Set(['stage', 'updatedAt', 'closedAt', 'flow', 'installerIds']), contracts: new Set(['nextVisit']) };

// What an installer does not see at all (prices, margins, contracts, purchasing)
const INSTALLER_NO_READ = new Set(['money', 'quotes', 'contracts', 'suppliers', 'purchaseOrders', 'projects']);
const MANAGER_READ_ONLY = new Set(['integrations']);

const fieldsOf = (op) => [...Object.keys(op.data ?? {}), ...(op.unset ?? [])].filter((f) => f !== 'id');

// Fields only the server's own sync engine sets. A manager's device may still write them (the app can push to Priority
// by itself when the server sync is off); an installer's device never can: it keeps what is stored, or starts "not_synced".
const SERVER_FIELDS = ['sync', 'priorityId', 'priorityAgent', 'priorityStatus', 'priorityOrder', 'cprof', 'agentSync', 'addressCodes', 'balance', 'receipt'];
const MAX_TEXT = 20_000;
const DAY = 86_400_000;

/**
 * Returns a cleaned copy of the op: links made safe, text capped, the audit trail stamped with who did it, and (for an
 * installer) the server-owned sync fields pinned to what is stored. Runs before checkOp so nothing odd reaches the store.
 */
export function sanitizeOp(op, user, current) {
  if (!op.data) return op;
  const data = cleanLinks(op.data);
  if (user?.role === 'installer') {
    for (const f of SERVER_FIELDS) {
      if (current && f in current) data[f] = current[f];
      else if (f === 'sync' && data.sync?.status === 'not_synced' && Object.keys(data.sync).length === 1) continue;
      else delete data[f];
    }
  }
  if (op.collection === 'activities' && op.op === 'upsert') {
    data.userId = user.id;
    // offline devices write the entry later; keep the time they say unless it is absurd
    const t = Date.parse(data.at);
    if (!(t > Date.now() - 14 * DAY && t < Date.now() + 5 * 60_000)) data.at = new Date().toISOString();
  }
  if (op.collection === 'notifications') {
    if (typeof data.text === 'string') data.text = data.text.slice(0, 300);
    if (data.link !== undefined && !/^\/[A-Za-z0-9/_?=&.%-]{0,200}$/.test(String(data.link))) delete data.link;
  }
  for (const k of ['text', 'body', 'notes', 'description']) if (typeof data[k] === 'string' && data[k].length > MAX_TEXT) data[k] = data[k].slice(0, MAX_TEXT);
  return { ...op, data };
}

/**
 * Returns null when allowed, else a short reason. `current` is the stored entity (undefined if new),
 * `store` gives access to other entities (last-admin check).
 */
export function checkOp(op, current, user, store) {
  const role = user?.role;
  const c = op.collection;
  const manager = MANAGERS.has(role);
  if (SYSTEM.has(c)) return 'server_only';
  if (MANAGER_ONLY.has(c) && !manager) return 'manager_only';
  // invoices and receipts that came from Priority are Priority's: they change there, not here
  if (c === 'money' && current?.source === 'priority') return 'priority_owned';
  // a line cannot be made to look like one that came from Priority
  if (c === 'money' && !current && op.data?.source === 'priority') return 'priority_owned';

  if (c === 'users') return checkUser(op, current, user, store);

  if (role === 'installer' && !INSTALLER.has(c)) {
    const allowed = INSTALLER_PATCH[c];
    if (c === 'contracts' && op.op === 'upsert' && !current && op.data?.status === 'proposed') return null;
    if (!allowed || op.op !== 'patch' || !fieldsOf(op).every((f) => allowed.has(f))) return 'installer_scope';
  }

  // the history of what happened is added to, not rewritten: only an admin removes a line, nobody edits one
  if (c === 'activities' && current) return role === 'admin' && op.op === 'remove' ? null : 'immutable';

  if (role === 'installer') {
    // what an installer's device sends reaches Priority as stock documents, serial numbers and files
    if (c === 'stockMoves' && op.op !== 'remove') {
      const d = op.data ?? {};
      if (d.kind !== undefined && !['use', 'return', 'transfer', 'receive'].includes(d.kind)) return 'invalid_stock_move';
      if (d.qty !== undefined && !(Number.isFinite(Number(d.qty)) && Number(d.qty) > 0 && Number(d.qty) <= 1000)) return 'invalid_stock_move';
      if (d.itemId !== undefined && !store.get('catalog', d.itemId)) return 'invalid_stock_move';
      if (current && current.userId !== user.id) return 'not_yours';
      if (!current) {
        if (d.userId !== undefined && d.userId !== user.id) return 'not_yours';
        if (d.kind === undefined || d.qty === undefined || d.itemId === undefined) return 'invalid_stock_move';
      }
    }
    // an installer does not decide what the customer sees in the personal area
    if (c === 'docs' && op.data?.customerVisible !== undefined && op.data.customerVisible !== current?.customerVisible) return 'installer_scope';
    if (c === 'docs' && (op.unset ?? []).includes('customerVisible')) return 'installer_scope';
    if (c === 'docs' && current?.uploadedBy && current.uploadedBy !== user.id) return 'not_yours';
  }

  if (!manager) {
    // notifications: anyone may create one for anyone; only the addressee changes or deletes it
    if (c === 'notifications' && current && current.userId !== user.id) return 'not_yours';
    // leave requests: own only, nobody approves their own, and an approved one is not edited behind the manager's back
    if (c === 'leaves') {
      const owner = current?.userId ?? op.data?.userId;
      if (owner !== user.id) return 'not_yours';
      const status = op.data?.status;
      if (status === 'approved' || status === 'rejected') return 'manager_only';
      if (current && current.status === 'approved' && op.op !== 'remove' && op.data?.status !== 'cancelled') return 'locked';
    }
    // chat: your own messages only (edit, mark deleted); a message may not claim another sender
    if (c === 'chat') {
      if (current && current.fromId !== user.id && !onlyReadBy(op)) return 'not_yours';
      if (!current && op.data?.fromId !== undefined && op.data.fromId !== user.id) return 'not_yours';
    }
  }
  return null;
}

// marking a message as read changes readBy and nothing else
const onlyReadBy = (op) => op.op === 'patch' && fieldsOf(op).every((f) => f === 'readBy');

function checkUser(op, current, user, store) {
  if (op.op !== 'remove') {
    const role = op.data?.role;
    if (role !== undefined && !ROLES.includes(role)) return 'invalid_role';
  }
  // only an admin creates admins, changes an admin, or grants the admin role
  const touchesAdmin = current?.role === 'admin' || op.data?.role === 'admin';
  if (touchesAdmin && user.role !== 'admin') return 'admin_only';
  // never leave the system without an active admin
  if (current?.role === 'admin' && current.active !== false) {
    const after = op.op === 'remove' ? null : op.op === 'upsert' ? op.data : { ...current, ...op.data };
    const stillAdmin = after && after.role === 'admin' && after.active !== false && !(op.unset ?? []).includes('role');
    if (!stillAdmin) {
      const others = store.list('users').filter((u) => u.id !== current.id && u.role === 'admin' && u.active !== false);
      if (!others.length) return 'last_admin';
    }
  }
  return null;
}

// ------------------------------------------------------------ reads

/** Whether this user may see this record at all. `c` is the collection. */
export function canRead(c, record, user) {
  const role = user?.role;
  const manager = MANAGERS.has(role);
  if (MANAGER_READ_ONLY.has(c) && !manager) return false;
  if (role === 'installer' && INSTALLER_NO_READ.has(c)) return false;
  if (!record) return true;
  if (c === 'notifications') return record.userId === user.id;
  if (c === 'leaves') return manager || record.userId === user.id;
  if (c === 'chat') {
    const t = String(record.threadId ?? '');
    if (!t.startsWith('dm:')) return true; // case threads are the case team's
    return t.split(':').slice(1).includes(user.id);
  }
  return true;
}

/** What a record looks like to this user: people lose the contact details and cost data they have no use for. */
export function redact(c, record, user) {
  if (!record) return record;
  const manager = MANAGERS.has(user?.role);
  if (c === 'users' && !manager && record.id !== user.id) {
    const { email: _e, idNumber: _i, address: _a, birthDate: _b, salary: _s, ...rest } = record;
    return rest;
  }
  if (c === 'catalog' && user?.role === 'installer') {
    const { cost: _c, price: _p, ...rest } = record;
    return rest;
  }
  return record;
}

/** Applies canRead + redact to a snapshot's collections. */
export function readSnapshot(snap, user) {
  const collections = {};
  for (const [c, list] of Object.entries(snap.collections)) {
    if (!canRead(c, null, user)) continue;
    collections[c] = list.filter((r) => canRead(c, r, user)).map((r) => redact(c, r, user));
  }
  return { ...snap, collections };
}

/** Applies canRead + redact to a list of changes ({ c, id, data? }). Deleted records pass: they carry no data. */
export function readChanges(changes, user) {
  const out = [];
  for (const ch of changes) {
    if (!canRead(ch.c, null, user)) continue;
    if (ch.del) {
      out.push(ch);
      continue;
    }
    if (!canRead(ch.c, ch.data, user)) continue;
    out.push({ ...ch, data: redact(ch.c, ch.data, user) });
  }
  return out;
}
