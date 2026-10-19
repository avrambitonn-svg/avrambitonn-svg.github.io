// Request router shared by the local server (src/server.js) and Vercel (api/index.js).
import { VERSION, loadConfig } from './config.js';
import { HttpError, applyCors, sendError, sendJson, safeEqual } from './http.js';
import * as priority from './priority.js';
import { aiMessages } from './anthropic.js';
import * as whatsapp from './whatsapp.js';
import * as google from './google.js';

function health({ cfg }) {
  const p = cfg.priority;
  return {
    status: 200,
    body: {
      ok: true,
      version: VERSION,
      features: {
        priority: p.mode === 'off' || p.configured ? p.mode : 'off',
        priorityWrite: Boolean(p.configured && p.allowWrite),
        ai: Boolean(cfg.ai.apiKey),
        whatsapp: Boolean(cfg.whatsapp.token && cfg.whatsapp.phoneNumberId),
        google: google.googleFeatures(cfg),
      },
    },
  };
}

// public: true -> no x-app-token needed (health check, Meta's webhook calls).
const ROUTES = [
  { method: 'GET', path: '/api/health', handle: health, public: true },
  { method: 'GET', path: '/api/priority/test', handle: priority.priorityTest },
  { method: 'GET', path: '/api/priority/customers', handle: priority.listCustomers },
  { method: 'POST', path: '/api/priority/customers', handle: priority.createCustomer },
  { method: 'GET', path: '/api/priority/items', handle: priority.listItems },
  { method: 'GET', path: '/api/priority/pricelists', handle: priority.listPricelists },
  { method: 'POST', path: '/api/priority/quotes', handle: priority.createQuote },
  { method: 'POST', path: '/api/priority/orders', handle: priority.createOrder },
  { method: 'POST', path: '/api/ai/messages', handle: aiMessages },
  { method: 'POST', path: '/api/whatsapp/send', handle: whatsapp.sendWhatsapp },
  { method: 'GET', path: '/api/whatsapp/webhook', handle: whatsapp.webhookVerify, public: true },
  { method: 'POST', path: '/api/whatsapp/webhook', handle: whatsapp.webhookReceive, public: true },
  { method: 'GET', path: '/api/whatsapp/inbox', handle: whatsapp.inboxList },
  { method: 'POST', path: '/api/google/calendar/events', handle: google.createCalendarEvent },
  { method: 'POST', path: '/api/google/drive/folders', handle: google.createDriveFolder },
];

function findRoute(method, path) {
  const candidates = ROUTES.filter((r) => r.path === path);
  if (!candidates.length) throw new HttpError(404, 'not_found', 'הנתיב המבוקש לא קיים', { path });
  const route = candidates.find((r) => r.method === method);
  if (!route) {
    const err = new HttpError(405, 'method_not_allowed', 'שיטת הבקשה אינה נתמכת בנתיב זה', { method });
    err.allow = candidates.map((r) => r.method).join(', ');
    throw err;
  }
  return route;
}

function checkAppToken(req, cfg) {
  if (!cfg.appToken) return;
  const given = req.headers['x-app-token'];
  if (typeof given !== 'string' || !safeEqual(given, cfg.appToken)) {
    throw new HttpError(401, 'unauthorized', 'חסר טוקן גישה או שהוא שגוי (x-app-token)');
  }
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

    const route = findRoute(req.method, path);
    if (!route.public) checkAppToken(req, cfg);

    const result = await route.handle({ req, res, url, cfg });
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
