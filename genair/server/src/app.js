// Request router shared by the local server (src/server.js) and Vercel (api/index.js).
import { VERSION, loadConfig } from './config.js';
import { HttpError, applyCors, clientIp, isLocalRequest, sendError, sendJson, safeEqual } from './http.js';
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
import { createWindowLimiter } from './limiter.js';

// per signed-in user (or per address for APP_TOKEN callers): things that cost money or reach outside
const LIMITS = {
  ai: createWindowLimiter({ max: 60, windowMs: 60 * 60_000 }),
  whatsapp: createWindowLimiter({ max: 100, windowMs: 60 * 60_000 }),
  google: createWindowLimiter({ max: 300, windowMs: 10 * 60_000 }),
  priority: createWindowLimiter({ max: 300, windowMs: 10 * 60_000 }),
};
export const resetRouteLimits = () => Object.values(LIMITS).forEach((l) => l.clear());

function rateLimit(route, caller, ip) {
  const lim = route.limit && LIMITS[route.limit];
  if (!lim) return;
  const v = lim.hit(caller?.user ? `u:${caller.user.id}` : `ip:${ip}`);
  if (!v.allowed) {
    const e = new HttpError(429, 'too_many_requests', 'יותר מדי בקשות בזמן קצר. אפשר לנסות שוב מאוחר יותר');
    e.retryAfter = Math.ceil(v.retryAfterMs / 1000);
    throw e;
  }
}

async function dbHealth(cfg, req) {
  if (cfg.db.mode === 'off') return { mode: 'off' };
  try {
    const store = await getStore(cfg);
    // bootstrapToken: whether first setup asks for the code (always, except from the server machine itself)
    return { mode: cfg.db.mode, ready: true, bootstrapped: !store.isEmpty(), bootstrapToken: Boolean(cfg.db.bootstrapToken) || !isLocalRequest(req) };
  } catch {
    return { mode: cfg.db.mode, ready: false };
  }
}

/** Anyone gets "up" and what the setup screen needs; the version and the configured integrations only with credentials. */
async function health({ req, cfg }) {
  const db = await dbHealth(cfg, req);
  if (!(await hasCredentials(req, cfg))) return { status: 200, body: { ok: true, db } };
  const p = cfg.priority;
  return {
    status: 200,
    body: {
      ok: true,
      version: VERSION,
      features: {
        priority: p.mode === 'off' || p.configured ? p.mode : 'off',
        priorityWrite: Boolean(p.configured && p.allowWrite),
        prioritySync: Boolean(psync.currentEngine()),
        ai: Boolean(cfg.ai.apiKey),
        whatsapp: Boolean(cfg.whatsapp.token && cfg.whatsapp.phoneNumberId),
        google: google.googleFeatures(cfg),
      },
      db,
    },
  };
}

