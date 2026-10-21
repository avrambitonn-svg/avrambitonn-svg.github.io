// The Edge Function's router: the Node server's routes (server/src/app.js) at the same paths, with access
// checked against Supabase Auth instead of the server's own sessions. The database routes (/api/db/*) and
// login / logout / password are gone: the app does those with supabase-js (CONTRACT.md).
import { VERSION, loadConfig } from '../../../../server/src/config.js';
import { HttpError, applyCors, clientIp, sendError, sendJson } from '../../../../server/src/http.js';
import * as priority from '../../../../server/src/priority.js';
import { aiMessages } from '../../../../server/src/anthropic.js';
import * as whatsapp from '../../../../server/src/whatsapp.js';
import * as google from '../../../../server/src/google.js';
import * as portal from '../../../../server/src/portal.js';
import { createWindowLimiter } from '../../../../server/src/limiter.js';
import * as files from './files.js';
import * as inbox from './inbox.js';
import * as psync from './psync.js';
import * as users from './users.js';
import { optionalMember, requireMember } from './access.js';
import { createSupabase } from './supabase.js';
import { PgStore } from './pgstore.js';
import { EdgeResponse, nodeRequest, readRequestBody } from './nodehttp.js';

export const CORS_ALLOW_HEADERS =
  'authorization, apikey, x-client-info, content-type, x-file-name, x-case-id, x-folder, x-drive-folder-id, anthropic-beta, x-client-id';

// per signed-in user: things that cost money or reach outside (per instance of the function)
const LIMITS = {
  ai: createWindowLimiter({ max: 60, windowMs: 60 * 60_000 }),
  whatsapp: createWindowLimiter({ max: 100, windowMs: 60 * 60_000 }),
  google: createWindowLimiter({ max: 300, windowMs: 10 * 60_000 }),
  priority: createWindowLimiter({ max: 300, windowMs: 10 * 60_000 }),
};

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

/** Anyone gets "up" and what the setup screen needs; members also the version and the configured integrations. */
async function health({ req, cfg }) {
  let db;
  try {
    db = { mode: 'supabase', ready: true, bootstrapped: !(await cfg.edge.rpc('sys_is_empty')), bootstrapToken: true };
  } catch {
    db = { mode: 'supabase', ready: false };
  }
  if (!(await optionalMember(cfg, req))) return { status: 200, body: { ok: true, db } };
  const p = cfg.priority;
  return {
    status: 200,
    body: {
      ok: true,
      version: VERSION,
      features: {
        priority: p.mode === 'off' || p.configured ? p.mode : 'off',
        priorityWrite: Boolean(p.configured && p.allowWrite),
        prioritySync: Boolean(cfg.prioritySync.enabled && p.mode !== 'off' && p.configured),
        ai: Boolean(cfg.ai.apiKey),
        whatsapp: Boolean(cfg.whatsapp.token && cfg.whatsapp.phoneNumberId),
        google: google.googleFeatures(cfg),
      },
      db,
    },
  };
}

// access: 'member' (default) - a signed-in member of the organization (Supabase access token)
//         'public'           - no credentials (health, webhooks, first setup, the customer portal, the lead form);
//                              routes that need a secret (cron, webhooks, bootstrap) check it themselves
const ROUTES = [
  { method: 'GET', path: '/api/health', handle: health, access: 'public' },
  { method: 'GET', path: '/api/priority/test', handle: priority.priorityTest, limit: 'priority' },
  { method: 'GET', path: '/api/priority/customers', handle: priority.listCustomers, limit: 'priority' },
  { method: 'POST', path: '/api/priority/customers', handle: priority.createCustomer, limit: 'priority' },
  { method: 'GET', path: '/api/priority/items', handle: priority.listItems, limit: 'priority' },
  { method: 'GET', path: '/api/priority/pricelists', handle: priority.listPricelists, limit: 'priority' },
  { method: 'POST', path: '/api/priority/quotes', handle: priority.createQuote, limit: 'priority' },
  { method: 'POST', path: '/api/priority/orders', handle: priority.createOrder, limit: 'priority' },
  { method: 'GET', path: '/api/priority/sync/status', handle: psync.syncStatus },
  { method: 'POST', path: '/api/priority/sync/run', handle: psync.syncRun },
  { method: 'POST', path: '/api/priority/webhook', handle: psync.syncWebhook, access: 'public' },
  { method: 'POST', path: '/api/priority/cron', handle: psync.syncCron, access: 'public' },
  { method: 'POST', path: '/api/ai/messages', handle: aiMessages, limit: 'ai' },
  { method: 'POST', path: '/api/whatsapp/send', handle: whatsapp.sendWhatsapp, limit: 'whatsapp' },
  { method: 'GET', path: '/api/whatsapp/webhook', handle: whatsapp.webhookVerify, access: 'public' },
  { method: 'POST', path: '/api/whatsapp/webhook', handle: inbox.webhookReceive, access: 'public' },
  { method: 'GET', path: '/api/whatsapp/inbox', handle: inbox.inboxList },
  { method: 'POST', path: '/api/google/calendar/events', handle: google.createCalendarEvent, limit: 'google' },
  { method: 'PATCH', path: '/api/google/calendar/events/:id', handle: google.updateCalendarEvent, limit: 'google' },
  { method: 'DELETE', path: '/api/google/calendar/events/:id', handle: google.deleteCalendarEvent, limit: 'google' },
  { method: 'POST', path: '/api/google/drive/folders', handle: google.createDriveFolder, limit: 'google' },
  { method: 'POST', path: '/api/google/drive/files', handle: google.uploadDriveFile, limit: 'google' },
  { method: 'POST', path: '/api/google/drive/files/:id/move', handle: google.moveDriveFile, limit: 'google' },
  { method: 'POST', path: '/api/google/drive/files/:id/trash', handle: google.trashDriveFile, limit: 'google' },

  { method: 'POST', path: '/api/auth/bootstrap', handle: users.bootstrap, access: 'public' },
  { method: 'GET', path: '/api/auth/users', handle: users.listCredentials },
  { method: 'POST', path: '/api/auth/users/:id/password', handle: users.setUserPassword },
  { method: 'POST', path: '/api/files', handle: files.uploadFile },
  { method: 'GET', path: '/api/files/:id', handle: files.downloadFile },

  { method: 'GET', path: '/api/portal/:token', handle: portal.getPortal, access: 'public' },
  { method: 'POST', path: '/api/portal/:token/view', handle: portal.viewPortal, access: 'public' },
  { method: 'POST', path: '/api/portal/:token/approve', handle: portal.approveQuote, access: 'public' },
  { method: 'POST', path: '/api/portal/:token/reject', handle: portal.rejectQuote, access: 'public' },
  { method: 'POST', path: '/api/portal/:token/service', handle: portal.serviceRequest, access: 'public' },
  { method: 'POST', path: '/api/portal/:token/upload', handle: portal.uploadFromPortal, access: 'public' },
  { method: 'POST', path: '/api/portal/:token/messages', handle: portal.postMessage, access: 'public' },
  { method: 'GET', path: '/api/portal/:token/files/:docId', handle: portal.portalFile, access: 'public' },
  { method: 'POST', path: '/api/public/leads', handle: portal.createLead, access: 'public' },
].map((r) => ({ access: 'member', ...r, ...compile(r.path) }));

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

