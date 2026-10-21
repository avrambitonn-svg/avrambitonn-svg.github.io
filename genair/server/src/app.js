// Request router shared by the local server (src/server.js) and Vercel (api/index.js).
import { VERSION, loadConfig } from './config.js';
import { HttpError, applyCors, applySecurityHeaders, sendError, sendJson, safeEqual } from './http.js';
import * as priority from './priority.js';
import { aiMessages } from './anthropic.js';
import * as whatsapp from './whatsapp.js';
import * as google from './google.js';
import * as auth from './auth.js';
import * as db from './dbroutes.js';
import * as files from './files.js';
import * as portal from './portal.js';
import * as psync from './psync/index.js';
import { getStore } from './db/index.js';
import { audit } from './audit.js';
import { spend } from './ratelimit.js';

async function dbHealth(cfg) {
  if (cfg.db.mode === 'off') return { mode: 'off' };
  try {
    const store = await getStore(cfg);
    // the first setup always needs a code (BOOTSTRAP_TOKEN, or the one the server prints when it starts)
    return { mode: cfg.db.mode, ready: true, bootstrapped: !store.isEmpty(), bootstrapToken: true };
  } catch {
    return { mode: cfg.db.mode, ready: false };
  }
}

/** True for a request that carries a valid session or, on an integration-only server, the shared APP_TOKEN. */
async function isTrusted(req, cfg) {
  try {
    await checkIntegration(req, cfg, 'any');
    return true;
  } catch {
    return false;
  }
}

async function health({ req, cfg }) {
  const body = { ok: true, db: await dbHealth(cfg) };
  // who runs what, and the version, are for the people who work in the system, not for anyone who finds the address
  if (await isTrusted(req, cfg)) {
    const p = cfg.priority;
    body.version = VERSION;
    body.features = {
      priority: p.mode === 'off' || p.configured ? p.mode : 'off',
      priorityWrite: Boolean(p.configured && p.allowWrite && p.mode === 'live'),
      prioritySync: Boolean(psync.currentEngine()),
      ai: Boolean(cfg.ai.apiKey),
      whatsapp: Boolean(cfg.whatsapp.token && cfg.whatsapp.phoneNumberId),
      google: google.googleFeatures(cfg),
    };
  }
  return { status: 200, body };
}

