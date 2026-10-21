// Priority ERP over its OData REST API: reads, guarded writes, mapping to app fields.
// Field names were taken from the sandbox $metadata - see PRIORITY_MAPPING.md.
import { HttpError, errorBody, fetchUpstream, readJson, readUpstream } from './http.js';
import { backoffDelay, createRateLimiter, defaultSleep, parseRetryAfter } from './limiter.js';

const SERVICE = { code: 'priority', label: 'פריוריטי', to: 'לפריוריטי' };

export const FORMS = {
  customers: 'CUSTOMERS',
  items: 'LOGPART',
  pricelists: 'PRICELIST',
  quotes: 'CPROF',
  quoteLines: 'CPROFITEMS_SUBFORM',
  orders: 'ORDERS',
  orderLines: 'ORDERITEMS_SUBFORM',
};

const CUSTOMER_SELECT = 'CUSTNAME,CUSTDES,PHONE,EMAIL,ADDRESS,STATE,STATEA,VATNUM';
const ITEM_SELECT = 'PARTNAME,PARTDES,BASEPLPRICE,BASEPLCODE,PUNITNAME,UNITNAME';
const PRICELIST_SELECT = 'PLNAME,PLDES,CODE';

// Max lengths from $metadata (MaxLength) for the fields we write.
const LIMITS = {
  CUSTNAME: 16, CUSTDES: 48, PHONE: 20, EMAIL: 68, ADDRESS: 80, STATE: 40, VATNUM: 16,
  DETAILS: 24, REFERENCE: 25, PARTNAME: 22, PDES: 59,
};
const MAX_LINES = 200;
const MAX_SEARCH = 64;

// ---------------------------------------------------------------- OData helpers

/** Escapes a value for use inside a single-quoted OData string literal. */
export function escapeODataString(value) {
  return String(value).replace(/'/g, "''");
}

/**
 * Priority's contains() is case-sensitive and silently ignores tolower(), so we
 * OR a few casings (as typed / lower / upper / Capitalised) plus a digits-only
 * variant for phone-like input.
 */
export function searchVariants(term) {
  const t = String(term ?? '').trim();
  if (!t) return [];
  const variants = [t, t.toLowerCase(), t.toUpperCase(), t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()];
  if (/^[\d\s()+\-.]+$/.test(t)) {
    const digits = t.replace(/\D/g, '');
    if (digits.length >= 3) variants.push(digits);
  }
  return [...new Set(variants)];
}

export function buildSearchFilter(fields, term) {
  const variants = searchVariants(term);
  if (!variants.length) return '';
  const clauses = [];
  for (const field of fields) {
    for (const v of variants) clauses.push(`contains(${field},'${escapeODataString(v)}')`);
  }
  return clauses.join(' or ');
}

/** Builds an OData query string. `$`-keys stay literal; values are URI-encoded. */
export function buildQuery(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
}

export function parsePaging(searchParams, { defaultTop = 50, maxTop = 200 } = {}) {
  const intParam = (name, fallback, min, max) => {
    const raw = searchParams.get(name);
    if (raw === null || raw === '') return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) {
      throw new HttpError(400, 'validation_error', `הפרמטר ${name} חייב להיות מספר שלם בין ${min} ל-${max}`, {
        fields: [{ field: name, min, max }],
      });
    }
    return n;
  };
  return { top: intParam('top', defaultTop, 1, maxTop), skip: intParam('skip', 0, 0, 1_000_000) };
}

function parseSearch(searchParams) {
  const search = (searchParams.get('search') ?? '').trim();
  if (search.length > MAX_SEARCH) {
    throw new HttpError(400, 'validation_error', `מחרוזת החיפוש ארוכה מדי (מקסימום ${MAX_SEARCH} תווים)`, {
      fields: [{ field: 'search', max: MAX_SEARCH }],
    });
  }
  return search;
}

// ---------------------------------------------------------------- mapping (Priority -> app)

const s = (v) => (v === null || v === undefined ? '' : String(v));

export function mapCustomer(row) {
  return {
    custname: s(row.CUSTNAME),
    name: s(row.CUSTDES),
    phone: s(row.PHONE),
    email: s(row.EMAIL),
    address: s(row.ADDRESS),
    // STATEA = city only; STATE = "city, state" in the US demo / city in IL installs.
    city: s(row.STATEA || row.STATE),
    vatNum: s(row.VATNUM),
  };
}