/** The server's config from the function's secrets, plus this request's Supabase context (cfg.edge). */
export function edgeConfig(env, opts = {}) {
  const cfg = loadConfig(env);
  cfg.db = { ...cfg.db, mode: 'supabase', trustProxy: 0 };
  const sb = createSupabase(env, opts.fetch);
  let store = null;
  cfg.edge = {
    env,
    opts,
    sb,
    rpc: sb.rpc,
    member: null,
    authId: null,
    store: () => {
      store ??= new PgStore(sb.rpc).init().catch((e) => {
        store = null;
        console.error('[genair-api] loading the database failed:', e?.message ?? e);
        throw new HttpError(503, 'db_unavailable', 'מסד הנתונים לא זמין כרגע');
      });
      return store;
    },
    /** Sends the request's queued writes (when the store was loaded at all). */
    persist: async () => {
      if (store) await (await store).persist();
    },
  };
  return cfg;
}

// Supabase serves the function at /functions/v1/api/...; inside it the path starts at /api
const routePath = (pathname) => pathname.replace(/^\/functions\/v1(?=\/)/, '').replace(/\/+$/, '') || '/';

async function serve(request, res, env, opts) {
  let cfg;
  try {
    cfg = edgeConfig(env, opts);
    const u = new URL(request.url);
    const path = routePath(u.pathname);
    const req = nodeRequest(request, `${path}${u.search}`);

    if (!applyCors(req, res, cfg.allowedOrigins)) {
      throw new HttpError(403, 'origin_not_allowed', 'המקור (Origin) אינו מורשה לגשת לשרת', { origin: req.headers.origin });
    }
    if (res.hasHeader('access-control-allow-headers')) res.setHeader('access-control-allow-headers', CORS_ALLOW_HEADERS);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const { route, params } = findRoute(req.method, path);
    req.rawBody = await readRequestBody(request);
    const caller = route.access === 'member' ? await requireMember(cfg, req) : undefined;
    const ip = clientIp(req, 0);
    rateLimit(route, caller, ip);

    const url = new URL(req.url, 'http://localhost');
    const result = await route.handle({ req, res, url, cfg, params, caller, ip });
    await cfg.edge.persist(); // before the answer: what the response reports is in the database
    if (!result || res.headersSent) return; // the handler streamed its own response
    if (result.text !== undefined) {
      res.writeHead(result.status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      res.end(result.text);
      return;
    }
    sendJson(res, result.status, result.body);
  } catch (err) {
    // writes made before the error are kept, as the server's store would have kept them
    await cfg?.edge.persist().catch((e) => console.error('[genair-api] saving failed:', e?.message ?? e));
    sendError(res, err);
  } finally {
    if (!res.headersSent) sendError(res, new Error('no response'));
  }
}

/**
 * Handles one request. env: the function's secrets (Deno.env). opts (tests, and Deno.serve in index.ts):
 * waitUntil(promise) to finish work after the response, fetch for Supabase calls, priorityClient.
 */
export async function handle(request, env = {}, opts = {}) {
  const res = new EdgeResponse();
  const work = serve(request, res, env, opts);
  opts.waitUntil?.(work);
  return res.response;
}
