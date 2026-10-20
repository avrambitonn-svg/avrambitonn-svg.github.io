// Who may write what in the shared store. Everyone signed in may read everything.
// admin / office: everything. agent / engineer: everything except users, config and org settings.
// installer: field work only (appointments, service calls, stock, docs, messages, chat, tasks,
// notifications, leaves, units, activity log), plus the few case / contract fields that closing a job updates.
import { ROLES } from './auth.js';
import { SYSTEM } from './db/store.js';

const MANAGERS = new Set(['admin', 'office']);
const MANAGER_ONLY = new Set(['users', 'config', 'settings']);
const INSTALLER = new Set(['appointments', 'serviceCalls', 'stock', 'stockMoves', 'docs', 'messages', 'chat', 'tasks', 'notifications', 'leaves', 'units', 'activities']);
// fields an installer's device writes when a job is finished (setStage, flow engine, maintenance visit)
const INSTALLER_PATCH = { cases: new Set(['stage', 'updatedAt', 'closedAt', 'flow', 'installerIds']), contracts: new Set(['nextVisit']) };

const fieldsOf = (op) => [...Object.keys(op.data ?? {}), ...(op.unset ?? [])].filter((f) => f !== 'id');

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

  if (c === 'users') return checkUser(op, current, user, store);

  if (role === 'installer' && !INSTALLER.has(c)) {
    const allowed = INSTALLER_PATCH[c];
    if (c === 'contracts' && op.op === 'upsert' && !current && op.data?.status === 'proposed') return null;
    if (!allowed || op.op !== 'patch' || !fieldsOf(op).every((f) => allowed.has(f))) return 'installer_scope';
  }

  if (!manager) {
    // notifications: anyone may create one for anyone; only the addressee changes or deletes it
    if (c === 'notifications' && current && current.userId !== user.id) return 'not_yours';
    // leave requests: own only, and nobody approves their own
    if (c === 'leaves') {
      const owner = current?.userId ?? op.data?.userId;
      if (owner !== user.id) return 'not_yours';
      const status = op.data?.status;
      if (status === 'approved' || status === 'rejected') return 'manager_only';
    }
  }
  return null;
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