export function mapItem(row) {
  return {
    partname: s(row.PARTNAME),
    description: s(row.PARTDES),
    price: Number(row.BASEPLPRICE) || 0,
    currency: s(row.BASEPLCODE),
    unit: s(row.PUNITNAME || row.UNITNAME),
  };
}

export function mapPricelist(row) {
  return { code: s(row.PLNAME), name: s(row.PLDES), currency: s(row.CODE) };
}

// ---------------------------------------------------------------- write payloads (app -> Priority)

function validator() {
  const errors = [];
  const text = (field, value, { required = false, max, label }) => {
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
      if (required) errors.push({ field, message: `${label} הוא שדה חובה` });
      return undefined;
    }
    if (typeof value !== 'string' && typeof value !== 'number') {
      errors.push({ field, message: `${label} חייב להיות מחרוזת` });
      return undefined;
    }
    const v = String(value).trim();
    if (max && v.length > max) errors.push({ field, message: `${label} ארוך מדי (מקסימום ${max} תווים)`, max });
    return v;
  };
  const number = (field, value, { required = false, min, exclusiveMin, label }) => {
    if (value === undefined || value === null || value === '') {
      if (required) errors.push({ field, message: `${label} הוא שדה חובה` });
      return undefined;
    }
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) {
      errors.push({ field, message: `${label} חייב להיות מספר` });
      return undefined;
    }
    if (exclusiveMin !== undefined && !(n > exclusiveMin)) errors.push({ field, message: `${label} חייב להיות גדול מ-${exclusiveMin}` });
    if (min !== undefined && n < min) errors.push({ field, message: `${label} חייב להיות לפחות ${min}` });
    return n;
  };
  const done = () => {
    if (errors.length) throw new HttpError(400, 'validation_error', 'נתונים חסרים או שגויים בבקשה', { fields: errors });
  };
  return { text, number, errors, done };
}

const compact = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

export function buildCustomerPayload(body) {
  const v = validator();
  const payload = compact({
    CUSTNAME: v.text('custname', body.custname, { max: LIMITS.CUSTNAME, label: 'מספר לקוח' }),
    CUSTDES: v.text('name', body.name, { required: true, max: LIMITS.CUSTDES, label: 'שם לקוח' }),
    PHONE: v.text('phone', body.phone, { required: true, max: LIMITS.PHONE, label: 'טלפון' }),
    EMAIL: v.text('email', body.email, { max: LIMITS.EMAIL, label: 'דוא"ל' }),
    ADDRESS: v.text('address', body.address, { max: LIMITS.ADDRESS, label: 'כתובת' }),
    STATE: v.text('city', body.city, { max: LIMITS.STATE, label: 'עיר' }),
    VATNUM: v.text('vatNum', body.vatNum, { max: LIMITS.VATNUM, label: 'מספר עוסק/ח.פ.' }),
  });
  v.done();
  return payload;
}

function buildLines(v, lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    v.errors.push({ field: 'lines', message: 'יש לצרף לפחות שורה אחת' });
    return [];
  }
  if (lines.length > MAX_LINES) {
    v.errors.push({ field: 'lines', message: `יותר מדי שורות (מקסימום ${MAX_LINES})` });
    return [];
  }
  return lines.map((line, i) => {
    const l = line && typeof line === 'object' ? line : {};
    const f = (name) => `lines[${i}].${name}`;
    return compact({
      PARTNAME: v.text(f('partname'), l.partname, { required: true, max: LIMITS.PARTNAME, label: `מק"ט בשורה ${i + 1}` }),
      TQUANT: v.number(f('qty'), l.qty, { required: true, exclusiveMin: 0, label: `כמות בשורה ${i + 1}` }),
      PRICE: v.number(f('price'), l.price, { min: 0, label: `מחיר בשורה ${i + 1}` }),
      PDES: v.text(f('description'), l.description, { max: LIMITS.PDES, label: `תיאור בשורה ${i + 1}` }),
    });
  });
}

export function buildQuotePayload(body) {
  const v = validator();
  const head = compact({
    CUSTNAME: v.text('custname', body.custname, { required: true, max: LIMITS.CUSTNAME, label: 'מספר לקוח' }),
    DETAILS: v.text('details', body.details, { max: LIMITS.DETAILS, label: 'פרטים' }),
  });
  const lines = buildLines(v, body.lines);
  v.done();
  return { ...head, [FORMS.quoteLines]: lines };
}