// access: 'public'      - no credentials (health, Meta's and Priority's webhooks, login, the customer portal, the lead form)
//         'integration' - a signed-in user, or x-app-token while there is no user database (see checkIntegration)
//         'session'     - a signed-in user (the route checks it itself, with the role it needs)
const ROUTES = [
  { method: 'GET', path: '/api/health', handle: health, access: 'public' },
  { method: 'GET', path: '/api/priority/test', handle: priority.priorityTest, limit: 'priority' },
  { method: 'GET', path: '/api/priority/customers', handle: priority.listCustomers, limit: 'priority' },
  { method: 'POST', path: '/api/priority/customers', handle: priority.createCustomer, limit: 'priority' },
  { method: 'GET', path: '/api/priority/items', handle: priority.listItems, limit: 'priority' },
  { method: 'GET', path: '/api/priority/pricelists', handle: priority.listPricelists, limit: 'priority' },
  { method: 'POST', path: '/api/priority/quotes', handle: priority.createQuote, limit: 'priority' },
  { method: 'POST', path: '/api/priority/orders', handle: priority.createOrder, limit: 'priority' },
  { method: 'GET', path: '/api/priority/sync/status', handle: psync.syncStatus, access: 'session' },
  { method: 'POST', path: '/api/priority/sync/run', handle: psync.syncRun, access: 'session' },
  { method: 'POST', path: '/api/priority/webhook', handle: psync.syncWebhook, access: 'public' },
  { method: 'POST', path: '/api/ai/messages', handle: aiMessages, limit: 'ai' },
  { method: 'POST', path: '/api/whatsapp/send', handle: whatsapp.sendWhatsapp, limit: 'whatsapp' },
  { method: 'GET', path: '/api/whatsapp/webhook', handle: whatsapp.webhookVerify, access: 'public' },
  { method: 'POST', path: '/api/whatsapp/webhook', handle: whatsapp.webhookReceive, access: 'public' },
  { method: 'GET', path: '/api/whatsapp/inbox', handle: whatsapp.inboxList },
  { method: 'POST', path: '/api/google/calendar/events', handle: google.createCalendarEvent, limit: 'google' },
  { method: 'PATCH', path: '/api/google/calendar/events/:id', handle: google.updateCalendarEvent, limit: 'google' },
  { method: 'DELETE', path: '/api/google/calendar/events/:id', handle: google.deleteCalendarEvent, limit: 'google' },
  { method: 'POST', path: '/api/google/drive/folders', handle: google.createDriveFolder, limit: 'google' },
  { method: 'POST', path: '/api/google/drive/files', handle: google.uploadDriveFile, limit: 'google' },
  { method: 'POST', path: '/api/google/drive/files/:id/move', handle: google.moveDriveFile, limit: 'google' },
  { method: 'POST', path: '/api/google/drive/files/:id/trash', handle: google.trashDriveFile, limit: 'google' },

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

const validAppToken = (req, cfg) => {
  const given = req.headers['x-app-token'];
  return Boolean(cfg.appToken) && typeof given === 'string' && safeEqual(given, cfg.appToken);
};

async function hasCredentials(req, cfg) {
  try {
    return Boolean(await checkIntegration(req, cfg));
  } catch {
    return false;
  }
}

/**
 * Integration routes. Returns who is calling ({ user } or { app: true }), for per-user limits.
 * - With the shared database in use (at least one user): a signed-in user only. The shared APP_TOKEN lives in
 *   every browser that has the app, so it does not identify anyone and is not enough on its own.
 * - Database off (integration-only server, e.g. Vercel) or not set up yet: APP_TOKEN.
 * - Never open to the internet without credentials; with no APP_TOKEN only this machine (local development) gets in.
 */
async function checkIntegration(req, cfg) {
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
    if (s && !s.error) return { user: s.user };
    if (!store.isEmpty()) throw new HttpError(401, 'unauthorized', 'צריך להתחבר למערכת');
  }
  if (validAppToken(req, cfg)) return { app: true };
  if (!cfg.appToken && isLocalRequest(req)) return { app: true, local: true };
  throw new HttpError(401, 'unauthorized', cfg.appToken ? 'חסר טוקן גישה או שהוא שגוי (x-app-token)' : 'השרת לא מוגדר לגישה מבחוץ: צריך להגדיר APP_TOKEN או מסד נתונים עם משתמשים');
}

export async function handler(req, res) {
  try {
    const cfg = loadConfig();
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (!applyCors(req, res, cfg.allowedOrigins)) {
      throw new HttpError(403, 'origin_not_allowed', 'המקור (Origin) אינו מורשה לגשת לשרת', { origin: req.headers.origin });
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const { route, params } = findRoute(req.method, path);
    const caller = route.access ? undefined : await checkIntegration(req, cfg);
    const ip = clientIp(req, cfg.db.trustProxy);
    rateLimit(route, caller, ip);

    const result = await route.handle({ req, res, url, cfg, params, caller, ip });
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
