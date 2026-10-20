// Request router shared by the local server (src/server.js) and Vercel (api/index.js).
import { VERSION, loadConfig } from './config.js';
import { HttpError, applyCors, sendError, sendJson, safeEqual } from './http.js';
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

async function dbHealth(cfg) {
  if (cfg.db.mode === 'off') return { mode: 'off' };
  try {
    const store = await getStore(cfg);
    return { mode: cfg.db.mode, ready: true, bootstrapped: !store.isEmpty(), bootstrapToken: Boolean(cfg.db.bootstrapToken) };
  } catch {
    return { mode: cfg.db.mode, ready: false };
  }
}

async function health({ cfg }) {
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
      db: await dbHealth(cfg),
    },
  };
}

// access: 'public'      - no credentials (health, Meta's and Priority's webhooks, login, the customer portal, the lead form)
//         'integration' - the session token or x-app-token (open while neither APP_TOKEN nor any user exists)
//         'session'     - a signed-in user (the route checks it itself, with the role it needs)
const ROUTES = [
  { method: 'GET', path: '/api/health', handle: health, access: 'public' },
  { method: 'GET', path: '/api/priority/test', handle: priority.priorityTest },
  { method: 'GET', path: '/api/priority/customers', handle: priority.listCustomers },
  { method: 'POST', path: '/api/priority/customers', handle: priority.createCustomer },
  { method: 'GET', path: '/api/priority/items', handle: priority.listItems },
  { method: 'GET', path: '/api/priority/pricelists', handle: priority.listPricelists },
  { method: 'POST', path: '/api/priority/quotes', handle: priority.createQuote },
  { method: 'POST', path: '/api/priority/orders', handle: priority.createOrder },
  { method: 'GET', path: '/api/priority/sync/status', handle: psync.syncStatus, access: 'session' },
  { method: 'POST', path: '/api/priority/sync/run', handle: psync.syncRun, access: 'session' },
  { method: 'POST', path: '/api/priority/webhook', handle: psync.syncWebhook, access: 'public' },
  { method: 'POST', path: '/api/ai/messages', handle: aiMessages },
  { method: 'POST', path: '/api/whatsapp/send', handle: whatsapp.sendWhatsapp },
  { method: 'GET', path: '/api/whatsapp/webhook', handle: whatsapp.webhookVerify, access: 'public' },
  { method: 'POST', path: '/api/whatsapp/webhook', handle: whatsapp.webhookReceive, access: 'public' },
  { method: 'GET', path: '/api/whatsapp/inbox', handle: whatsapp.inboxList },
  { method: 'POST', path: '/api/google/calendar/events', handle: google.createCalendarEvent },
  { method: 'PATCH', path: '/api/google/calendar/events/:id', handle: google.updateCalendarEvent },
  { method: 'DELETE', path: '/api/google/calendar/events/:id', handle: google.deleteCalendarEvent },
  { method: 'POST', path: '/api/google/drive/folders', handle: google.createDriveFolder },
  { method: 'POST', path: '/api/google/drive/files', handle: google.uploadDriveFile },
  { method: 'POST', path: '/api/google/drive/files/:id/move', handle: google.moveDriveFile },
  { method: 'POST', path: '/api/google/drive/files/:id/trash', handle: google.trashDriveFile },

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

/** Integration routes: a valid session or the shared APP_TOKEN. With neither configured (no APP_TOKEN, no users yet) they stay open, as before. */
async function checkIntegration(req, cfg) {
  const given = req.headers['x-app-token'];
  if (cfg.appToken && typeof given === 'string' && safeEqual(given, cfg.appToken)) return;
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
    if (s && !s.error) return;
    if (!cfg.appToken && store.isEmpty()) return;
  } else if (!cfg.appToken) return;
  throw new HttpError(401, 'unauthorized', cfg.appToken ? 'חסר טוקן גישה או שהוא שגוי (x-app-token)' : 'צריך להתחבר למערכת');
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
    if (!route.access) await checkIntegration(req, cfg);

    const result = await route.handle({ req, res, url, cfg, params });
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