export function buildOrderPayload(body) {
  const v = validator();
  const head = compact({
    CUSTNAME: v.text('custname', body.custname, { required: true, max: LIMITS.CUSTNAME, label: 'מספר לקוח' }),
    DETAILS: v.text('details', body.details, { max: LIMITS.DETAILS, label: 'פרטים' }),
    REFERENCE: v.text('reference', body.reference, { max: LIMITS.REFERENCE, label: 'אסמכתא' }),
  });
  const lines = buildLines(v, body.lines);
  v.done();
  return { ...head, [FORMS.orderLines]: lines };
}

// ---------------------------------------------------------------- client

/** Pulls a human message out of Priority's various error shapes. */
export function extractPriorityMessage(data) {
  if (!data) return '';
  if (typeof data === 'string') return data.slice(0, 500);
  if (data.error?.message) return String(data.error.message);
  const ie = data.FORM?.InterfaceErrors ?? data.InterfaceErrors;
  if (ie) {
    const list = Array.isArray(ie) ? ie : [ie];
    return list.map((e) => (typeof e === 'string' ? e : e?.text ?? '')).filter(Boolean).join(' | ');
  }
  if (data.message) return String(data.message);
  return JSON.stringify(data).slice(0, 500);
}

export function priorityHttpError(status, data) {
  const message = extractPriorityMessage(data);
  const details = { status, message };
  if (status === 401 || status === 403) {
    return new HttpError(502, 'priority_auth_failed', 'פריוריטי דחה את פרטי ההתחברות (משתמש/סיסמה/PAT או רישיון API)', details);
  }
  if (status === 429) {
    return new HttpError(429, 'priority_rate_limited', 'חריגה ממכסת הקריאות לפריוריטי. נסו שוב בעוד דקה', details);
  }
  if (status >= 500) {
    return new HttpError(502, 'priority_unavailable', 'שרת פריוריטי אינו זמין כרגע', details);
  }
  return new HttpError(502, 'priority_rejected', message ? `פריוריטי דחה את הבקשה: ${message}` : 'פריוריטי דחה את הבקשה', details);
}

const limiters = new Map();
function sharedLimiter(cfg) {
  // Priority Cloud throttles at ~100 calls/min per API user; stay below it.
  const key = `${cfg.serviceRoot}|${cfg.user}`;
  if (!limiters.has(key)) limiters.set(key, createRateLimiter({ max: 90, windowMs: 60_000 }));
  return limiters.get(key);
}

export function createPriorityClient(cfg, opts = {}) {
  const {
    fetchImpl = (...args) => globalThis.fetch(...args),
    limiter = sharedLimiter(cfg),
    sleep = defaultSleep,
    now = Date.now,
    maxAttempts = 3,
    timeoutMs = 20_000,
    maxRetryWaitMs = 30_000,
  } = opts;

  const baseHeaders = {
    accept: 'application/json',
    authorization: `Basic ${Buffer.from(`${cfg.user}:${cfg.password}`, 'utf8').toString('base64')}`,
  };
  if (cfg.appId) baseHeaders['x-app-id'] = cfg.appId;
  if (cfg.appKey) baseHeaders['x-app-key'] = cfg.appKey;

  async function request(method, path, { query, body } = {}) {
    const url = `${cfg.serviceRoot}/${path}${query ? `?${query}` : ''}`;
    const init = { method, headers: { ...baseHeaders } };
    if (body !== undefined) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    for (let attempt = 1; ; attempt++) {
      await limiter.acquire();
      const res = await fetchUpstream(url, init, { timeoutMs, service: SERVICE, fetchImpl });
      if ((res.status === 429 || res.status === 503) && attempt < maxAttempts) {
        const wait = parseRetryAfter(res.headers.get('retry-after'), now) ?? backoffDelay(attempt);
        if (wait <= maxRetryWaitMs) {
          try { await res.body?.cancel(); } catch { /* ignore */ }
          await sleep(wait);
          continue;
        }
      }
      const data = await readUpstream(res);
      if (res.ok) return data;
      throw priorityHttpError(res.status, data);
    }
  }

  return {
    get: (path, query) => request('GET', path, { query }),
    post: (path, body) => request('POST', path, { body }),
    patch: (path, body) => request('PATCH', path, { body }),
    del: (path) => request('DELETE', path),
  };
}

// ---------------------------------------------------------------- routes

function requireReadable(cfg) {
  if (cfg.mode === 'off') throw new HttpError(503, 'priority_off', 'החיבור לפריוריטי כבוי (PRIORITY_MODE=off)');
  if (!cfg.configured) {
    throw new HttpError(503, 'priority_not_configured', 'חסרים פרטי התחברות לפריוריטי: PRIORITY_URL ו-PRIORITY_USER/PRIORITY_PASSWORD או PRIORITY_PAT');
  }
}