// access: 'public'      - no credentials (health, Meta's and Priority's webhooks, login, the customer portal, the lead form)
//         'integration' - (no access field) a signed-in user whose role may use that service; on a server without a database,
//                         the shared x-app-token. Never open. The `integration` field names the service.
//         'session'     - a signed-in user (the route checks it itself, with the role it needs)
const ROUTES = [
  { method: 'GET', path: '/api/health', handle: health, access: 'public' },
  { method: 'GET', path: '/api/priority/test', handle: priority.priorityTest, integration: 'priority' },
  { method: 'GET', path: '/api/priority/customers', handle: priority.listCustomers, integration: 'priority' },
  { method: 'POST', path: '/api/priority/customers', handle: priority.createCustomer, integration: 'priority' },
  { method: 'GET', path: '/api/priority/items', handle: priority.listItems, integration: 'priority' },
  { method: 'GET', path: '/api/priority/pricelists', handle: priority.listPricelists, integration: 'priority' },
  { method: 'POST', path: '/api/priority/quotes', handle: priority.createQuote, integration: 'priority' },
  { method: 'POST', path: '/api/priority/orders', handle: priority.createOrder, integration: 'priority' },
  { method: 'GET', path: '/api/priority/sync/status', handle: psync.syncStatus, access: 'session' },
  { method: 'POST', path: '/api/priority/sync/run', handle: psync.syncRun, access: 'session' },
  { method: 'POST', path: '/api/priority/webhook', handle: psync.syncWebhook, access: 'public' },
  { method: 'POST', path: '/api/ai/messages', handle: aiMessages, integration: 'ai' },
  { method: 'POST', path: '/api/whatsapp/send', handle: whatsapp.sendWhatsapp, integration: 'whatsapp' },
  { method: 'GET', path: '/api/whatsapp/webhook', handle: whatsapp.webhookVerify, access: 'public' },
  { method: 'POST', path: '/api/whatsapp/webhook', handle: whatsapp.webhookReceive, access: 'public' },
  { method: 'GET', path: '/api/whatsapp/inbox', handle: whatsapp.inboxList, integration: 'whatsapp' },
  { method: 'POST', path: '/api/google/calendar/events', handle: google.createCalendarEvent, integration: 'google' },
  { method: 'PATCH', path: '/api/google/calendar/events/:id', handle: google.updateCalendarEvent, integration: 'google' },
  { method: 'DELETE', path: '/api/google/calendar/events/:id', handle: google.deleteCalendarEvent, integration: 'google' },
  { method: 'POST', path: '/api/google/drive/folders', handle: google.createDriveFolder, integration: 'google' },
  { method: 'POST', path: '/api/google/drive/files', handle: google.uploadDriveFile, integration: 'google' },
  { method: 'POST', path: '/api/google/drive/files/:id/move', handle: google.moveDriveFile, integration: 'google' },
  { method: 'POST', path: '/api/google/drive/files/:id/trash', handle: google.trashDriveFile, integration: 'google' },

  { method: 'POST', path: '/api/auth/login', handle: auth.login, access: 'public' },
  { method: 'POST', path: '/api/auth/bootstrap', handle: auth.bootstrap, access: 'public' },
  { method: 'POST', path: '/api/auth/logout', handle: auth.logout, access: 'public' },
  { method: 'GET', path: '/api/auth/me', handle: auth.me, access: 'session' },
  { method: 'POST', path: '/api/auth/password', handle: auth.changePassword, access: 'session' },
  { method: 'GET', path: '/api/auth/users', handle: auth.listCredentials, access: 'session' },
  { method: 'POST', path: '/api/auth/users/:id/password', handle: auth.setUserPassword, access: 'session' },

  { method: 'GET', path: '/api/db/snapshot', handle: db.snapshot, access: 'session' },
  { method: 'GET', path: '/api/db/changes', handle: db.changes, access: 'session' },
  { method: 'GET', path: '/api/db/events', handle: db.events, access: 'session' },
  { method: 'POST', path: '/api/db/ops', handle: db.ops, access: 'session' },
  { method: 'POST', path: '/api/db/fetch', handle: db.fetchEntities, access: 'session' },
  { method: 'POST', path: '/api/db/counters/reserve', handle: db.reserveCounter, access: 'session' },
  { method: 'POST', path: '/api/files', handle: files.uploadFile, access: 'session' },
  { method: 'GET', path: '/api/files/:id', handle: files.downloadFile, access: 'session' },

  { method: 'GET', path: '/api/portal/:token', handle: portal.getPortal, access: 'public' },
  { method: 'POST', path: '/api/portal/:token/view', handle: portal.viewPortal, access: 'public' },
  { method: 'POST', path: '/api/portal/:token/approve', handle: portal.approveQuote, access: 'public' },
  { method: 'POST', path: '/api/portal/:token/reject', handle: portal.rejectQuote, access: 'public' },
  { method: 'POST', path: '/api/portal/:token/service', handle: portal.serviceRequest, access: 'public' },
  { method: 'POST', path: '/api/portal/:token/upload', handle: portal.uploadFromPortal, access: 'public' },
  { method: 'POST', path: '/api/portal/:token/messages', handle: portal.postMessage, access: 'public' },
  { method: 'GET', path: '/api/portal/:token/files/:docId', handle: portal.portalFile, access: 'public' },
  { method: 'POST', path: '/api/public/leads', handle: portal.createLead, access: 'public' },
].map((r) => ({ ...r, ...compile(r.path) }));

function compile(path) {
  const names = [];
  const re = path.replace(/:(\w+)/g, (_, n) => {
    names.push(n);
    return '([^/]+)';
  });
  return { re: new RegExp(`^${re}$`), names };
}

