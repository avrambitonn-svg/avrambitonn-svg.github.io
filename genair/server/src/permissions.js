// Who may write what in the shared store. What each role may read is in readscope.js.
// admin / office: everything. agent / engineer: everything except users, config and org settings.
// installer: field work only (appointments, service calls, stock, docs, messages, chat, tasks,
// notifications, leaves, units, activity log), plus the few case / contract fields that closing a job updates.
// Several of these go on to Priority (stock moves, serial numbers, files, notes), so an installer's writes there
// are narrowed further: stock moves only to or from their own van, no deletes of records Priority may already hold.
// For everyone but managers: the activity log is append-only, chat messages and leave requests are the author's
// own (a decided leave is the managers'), and a notification is a short text with a link inside the app.
import { ROLES } from './auth.js';
import { SYSTEM } from './db/store.js';

const MANAGERS = new Set(['admin', 'office']);
const MANAGER_ONLY = new Set(['users', 'config', 'settings']);
const INSTALLER = new Set(['appointments', 'serviceCalls', 'stock', 'stockMoves', 'docs', 'messages', 'chat', 'tasks', 'notifications', 'leaves', 'units', 'activities']);
// fields an installer's device writes when a job is finished (setStage, flow engine, maintenance visit)
const INSTALLER_PATCH = { cases: new Set(['stage', 'updatedAt', 'closedAt', 'flow', 'installerIds']), contracts: new Set(['nextVisit']) };

const fieldsOf = (op) => [...Object.keys(op.data ?? {}), ...(op.unset ?? [])].filter((f) => f !== 'id');
// the app's name for an installer's van stock location (features/ops/ops.ts vanOf)
export const vanOf = (user) => `רכב — ${user?.name ?? ''}`;
const MAX_MOVE_QTY = 1000;
// records an installer may add or change but not delete (once sent, Priority holds a document for them)
const NO_INSTALLER_DELETE = new Set(['serviceCalls', 'units', 'stockMoves', 'activities']);

/**
 * Returns null when allowed, else a short reason. `current` is the stored entity (undefined if new),
 * `store` gives access to other entities (last-admin check).
 */
export function checkOp(op, current, user, store, files) {
  const role = user?.role;
  const c = op.collection;
  const manager = MANAGERS.has(role);
  if (SYSTEM.has(c)) return 'server_only';
  if (MANAGER_ONLY.has(c) && !manager) return 'manager_only';
  // invoices and receipts that came from Priority are Priority's: they change there, not here (and nobody makes one)
  if (c === 'money' && (current?.source === 'priority' || op.data?.source === 'priority')) return 'priority_owned';
  // a server file can be filed only by whoever uploaded it, or under the case it was uploaded to
  if (c === 'docs' && typeof op.data?.fileId === 'string' && op.data.fileId !== current?.fileId) {
    const why = checkFile(op.data.fileId, op.data.caseId ?? current?.caseId, user, files);
    if (why) return why;
  }

  if (c === 'users') return checkUser(op, current, user, store);

  // the activity log is a record of what happened: nobody rewrites it, only an admin deletes an entry
  if (c === 'activities') {
    if (op.op === 'remove') return role === 'admin' ? null : 'admin_only';
    if (current) return 'append_only';
  }
  // sync state is the Priority engine's (an installer setting "synced" would keep a record from going out)
  if (role === 'installer' && ((op.data && 'sync' in op.data && JSON.stringify(op.data.sync) !== JSON.stringify(current?.sync)) || op.unset?.includes('sync'))) return 'installer_scope';

  if (role === 'installer' && !INSTALLER.has(c)) {
    const allowed = INSTALLER_PATCH[c];
    if (c === 'contracts' && op.op === 'upsert' && !current && op.data?.status === 'proposed') return null;
    if (!allowed || op.op !== 'patch' || !fieldsOf(op).every((f) => allowed.has(f))) return 'installer_scope';
  }
  if (role === 'installer') {
    if (op.op === 'remove' && NO_INSTALLER_DELETE.has(c)) return 'installer_scope';
    if (c === 'stockMoves') {
      const why = checkInstallerMove(op, current, user);
      if (why) return why;
    }
  }

  if (!manager) {
    // chat: write as yourself; edit or delete only your own messages
    if (c === 'chat') {
      if (current && isMarkRead(op, current, user)) return null;
      const author = current?.fromId ?? op.data?.fromId;
      if (author !== user.id || (op.data?.fromId !== undefined && op.data.fromId !== user.id)) return 'not_yours';
    }
    // notifications: anyone may create one for anyone (short, linking inside the app); only the addressee changes or deletes it
    if (c === 'notifications') {
      if (current && current.userId !== user.id) return 'not_yours';
      if (!current) {
        const { text, link } = op.data ?? {};
        if (typeof text !== 'string' || text.length > 300) return 'invalid_notification';
        if (link !== undefined && (typeof link !== 'string' || !link.startsWith('/') || link.startsWith('//') || link.length > 300)) return 'invalid_notification';
      }
    }
    // leave requests: own only, nobody approves their own, and once decided it is the managers'
    if (c === 'leaves') {
      const owner = current?.userId ?? op.data?.userId;
      if (owner !== user.id || (op.data?.userId !== undefined && op.data.userId !== user.id)) return 'not_yours';
      if (current && (current.status === 'approved' || current.status === 'rejected')) return 'manager_only';
      const status = op.data?.status;
      if (status === 'approved' || status === 'rejected' || op.data?.decidedBy !== undefined || op.data?.decidedAt !== undefined) return 'manager_only';
    }
  }
  return null;
}

/** Reading someone else's message: the only change is adding yourself to readBy. */
function isMarkRead(op, current, user) {
  if (op.op !== 'patch' || op.unset?.length || Object.keys(op.data ?? {}).some((k) => k !== 'readBy' && k !== 'id')) return false;
  const before = new Set(current.readBy ?? []);
  const after = op.data.readBy;
  return Array.isArray(after) && after.every((id) => before.has(id) || id === user.id) && [...before].every((id) => after.includes(id));
}

/** An installer moves stock in or out of their own van, in sane quantities, and only until it was sent to Priority. */
function checkInstallerMove(op, current, user) {
  if (current && (current.userId !== user.id || current.sync?.status === 'synced')) return 'installer_scope';
  if (op.op === 'remove') return null;
  const m = { ...current, ...op.data };
  const van = vanOf(user);
  if (!['transfer', 'use', 'return'].includes(m.kind)) return 'installer_scope';
  if (m.from !== van && m.to !== van) return 'installer_scope';
  if (typeof m.qty !== 'number' || !(m.qty > 0) || m.qty > MAX_MOVE_QTY) return 'installer_scope';
  if (m.userId !== undefined && m.userId !== user.id) return 'installer_scope';
  return null;
}

/** `files`: fileId -> its meta (read by the route before checking), so a doc cannot point at somebody else's file. */
function checkFile(fileId, caseId, user, files) {
  const meta = files?.get(fileId);
  if (!meta) return 'file_not_found';
  if (meta.caseId && meta.caseId !== caseId) return 'file_other_case';
  if (MANAGERS.has(user?.role) || meta.by === user?.id || (meta.caseId && meta.caseId === caseId)) return null;
  return 'not_yours';
}

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