function requireWritable(cfg) {
  requireReadable(cfg);
  // Priority's public demo is shared by everyone on the internet: never write to it, whatever PRIORITY_ALLOW_WRITE says
  if (cfg.mode !== 'live') {
    throw new HttpError(403, 'priority_write_disabled', 'סביבת הדמו של Priority משותפת לכולם, ולכן לא כותבים אליה. כתיבה רק מול המערכת של החברה (PRIORITY_MODE=live)', { mode: cfg.mode });
  }
  if (!cfg.allowWrite) {
    throw new HttpError(403, 'priority_write_disabled', 'כתיבה לפריוריטי מושבתת בשרת. כדי לאפשר יצירת לקוחות, הצעות מחיר והזמנות יש להגדיר PRIORITY_ALLOW_WRITE=true', {
      mode: cfg.mode,
    });
  }
}

const rows = (data) => (Array.isArray(data?.value) ? data.value : []);

export async function priorityTest({ cfg }) {
  const p = cfg.priority;
  const started = Date.now();
  const base = { mode: p.mode, serviceRoot: p.serviceRoot ?? null };
  try {
    requireReadable(p);
    const data = await createPriorityClient(p).get(FORMS.customers, buildQuery({ $top: 5, $select: 'CUSTNAME' }));
    return { status: 200, body: { ok: true, latencyMs: Date.now() - started, ...base, sample: { customers: rows(data).length } } };
  } catch (err) {
    if (!(err instanceof HttpError)) throw err;
    return { status: err.status, body: { ok: false, latencyMs: Date.now() - started, ...base, ...errorBody(err) } };
  }
}

export async function listCustomers({ cfg, url }) {
  requireReadable(cfg.priority);
  const { top, skip } = parsePaging(url.searchParams);
  const search = parseSearch(url.searchParams);
  const query = buildQuery({
    $select: CUSTOMER_SELECT,
    $filter: buildSearchFilter(['CUSTDES', 'PHONE', 'CUSTNAME'], search),
    $top: top,
    $skip: skip,
  });
  const data = await createPriorityClient(cfg.priority).get(FORMS.customers, query);
  return { status: 200, body: { items: rows(data).map(mapCustomer), top, skip } };
}

export async function listItems({ cfg, url }) {
  requireReadable(cfg.priority);
  const { top, skip } = parsePaging(url.searchParams);
  const search = parseSearch(url.searchParams);
  const query = buildQuery({
    $select: ITEM_SELECT,
    $filter: buildSearchFilter(['PARTDES', 'PARTNAME'], search),
    $top: top,
    $skip: skip,
  });
  const data = await createPriorityClient(cfg.priority).get(FORMS.items, query);
  return { status: 200, body: { items: rows(data).map(mapItem), top, skip } };
}

export async function listPricelists({ cfg }) {
  requireReadable(cfg.priority);
  const data = await createPriorityClient(cfg.priority).get(FORMS.pricelists, buildQuery({ $select: PRICELIST_SELECT, $top: 500 }));
  return { status: 200, body: { items: rows(data).map(mapPricelist) } };
}

const isDryRun = (url) => /^(1|true)$/i.test(url.searchParams.get('dryRun') ?? '');

async function createRecord({ req, url, cfg }, { form, build, key, resultKey }) {
  // dryRun validates and returns the exact payload without any network call,
  // so it works even while writes are disabled.
  if (isDryRun(url)) return { status: 200, body: { dryRun: true, form, payload: build(await readJson(req)) } };
  requireWritable(cfg.priority);
  const payload = build(await readJson(req));
  const created = await createPriorityClient(cfg.priority).post(form, payload);
  const id = created?.[key];
  if (!id) {
    throw new HttpError(502, 'priority_bad_response', 'פריוריטי לא החזיר מזהה לרשומה שנוצרה', { form });
  }
  return { status: 201, body: { [resultKey]: String(id) } };
}

export const createCustomer = (ctx) =>
  createRecord(ctx, { form: FORMS.customers, build: buildCustomerPayload, key: 'CUSTNAME', resultKey: 'custname' });
export const createQuote = (ctx) =>
  createRecord(ctx, { form: FORMS.quotes, build: buildQuotePayload, key: 'CPROFNUM', resultKey: 'cprofnum' });
export const createOrder = (ctx) =>
  createRecord(ctx, { form: FORMS.orders, build: buildOrderPayload, key: 'ORDNAME', resultKey: 'ordname' });