function findRoute(method, path) {
  const candidates = [];
  for (const r of ROUTES) {
    const m = r.re.exec(path);
    if (!m) continue;
    let params;
    try {
      params = Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
    } catch {
      continue;
    }
    candidates.push({ route: r, params });
  }
  if (!candidates.length) throw new HttpError(404, 'not_found', 'הנתיב המבוקש לא קיים', { path });
  const hit = candidates.find((c) => c.route.method === method);
  if (!hit) {
    const err = new HttpError(405, 'method_not_allowed', 'שיטת הבקשה אינה נתמכת בנתיב זה', { method });
    err.allow = [...new Set(candidates.map((c) => c.route.method))].join(', ');
    throw err;
  }
  return hit;
}

// Which roles may use which service, and how often (requests per minute per user).
const ROLES_FOR = {
  priority: ['admin', 'office', 'agent', 'engineer'],
  ai: ['admin', 'office', 'agent', 'engineer'],
  whatsapp: ['admin', 'office', 'agent', 'engineer'],
  google: ['admin', 'office', 'agent', 'engineer', 'installer'], // the field app files photos in the case's Drive folder
};
const BUDGET_KEY = { priority: 'priorityPerMin', ai: 'aiPerMin', whatsapp: 'whatsappPerMin', google: 'googlePerMin' };

/**
 * Integration routes (Priority, AI, WhatsApp, Google). With a shared database: a signed-in user whose role may use the
 * service (the shared APP_TOKEN is not accepted there: it would let anyone who knows it act as nobody in particular).
 * Without a database (an integration-only server, e.g. on Vercel): the APP_TOKEN, which must be set. Never open.
 * Returns { user } (null for the token).
 */
async function checkIntegration(req, cfg, kind) {
  let store = null;
  if (cfg.db.mode !== 'off') {
    try {
      store = await getStore(cfg);
    } catch {
      // never fall back to "open" because the database could not be read
      throw new HttpError(503, 'db_unavailable', 'מסד הנתונים לא זמין כרגע');
    }
  }
  if (store) {
    const s = auth.readSession(req, store, cfg);
    if (!s || s.error) throw new HttpError(401, 'unauthorized', s?.error === 'expired' ? 'פג תוקף ההתחברות, צריך להתחבר שוב' : 'צריך להתחבר למערכת', { reason: s?.error ?? 'missing' });
    if (kind !== 'any' && !ROLES_FOR[kind]?.includes(s.user.role)) {
      audit(cfg, 'integration_denied', { user: s.user.id, role: s.user.role, service: kind });
      throw new HttpError(403, 'forbidden', 'התפקיד שלך לא מורשה להשתמש בשירות הזה');
    }
    return { user: s.user };
  }
  if (!cfg.appToken) throw new HttpError(503, 'app_token_required', 'השרת הזה בלי מסד נתונים דורש APP_TOKEN. הגדירו אותו בשרת ובהגדרות האפליקציה');
  const given = req.headers['x-app-token'];
  if (!(typeof given === 'string' && safeEqual(given, cfg.appToken))) {
    audit(cfg, 'app_token_rejected', { service: kind });
    throw new HttpError(401, 'unauthorized', 'חסר טוקן גישה או שהוא שגוי (x-app-token)');
  }
  return { user: null };
}

export async function handler(req, res) {
  try {
    const cfg = loadConfig();
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname.replace(/\/+$/, '') || '/';

    applySecurityHeaders(req, res, cfg);
    if (!applyCors(req, res, cfg.allowedOrigins)) {
      throw new HttpError(403, 'origin_not_allowed', 'המקור (Origin) אינו מורשה לגשת לשרת', { origin: req.headers.origin });
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const { route, params } = findRoute(req.method, path);
    let user = null;
    if (!route.access) {
      ({ user } = await checkIntegration(req, cfg, route.integration));
      spend(`int-${route.integration}`, user?.id ?? 'app-token', cfg.limits[BUDGET_KEY[route.integration]]);
    }

    const result = await route.handle({ req, res, url, cfg, params, user });
    if (!result || res.headersSent) return; // the handler streamed its own response
    if (result.text !== undefined) {
      res.writeHead(result.status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      res.end(result.text);
      return;
    }
    sendJson(res, result.status, result.body);
  } catch (err) {
    sendError(res, err);
  }
}

export default handler;
