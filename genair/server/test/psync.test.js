import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DocStore } from '../src/db/store.js';
import { PrioritySync, ORIGIN } from '../src/psync/engine.js';
import { startPrioritySync, stopPrioritySync } from '../src/psync/index.js';
import { HttpError } from '../src/http.js';
import { startServer, useEnv } from './helpers.js';
import { bearer, bootstrapOrg, loginAs } from './fixtures.js';

// ------------------------------------------------------------ a small in-memory Priority (OData subset the engine uses)

const KEYS = { CUSTOMERS: 'CUSTNAME', CPROF: 'CPROFNUM', ORDERS: 'ORDNAME', SUPPLIERS: 'SUPNAME', PORDERS: 'ORDNAME', DOCUMENTS_Q: 'DOCNO', DOCUMENTS_T: 'DOCNO', DOCUMENTS_D: 'DOCNO', DOCUMENTS_P: 'DOCNO', SERNUMBERS: 'SERNUM', AGENTS: 'AGENTCODE' };
const PREFIX = { CUSTOMERS: 'C', CPROF: 'PQ', ORDERS: 'SO', SUPPLIERS: 'S', PORDERS: 'PO', DOCUMENTS_Q: 'SC', DOCUMENTS_T: 'WR', DOCUMENTS_D: 'SH', DOCUMENTS_P: 'GR', AGENTS: 'A' };
// "'X'" or "DOCNO='X',TYPE='T'" -> X
const keyOf = (k) => (k === undefined ? undefined : /^'(.*)'$/.exec(k)?.[1] ?? /DOCNO='([^']*)'/.exec(k)?.[1] ?? k);

function evalFilter(row, filter) {
  if (!filter) return true;
  return filter.split(' or ').some((alt) =>
    alt.split(' and ').every((clause) => {
      const m = /^\(?(\w+) (eq|ge) (.+?)\)?$/.exec(clause.trim());
      if (!m) throw new Error(`fake priority: unsupported filter ${clause}`);
      const [, f, opr, raw] = m;
      const v = raw.startsWith("'") ? raw.slice(1, -1).replace(/''/g, "'") : raw;
      if (opr === 'eq') return String(row[f] ?? '') === v;
      return String(row[f] ?? '') >= v;
    }),
  );
}

class FakePriority {
  constructor(tables = {}) {
    this.t = {
      CUSTOMERS: [], CPROF: [], ORDERS: [], SUPPLIERS: [], PORDERS: [], DOCUMENTS_Q: [], AINVOICES: [], CINVOICES: [], EINVOICES: [], TINVOICES: [], LOGPART: [], OBLIGO: [], PARTBAL: [],
      // status tables as they are in Priority's demo
      CUSTSTATS: [
        { STATDES: 'Potential', INITSTATFLAG: 'Y', TMPFLAG: 'Y', OPENORDFLAG: 'Y' },
        { STATDES: 'Active', ACTIVESTATFLAG: 'Y', OPENORDFLAG: 'Y', OPENSERVCALLFLAG: 'Y' },
        { STATDES: 'Inactive' },
      ],
      AGENTS: [], YINVOICES: [], PINVOICES: [], SERNUMBERS: [], DOCUMENTS_T: [], DOCUMENTS_D: [], DOCUMENTS_P: [],
      CALLSTATUSES: [{ CODE: 'Open', INITSTATFLAG: 'Y', ACTIVEFLAG: 'Y' }, { CODE: 'Closed', FINAL: 'Y' }, { CODE: 'Canceled', FINAL: 'Y', CANCEL: 'Y' }],
      TDOCSTATS: [{ STATDES: 'Draft' }, { STATDES: 'Final', FINALFLAG: 'Y', DEFAULTFINAL: 'Y' }],
      DDOCSTATS: [{ STATDES: 'Draft' }, { STATDES: 'Final', FINALFLAG: 'Y', DEFAULTFINAL: 'Y' }],
      PORDSTATS: [{ STATDES: 'טיוטא', INITSTATFLAG: 'Y' }, { STATDES: 'אושרה', APPROVED: 'Y', OPENDOCFLAG: 'Y', AFTERAPPFLAG: 'Y' }, { STATDES: 'Closed', CLOSEDBOOL: 'Y', CLOSESTATFLAG: 'Y' }, { STATDES: 'Canceled', CLOSEDBOOL: 'Y' }],
      CPROFSTATS: [
        { STATDES: 'Draft', INITSTATFLAG: 'Y', CHANGEFLAG: 'Y', ACTIVEFLAG: 'Y', OPENORDFLAG: 'N' },
        { STATDES: 'Sent', ACTIVEFLAG: 'Y', OPENORDFLAG: 'Y' },
        { STATDES: 'Canceled' },
        { STATDES: 'אושרה', ACTIVEFLAG: 'Y', AFTERAPPFLAG: 'Y', OPENORDFLAG: 'Y' },
        { STATDES: 'דחיית הצעה' },
      ],
      ...tables,
    };
    this.n = 0;
    this.calls = [];
  }
  parse(path) {
    const m = /^(\w+)(?:\(([^)]*)\))?(?:\/(\w+)(?:\(([^)]*)\))?)?$/.exec(path);
    if (!m) throw new Error(`fake priority: bad path ${path}`);
    return { form: m[1], key: keyOf(m[2]), sub: m[3], subKey: m[4] };
  }
  row(form, key) {
    const r = this.t[form].find((x) => String(x[KEYS[form]]) === key);
    if (!r) throw new HttpError(502, 'priority_rejected', 'not found', { message: 'not found' });
    return r;
  }
  async get(path, query = '') {
    this.calls.push(['GET', path]);
    const p = this.parse(path);
    const qs = new URLSearchParams(query);
    let list;
    if (p.sub) list = this.row(p.form, p.key)[p.sub] ?? [];
    else list = this.t[p.form];
    if (!list) throw new HttpError(502, 'priority_rejected', 'closed', { message: 'לא ניתן להפעיל API למסך זה.' });
    list = list.filter((r) => evalFilter(r, qs.get('$filter')));
    const skip = Number(qs.get('$skip') ?? 0);
    const top = Number(qs.get('$top') ?? 1000);
    return { value: list.slice(skip, skip + top) };
  }
  async post(path, body) {
    this.calls.push(['POST', path, body]);
    const p = this.parse(path);
    if (p.sub) {
      const parent = this.row(p.form, p.key);
      parent[p.sub] = parent[p.sub] ?? [];
      const line = { ...body, KLINE: ++this.n, FIRM: 900 + this.n };
      parent[p.sub].push(line);
      return line;
    }
    const key = KEYS[p.form];
    const refuse = (message) => {
      throw new HttpError(502, 'priority_rejected', message, { message });
    };
    // the real Priority's rules that the first live test ran into
    const cust = body.CUSTNAME && this.t.CUSTOMERS.find((c) => c.CUSTNAME === body.CUSTNAME);
    if (p.form === 'ORDERS' && body.CPROFNUM && this.t.CPROF.find((c) => c.CPROFNUM === body.CPROFNUM)?.STATDES === 'Draft') refuse(`שורה 1- הצעת מחיר ${body.CPROFNUM}: לא ניתן לבסס הזמנה על הצעת מחיר בסטטוס "Draft".`);
    if (p.form === 'DOCUMENTS_Q' && cust?.STATDES === 'Potential') refuse(`שורה 1- מס. לקוח ${body.CUSTNAME}: הלקוח ${body.CUSTNAME} הינו לקוח זמני.`);
    for (const [f, v] of Object.entries(body)) {
      if (f.endsWith('_SUBFORM') && Array.isArray(v) && v.some((l) => l.PDES && l.PARTNAME !== '000')) refuse('שורה 2- תאור מוצר: אין לשנות תאור מוצר אלא אם כן סומן כניתן לשנוי');
    }
    const row = { ...body, [key]: body[key] ?? `${PREFIX[p.form]}${++this.n}` };
    // like the demo: without a number Priority opens a temporary customer (T...); with one, a regular active one
    if (p.form === 'CUSTOMERS') {
      if (!body.CUSTNAME) row.CUSTNAME = `T${String(++this.n).padStart(6, '0')}`;
      row.STATDES = row.STATDES ?? (body.CUSTNAME ? 'Active' : 'Potential');
    }
    if (p.form === 'CPROF') row.STATDES = 'Draft';
    if (['DOCUMENTS_T', 'DOCUMENTS_D', 'DOCUMENTS_P'].includes(p.form)) row.STATDES = 'Draft';
    if (p.form === 'PORDERS') row.STATDES = 'טיוטא';
    if (p.form === 'DOCUMENTS_P' && body.TRANSORDER_P_SUBFORM?.some((l) => this.t.PORDERS.find((o) => o.ORDNAME === l.ORDNAME)?.STATDES === 'טיוטא')) refuse('הזמנת רכש נמצאת בסטטוס "טיוטא".');
    if (p.form === 'DOCUMENTS_Q' && body.CALLSTATUSCODE === undefined) row.CALLSTATUSCODE = 'Open';
    for (const [f, v] of Object.entries(row)) if (f.endsWith('_SUBFORM') && Array.isArray(v)) row[f] = v.map((l) => ({ ...l, KLINE: ++this.n }));
    if (p.form === 'CUSTOMERS') row.CREATEDDATE = new Date().toISOString().slice(0, 10) + 'T00:00:00Z';
    this.t[p.form].push(row);
    return row;
  }
  async patch(path, body) {
    this.calls.push(['PATCH', path, body]);
    const p = this.parse(path);
    if (p.sub) {
      const name = /NAME='([^']*)'/.exec(p.subKey)?.[1];
      const code = keyOf(p.subKey);
      const line = this.row(p.form, p.key)[p.sub].find((l) => (name ? l.NAME === name : String(l.CODE) === code));
      Object.assign(line, body);
      return line;
    }
    const row = this.row(p.form, p.key);
    if (p.form === 'DOCUMENTS_Q' && row.CALLSTATUSCODE === 'Closed') {
      const message = "לא ניתן לבצע שינויים בתעודה אשר נמצאת בסטטוס 'Closed'";
      throw new HttpError(502, 'priority_rejected', message, { message });
    }
    if (p.form === 'CUSTOMERS' && body.STATDES && /^T/.test(row.CUSTNAME)) {
      const message = 'שורה 1- כדי להפוך לקוח זמני ללקוח רגיל יש להשתמש בתוכנית "הפיכת לקוח זמני ללקוח"';
      throw new HttpError(502, 'priority_rejected', message, { message });
    }
    return Object.assign(row, body);
  }
  async del(path) {
    this.calls.push(['DELETE', path]);
    const p = this.parse(path);
    const parent = this.row(p.form, p.key);
    parent[p.sub] = parent[p.sub].filter((l) => String(l.KLINE) !== p.subKey);
    return null;
  }
  writes() {
    return this.calls.filter((c) => c[0] !== 'GET');
  }
}

const STREAMS = ['agents', 'customers', 'addresses', 'contacts', 'quotes', 'orders', 'suppliers', 'purchasing', 'service', 'units', 'files', 'stockmoves', 'notes', 'invoices', 'receipts', 'supplierinvoices', 'items', 'balances', 'stock'];
const syncCfg = (over = {}) => ({ customerPrefix: 'GN', filesMaxMb: 8, enabled: true, streams: new Set(STREAMS), hotSec: 60, warmSec: 600, pushDebounceMs: 0, genericPart: '000', importCustomers: 'new', importItems: false, autoActivate: true, warehouses: {}, ...over });

async function setup({ priority = new FakePriority(), allowWrite = true, cfg = {}, data = {} } = {}) {
  const store = await new DocStore({}).init();
  const seed = {
    customers: [{ id: 'c1', name: 'משפחת נבון', phone: '0541234567', type: 'private', addresses: [{ id: 'ad1', city: 'ירושלים', street: 'הרצל', number: '24' }], temp: true, sync: { status: 'pending' } }],
    cases: [{ id: 'k1', customerId: 'c1', title: 'דירת 4 חדרים', stage: 'quote', createdAt: '2026-10-01' }],
    catalog: [{ id: 'i1', sku: 'MINI-5', name: 'מיני מרכזי 5 כ״ס', price: 9000, cost: 6000, sync: { status: 'not_synced' } }],
    ...data,
  };
  store.importSnapshot({ collections: { users: [{ id: 'u-office', name: 'משרד', role: 'office' }], ...seed } });
  const engine = new PrioritySync({ store, client: priority, priority: { mode: 'live', allowWrite }, sync: syncCfg(cfg), log: { error() {} } });
  return { store, engine, priority };
}

const userWrite = (store, ops) => store.applyOps(ops.map((o) => ({ at: Date.now(), ...o })), { clientId: 'device-1', userId: 'u-office' });

// ------------------------------------------------------------ app -> Priority

test('a new customer is opened in Priority once, then updated, never duplicated', async () => {
  const { store, engine, priority } = await setup();
  await engine.sweep();
  await engine.chain;
  assert.equal(priority.t.CUSTOMERS.length, 1);
  const row = priority.t.CUSTOMERS[0];
  assert.equal(row.CUSTDES, 'משפחת נבון');
  assert.equal(row.ADDRESS, 'הרצל 24');
  assert.equal(row.STATE, 'ירושלים');
  const c = store.get('customers', 'c1');
  assert.equal(c.sync.status, 'synced');
  assert.equal(c.sync.priorityId, row.CUSTNAME);
  assert.equal(c.temp, false);

  await engine.sweep({ all: true });
  await engine.chain;
  assert.equal(priority.writes().length, 1, 'nothing changed: no second write');

  userWrite(store, [{ op: 'patch', collection: 'customers', id: 'c1', data: { email: 'navon@example.com' } }]);
  await engine.sweep();
  await engine.chain;
  assert.equal(priority.t.CUSTOMERS.length, 1);
  assert.equal(priority.t.CUSTOMERS[0].EMAIL, 'navon@example.com');
  assert.equal(priority.writes().at(-1)[0], 'PATCH');
});

test('a customer that already exists in Priority (same phone) is linked, and Priority keeps its details', async () => {
  const priority = new FakePriority({ CUSTOMERS: [{ CUSTNAME: '10077', CUSTDES: 'נבון יוסי', PHONE: '0541234567', STATE: 'ירושלים' }] });
  const { store, engine } = await setup({ priority });
  await engine.sweep();
  await engine.chain;
  assert.equal(priority.t.CUSTOMERS.length, 1, 'no new customer');
  const c = store.get('customers', 'c1');
  assert.equal(c.sync.priorityId, '10077');
  assert.equal(c.name, 'נבון יוסי', 'the name in Priority wins on linking');
  assert.equal(priority.t.CUSTOMERS[0].STATE, 'ירושלים');
  assert.equal(priority.t.CUSTOMERS[0].ADDRESS, 'הרצל 24', 'what Priority lacks is filled in from the app');
});

test('an approved quote becomes a Priority quote and an order, with catalog SKUs and a generic part', async () => {
  const quote = { id: 'q1', caseId: 'k1', number: 'Q-1042', status: 'approved', discountPct: 10, lines: [
    { id: 'l1', itemId: 'i1', description: 'מיני מרכזי', qty: 1, unitPrice: 9000 },
    { id: 'l2', description: 'פירוק מזגן ישן', qty: 2, unitPrice: 350 },
  ], sync: { status: 'pending' } };
  const { store, engine, priority } = await setup({ data: { quotes: [quote] } });
  await engine.sweep();
  await engine.chain;
  assert.equal(priority.t.CPROF.length, 1);
  assert.equal(priority.t.ORDERS.length, 1);
  const order = priority.t.ORDERS[0];
  assert.equal(order.REFERENCE, 'Q-1042');
  assert.equal(order.CPROFNUM, priority.t.CPROF[0].CPROFNUM);
  assert.deepEqual(order.ORDERITEMS_SUBFORM.map((l) => [l.PARTNAME, l.TQUANT, l.PRICE, l.PDES]), [['MINI-5', 1, 8100, undefined], ['000', 2, 315, 'פירוק מזגן ישן']], 'catalog lines go by SKU only; free lines keep their text');
  assert.equal(priority.t.CPROF[0].STATDES, 'אושרה', 'the quote is approved in Priority before the order is based on it');
  const q = store.get('quotes', 'q1');
  assert.equal(q.sync.priorityId, order.ORDNAME);
  assert.equal(q.cprof.status, 'synced');

  await engine.sweep({ all: true });
  await engine.chain;
  assert.equal(priority.t.ORDERS.length, 1, 'the order is created once');
});

test('an order already in Priority with the quote number is linked, not created again', async () => {
  const priority = new FakePriority({ ORDERS: [{ ORDNAME: 'SO777', REFERENCE: 'Q-1042', CUSTNAME: 'x' }] });
  const quote = { id: 'q1', caseId: 'k1', number: 'Q-1042', status: 'approved', discountPct: 0, lines: [{ id: 'l1', itemId: 'i1', description: 'x', qty: 1, unitPrice: 1 }], sync: { status: 'pending' } };
  const { store, engine } = await setup({ priority, cfg: { streams: new Set(['customers', 'orders']) }, data: { quotes: [quote] } });
  await engine.sweep();
  await engine.chain;
  assert.equal(priority.t.ORDERS.length, 1);
  assert.equal(store.get('quotes', 'q1').sync.priorityId, 'SO777');
});

test('a new customer gets the next GN number, is regular in Priority at once, and a service call opens for it', async () => {
  const calls = [{ id: 'sc1', number: 'SC-1', customerId: 'c1', description: 'נזילה', status: 'new', urgency: 'normal', source: 'phone' }];
  const priority = new FakePriority({ CUSTOMERS: [{ CUSTNAME: 'GN000001', CUSTDES: 'someone else', PHONE: '000' }] });
  const { store, engine } = await setup({ priority, data: { serviceCalls: calls } });
  await engine.sweep();
  await engine.chain;
  const row = priority.t.CUSTOMERS.find((r) => r.CUSTDES === 'משפחת נבון');
  assert.equal(row.CUSTNAME, 'GN000002', 'a number already in Priority is skipped');
  assert.equal(row.STATDES, 'Active');
  assert.equal(priority.t.DOCUMENTS_Q.length, 1);
  assert.equal(store.get('serviceCalls', 'sc1').sync.status, 'synced');
});

test('a potential (non temporary) customer is moved to active before a service call', async () => {
  const priority = new FakePriority({ CUSTOMERS: [{ CUSTNAME: '7001', CUSTDES: 'נבון', PHONE: '0541234567', STATDES: 'Potential' }] });
  const calls = [{ id: 'sc1', number: 'SC-1', customerId: 'c1', description: 'x', status: 'new', urgency: 'normal', source: 'phone' }];
  const { engine } = await setup({ priority, data: { serviceCalls: calls } });
  await engine.sweep();
  await engine.chain;
  assert.equal(priority.t.CUSTOMERS[0].STATDES, 'Active');
  assert.equal(priority.t.DOCUMENTS_Q.length, 1);
});

test('a temporary customer (T...) blocks a service call with an explanation of what to do in Priority', async () => {
  const calls = [{ id: 'sc1', number: 'SC-1', customerId: 'c1', description: 'x', status: 'new', urgency: 'normal', source: 'phone' }];
  const { store, engine, priority } = await setup({ cfg: { customerPrefix: '' }, data: { serviceCalls: calls } });
  await engine.sweep();
  await engine.chain;
  assert.match(priority.t.CUSTOMERS[0].CUSTNAME, /^T/);
  assert.equal(priority.t.DOCUMENTS_Q.length, 0);
  assert.match(store.get('serviceCalls', 'sc1').sync.error, /הפיכת לקוח זמני ללקוח/);
});

test('with PRIORITY_AUTO_ACTIVATE=off a temporary customer is left to the office, with a clear reason', async () => {
  const calls = [{ id: 'sc1', number: 'SC-1', customerId: 'c1', description: 'x', status: 'new', urgency: 'normal', source: 'phone' }];
  const priority0 = new FakePriority({ CUSTOMERS: [{ CUSTNAME: '7001', CUSTDES: 'נבון', PHONE: '0541234567', STATDES: 'Potential' }] });
  const { store, engine, priority } = await setup({ priority: priority0, cfg: { autoActivate: false }, data: { serviceCalls: calls } });
  await engine.sweep();
  await engine.chain;
  assert.equal(priority.t.DOCUMENTS_Q.length, 0);
  assert.match(store.get('serviceCalls', 'sc1').sync.error, /סטטוס פעיל/);
});

test('a quote the customer rejected is closed in Priority', async () => {
  const quote = { id: 'q1', caseId: 'k1', number: 'Q-9', status: 'sent', discountPct: 0, lines: [{ id: 'l1', itemId: 'i1', description: 'a', qty: 1, unitPrice: 100 }] };
  const { store, engine, priority } = await setup({ data: { quotes: [quote] } });
  await engine.sweep();
  await engine.chain;
  store.applyOps([{ op: 'patch', collection: 'quotes', id: 'q1', data: { status: 'rejected' }, at: Date.now() }], { clientId: 'dev' });
  await engine.sweep();
  await engine.chain;
  assert.equal(priority.t.CPROF[0].STATDES, 'דחיית הצעה');
});

test('editing a sent quote replaces its lines in Priority', async () => {
  const quote = { id: 'q1', caseId: 'k1', number: 'Q-7', status: 'sent', discountPct: 0, lines: [{ id: 'l1', itemId: 'i1', description: 'a', qty: 1, unitPrice: 100 }] };
  const { store, engine, priority } = await setup({ data: { quotes: [quote] } });
  await engine.sweep();
  await engine.chain;
  userWrite(store, [{ op: 'patch', collection: 'quotes', id: 'q1', data: { lines: [{ id: 'l1', itemId: 'i1', description: 'a', qty: 3, unitPrice: 100 }] } }]);
  await engine.sweep();
  await engine.chain;
  assert.equal(priority.t.CPROF.length, 1);
  assert.deepEqual(priority.t.CPROF[0].CPROFITEMS_SUBFORM.map((l) => l.TQUANT), [3]);
});

test('without write permission nothing is written and records wait as pending with the reason', async () => {
  const { store, engine, priority } = await setup({ allowWrite: false });
  await engine.sweep();
  await engine.chain;
  assert.equal(priority.writes().length, 0);
  const c = store.get('customers', 'c1');
  assert.equal(c.sync.status, 'pending');
  assert.match(c.sync.error, /PRIORITY_ALLOW_WRITE/);
});

test('a saved change is pushed by itself (change event), and the engine ignores its own writes', async () => {
  const { store, engine, priority } = await setup();
  engine.start({ firstRunMs: 1e9 });
  try {
    userWrite(store, [{ op: 'patch', collection: 'customers', id: 'c1', data: { name: 'משפחת נבון-לוי' } }]);
    await new Promise((r) => setTimeout(r, 20));
    await engine.chain;
    assert.equal(priority.t.CUSTOMERS.length, 1);
    assert.equal(priority.t.CUSTOMERS[0].CUSTDES, 'משפחת נבון-לוי');
    const n = priority.writes().length;
    await new Promise((r) => setTimeout(r, 20));
    await engine.chain;
    assert.equal(priority.writes().length, n, 'the sync status the engine wrote did not trigger another push');
  } finally {
    await engine.stop();
  }
});

// ------------------------------------------------------------ Priority -> app

test('a change made in Priority reaches the app and is not sent back', async () => {
  const { store, engine, priority } = await setup();
  await engine.sweep();
  await engine.chain;
  const pushes = priority.writes().length;
  Object.assign(priority.t.CUSTOMERS[0], { PHONE: '0529998877', EMAIL: 'office@navon.co.il' });
  await engine.pullCustomers();
  const c = store.get('customers', 'c1');
  assert.equal(c.phone, '0529998877');
  assert.equal(c.email, 'office@navon.co.il');
  await engine.sweep({ all: true });
  await engine.chain;
  assert.equal(priority.writes().length, pushes, 'no echo back to Priority');
  assert.ok(store.list('activities').some((a) => /עודכן מ-Priority/.test(a.text)));
});

test('when both sides changed the same customer, the app edit wins and goes out', async () => {
  const { store, engine, priority } = await setup();
  await engine.sweep();
  await engine.chain;
  priority.t.CUSTOMERS[0].CUSTDES = 'שם מ-Priority';
  userWrite(store, [{ op: 'patch', collection: 'customers', id: 'c1', data: { name: 'שם מהמערכת' } }]);
  await engine.pullCustomers();
  await engine.pushDirty();
  assert.equal(store.get('customers', 'c1').name, 'שם מהמערכת');
  assert.equal(priority.t.CUSTOMERS[0].CUSTDES, 'שם מהמערכת');
});

test('customers linked before the engine ran: Priority is the baseline, nothing is overwritten', async () => {
  const priority = new FakePriority({ CUSTOMERS: [{ CUSTNAME: '555', CUSTDES: 'שם בהנהלת חשבונות', PHONE: '0541234567' }] });
  const { store, engine } = await setup({ priority, data: { customers: [{ id: 'c1', name: 'שם ישן', phone: '0541234567', addresses: [], sync: { status: 'synced', priorityId: '555' } }] } });
  await engine.run('full');
  assert.equal(priority.writes().length, 0, 'no write to Priority');
  assert.equal(store.get('customers', 'c1').name, 'שם בהנהלת חשבונות');
  assert.ok(!store.list('activities').some((a) => /גם ב-Priority וגם במערכת/.test(a.text)), 'not reported as a conflict');
});

test('a customer opened in Priority after the sync started is imported', async () => {
  const { store, engine, priority } = await setup();
  engine.saveState({ customersSince: new Date(Date.now() - 60_000).toISOString() });
  priority.t.CUSTOMERS.push({ CUSTNAME: '20001', CUSTDES: 'מלון הגליל', PHONE: '046001122', VATNUM: '515151515', STATE: 'טבריה', CREATEDDATE: new Date().toISOString() });
  const r = await engine.pullCustomers();
  assert.equal(r.imported, 1);
  const c = store.get('customers', 'pc-20001');
  assert.equal(c.name, 'מלון הגליל');
  assert.equal(c.type, 'business');
  assert.equal(c.sync.priorityId, '20001');
});

test('order status, invoices and receipts from Priority land on the quote and in the case money tab', async () => {
  const quote = { id: 'q1', caseId: 'k1', number: 'Q-1', status: 'approved', discountPct: 0, lines: [{ id: 'l1', itemId: 'i1', description: 'x', qty: 1, unitPrice: 9000 }] };
  const money = [{ id: 'm1', caseId: 'k1', kind: 'payment', category: 'מקדמה', description: 'מקדמה — Q-1', amount: 2700, at: new Date().toISOString().slice(0, 10) }];
  const { store, engine, priority } = await setup({ data: { quotes: [quote], money } });
  await engine.sweep();
  await engine.chain;
  const custname = priority.t.CUSTOMERS[0].CUSTNAME;
  const ordname = priority.t.ORDERS[0].ORDNAME;
  const today = new Date().toISOString().slice(0, 10) + 'T00:00:00Z';
  Object.assign(priority.t.ORDERS[0], { ORDSTATUSDES: 'מאושרת', STATUSDATE: today, TOTPRICE: 10530 });
  priority.t.AINVOICES.push({ IVNUM: 'IN1001', CUSTNAME: custname, ORDNAME: ordname, IVDATE: today, TOTPRICE: 10530, FINAL: 'Y' });
  priority.t.AINVOICES.push({ IVNUM: 'IN1002', CUSTNAME: custname, ORDNAME: ordname, IVDATE: today, TOTPRICE: 1, FINAL: null });
  priority.t.TINVOICES.push({ IVNUM: 'RC1', CUSTNAME: custname, ORDNAME: null, IVDATE: today, TOTPRICE: 2700, FINAL: 'Y' });
  priority.t.TINVOICES.push({ IVNUM: 'RC2', CUSTNAME: custname, ORDNAME: ordname, IVDATE: today, TOTPRICE: 7830, FINAL: 'Y' });

  await engine.run('hot');
  assert.equal(store.get('quotes', 'q1').priorityOrder.status, 'מאושרת');
  const lines = store.list('money').filter((m) => m.caseId === 'k1');
  const inv = lines.filter((m) => m.kind === 'invoice');
  assert.deepEqual(inv.map((m) => m.priorityId), ['IN1001'], 'only final invoices');
  const pays = lines.filter((m) => m.kind === 'payment');
  assert.equal(pays.length, 2, 'the deposit typed in the app was linked to RC1, not doubled');
  assert.equal(store.get('money', 'm1').priorityId, 'RC1');
  assert.ok(pays.some((m) => m.priorityId === 'RC2' && m.amount === 7830 && m.source === 'priority'));

  await engine.run('hot');
  assert.equal(store.list('money').filter((m) => m.caseId === 'k1').length, lines.length, 'pulling again adds nothing');
});

test('prices, balances and mapped warehouse stock come from Priority', async () => {
  const priority = new FakePriority({
    LOGPART: [{ PARTNAME: 'MINI-5', BASEPLPRICE: 9400, COST: 6100, UDATE: new Date().toISOString() }, { PARTNAME: 'OTHER', BASEPLPRICE: 5, UDATE: new Date().toISOString() }],
    PARTBAL: [{ PARTNAME: 'MINI-5', WARHSNAME: 'Main', BALANCE: 7 }],
  });
  const { store, engine } = await setup({ priority, cfg: { warehouses: { Main: 'מחסן ראשי' } } });
  await engine.sweep();
  await engine.chain;
  priority.t.OBLIGO.push({ CUSTNAME: priority.t.CUSTOMERS[0].CUSTNAME, OBLIGO: 1200, IV_DEBIT: 1200, ACC_DEBIT: 1200, ORD_DEBIT: 0 });
  await engine.run('warm');
  const item = store.get('catalog', 'i1');
  assert.equal(item.price, 9400);
  assert.equal(item.cost, 6100);
  assert.equal(store.list('catalog').length, 1, 'unknown parts are not imported by default');
  assert.equal(store.get('customers', 'c1').balance.obligo, 1200);
  assert.equal(store.list('stock')[0].qty, 7);
  assert.equal(store.list('stock')[0].location, 'מחסן ראשי');
});

test('a form closed to the API pauses only its own stream', async () => {
  const priority = new FakePriority({ DOCUMENTS_Q: undefined });
  priority.createServiceCall = undefined;
  const calls = [{ id: 'sc1', number: 'SC-1', customerId: 'c1', description: 'נזילה', status: 'new', urgency: 'normal', source: 'phone' }];
  const { store, engine } = await setup({ priority, data: { serviceCalls: calls } });
  await engine.sweep();
  await engine.chain;
  assert.equal(store.get('customers', 'c1').sync.status, 'synced');
  assert.equal(engine.on('service'), false);
  assert.match(engine.state().streams.service.error, /סגור ל-API/);
});

// ------------------------------------------------------------ routes and permissions

test('sync routes: managers only; the webhook needs its key', async (t) => {
  useEnv(t, { PRIORITY_SYNC: 'on', PRIORITY_MODE: 'live', PRIORITY_URL: 'https://p.example/odata', PRIORITY_USER: 'u', PRIORITY_PASSWORD: 'p', PRIORITY_WEBHOOK_SECRET: 'hook-secret' });
  const s = await startServer(t);
  const { token: admin } = await bootstrapOrg(s);
  const agent = await loginAs(s, admin, 'u-agent1', '0502201102');
  const { loadConfig } = await import('../src/config.js');
  const fake = new FakePriority();
  await startPrioritySync(loadConfig(), { client: fake, firstRunMs: 1e9, log: { error() {} } });
  t.after(() => stopPrioritySync());

  assert.equal((await s.request('GET', '/api/priority/sync/status', { headers: bearer(agent) })).status, 403);
  const st = await s.request('GET', '/api/priority/sync/status', { headers: bearer(admin) });
  assert.equal(st.status, 200);
  assert.equal(st.json.running, true);
  assert.equal(st.json.engine.active, true);
  assert.equal(st.json.canWrite, false, 'no PRIORITY_ALLOW_WRITE');

  assert.equal((await s.request('POST', '/api/priority/webhook?key=wrong', { body: {} })).status, 401);
  assert.equal((await s.request('POST', '/api/priority/webhook?key=hook-secret', { body: { form: 'ORDERS' } })).status, 202);

  const health = await s.request('GET', '/api/health');
  assert.equal(health.json.features.prioritySync, true);

  // clients never write the engine's state or money lines that came from Priority
  const store = (await import('../src/psync/index.js')).currentEngine().store;
  store.applyOps([{ op: 'upsert', collection: 'money', id: 'pv-p-RC9', data: { caseId: 'k1', kind: 'payment', amount: 5, source: 'priority' }, at: Date.now() }], { clientId: ORIGIN });
  const res = await s.request('POST', '/api/db/ops', { headers: bearer(admin), body: { ops: [
    { op: 'patch', collection: 'integrations', id: 'priority', data: { lastError: 'x' }, at: Date.now() },
    { op: 'patch', collection: 'money', id: 'pv-p-RC9', data: { amount: 1 }, at: Date.now() },
  ] } });
  assert.deepEqual(res.json.results.map((r) => r.status), ['denied', 'denied']);
});

test('the engine\'s own state does not make an empty database look set up', async () => {
  const store = await new DocStore({}).init();
  const engine = new PrioritySync({ store, client: new FakePriority(), priority: { mode: 'live', allowWrite: true }, sync: syncCfg(), log: { error() {} } });
  engine.start({ firstRunMs: 1e9 });
  await engine.run('full');
  await engine.stop();
  assert.ok(store.get('integrations', 'priority'));
  assert.equal(store.isEmpty(), true);
});

test('without PRIORITY_SYNC the engine does not start and status says why', async (t) => {
  useEnv(t, { PRIORITY_MODE: 'live', PRIORITY_URL: 'https://p.example/odata', PRIORITY_USER: 'u', PRIORITY_PASSWORD: 'p' });
  const s = await startServer(t);
  const { token: admin } = await bootstrapOrg(s);
  const { loadConfig } = await import('../src/config.js');
  assert.equal(await startPrioritySync(loadConfig()), null);
  const st = await s.request('GET', '/api/priority/sync/status', { headers: bearer(admin) });
  assert.equal(st.json.running, false);
  assert.match(st.json.reason, /PRIORITY_SYNC/);
});

// ------------------------------------------------------------ everything else with a counterpart in Priority

const past = () => new Date(Date.now() - 10 * 60_000).toISOString();

test('agents, extra addresses, files and notes reach Priority once', async () => {
  const { store, engine, priority } = await setup({
    cfg: {},
    data: {
      customers: [{ id: 'c1', name: 'משפחת נבון', phone: '0541234567', addresses: [{ id: 'a1', city: 'ירושלים', street: 'הרצל', number: '24' }, { id: 'a2', label: 'המשרד', city: 'תל אביב', street: 'יגאל אלון', number: '90' }], sync: { status: 'pending' } }],
      cases: [{ id: 'k1', number: 'GN-1', customerId: 'c1', agentId: 'ua', title: 'דירה', stage: 'quote', createdAt: past() }],
      quotes: [{ id: 'q1', caseId: 'k1', number: 'Q-1', status: 'approved', discountPct: 0, lines: [{ id: 'l1', itemId: 'i1', description: 'x', qty: 1, unitPrice: 100 }] }],
      docs: [{ id: 'd1', caseId: 'k1', folder: 'customer', name: 'הצעה חתומה.pdf', mime: 'application/pdf', dataUrl: 'data:application/pdf;base64,JVBERi0=', uploadedAt: past() }],
      activities: [{ id: 'a1', kind: 'note', caseId: 'k1', text: 'הלקוח מבקש יחידות שקטות', at: new Date().toISOString() }, { id: 'a0', kind: 'note', caseId: 'k1', text: 'ישנה', at: '2020-01-01T00:00:00Z' }],
    },
  });
  userWrite(store, [{ op: 'upsert', collection: 'users', id: 'ua', data: { name: 'אבי לוי', role: 'agent', active: true, initials: 'AL' } }]);
  engine.saveState({ customersSince: past() });
  await engine.sweep({ all: true });
  await engine.chain;
  const cust = priority.t.CUSTOMERS[0];
  assert.equal(priority.t.AGENTS[0].AGENTNAME, 'אבי לוי');
  assert.equal(store.get('users', 'ua').priorityAgent, priority.t.AGENTS[0].AGENTCODE);
  assert.equal(priority.t.ORDERS[0].AGENTCODE, priority.t.AGENTS[0].AGENTCODE, 'the order carries the case agent');
  assert.deepEqual(cust.CUSTDESTS_SUBFORM.map((d) => [d.CODE, d.CODEDES, d.STATE]), [['01', 'המשרד', 'תל אביב']]);
  assert.equal(cust.CUSTEXTFILE_SUBFORM[0].EXTFILEDES, 'GN-1 · הצעה חתומה.pdf');
  assert.deepEqual(cust.CUSTNOTES_SUBFORM.map((n) => n.SUBJECT), ['GN-1: הלקוח מבקש יחידות שקטות'], 'notes older than the sync start stay out');
  await engine.sweep({ all: true });
  await engine.chain;
  assert.equal(priority.t.AGENTS.length, 1);
  assert.equal(cust.CUSTEXTFILE_SUBFORM.length, 1);
  assert.equal(cust.CUSTDESTS_SUBFORM.length, 1);
  assert.equal(cust.CUSTNOTES_SUBFORM.length, 1);
});

test('installed units become serial numbers; service calls close both ways', async () => {
  const { store, engine, priority } = await setup({
    data: {
      units: [{ id: 'un1', customerId: 'c1', itemId: 'i1', model: 'X', serial: 'SN-77', location: 'סלון', installedAt: '2026-10-01', warrantyUntil: '2029-10-01' }],
      serviceCalls: [
        { id: 'sc1', number: 'SC-1', customerId: 'c1', description: 'נזילה', status: 'in_progress', urgency: 'normal', source: 'phone' },
        { id: 'sc2', number: 'SC-2', customerId: 'c1', description: 'רעש', status: 'new', urgency: 'normal', source: 'phone' },
      ],
    },
  });
  await engine.sweep();
  await engine.chain;
  assert.deepEqual(priority.t.SERNUMBERS.map((r) => [r.SERNUM, r.PARTNAME, r.LOCATION]), [['SN-77', 'MINI-5', 'סלון']]);
  userWrite(store, [{ op: 'patch', collection: 'serviceCalls', id: 'sc1', data: { status: 'done', resolution: 'נוקה קו הניקוז' } }]);
  await engine.sweep();
  await engine.chain;
  const call1 = priority.t.DOCUMENTS_Q.find((r) => r.REFERENCE === 'SC-1');
  assert.equal(call1.DETAILS, 'נוקה קו הניקוז', 'what was done goes in before the call is closed');
  assert.equal(call1.CALLSTATUSCODE, 'Closed');
  // closed in Priority by the office -> closed here
  const call2 = priority.t.DOCUMENTS_Q.find((r) => r.REFERENCE === 'SC-2');
  Object.assign(call2, { CALLSTATUSCODE: 'Closed', STATUSDATE: new Date().toISOString() });
  await engine.run('hot');
  assert.equal(store.get('serviceCalls', 'sc2').status, 'done');
  // a later sweep doesn't try to change the closed call again
  const writes = priority.writes().length;
  await engine.sweep({ all: true });
  await engine.chain;
  assert.equal(priority.writes().length, writes);
});

test('stock movements: a transfer and parts used become final documents; a quick put-back cancels out', async () => {
  const at = past();
  const { store, engine, priority } = await setup({
    cfg: { warehouses: { Main: 'מחסן ראשי', 'Main:V1': 'רכב — רון' } },
    data: {
      stockMoves: [
        { id: 'sm1', kind: 'transfer', itemId: 'i1', qty: 4, from: 'מחסן ראשי', to: 'רכב — רון', at },
        { id: 'sm2', kind: 'use', itemId: 'i1', qty: 3, from: 'רכב — רון', customerId: 'c1', serviceCallId: 'sc1', at },
        { id: 'sm3', kind: 'return', itemId: 'i1', qty: 1, to: 'רכב — רון', customerId: 'c1', serviceCallId: 'sc1', at },
        { id: 'sm4', kind: 'use', itemId: 'i1', qty: 1, from: 'רכב — רון', customerId: 'c1', serviceCallId: 'sc9', at: new Date().toISOString() },
        { id: 'sm5', kind: 'use', itemId: 'i1', qty: 1, from: 'מחסן לא ממופה', customerId: 'c1', at },
      ],
    },
  });
  await engine.sweep();
  await engine.chain;
  const T = priority.t.DOCUMENTS_T[0];
  assert.deepEqual([T.WARHSNAME, T.LOCNAME, T.TOWARHSNAME, T.TOLOCNAME, T.STATDES], ['Main', '0', 'Main', 'V1', 'Final']);
  assert.equal(T.TRANSORDER_T_SUBFORM[0].TQUANT, 4);
  assert.equal(priority.t.DOCUMENTS_D.length, 1, 'the job within the grace period waits');
  const D = priority.t.DOCUMENTS_D[0];
  assert.deepEqual([D.CUSTNAME, D.LOCNAME, D.STATDES, D.TRANSORDER_D_SUBFORM[0].TQUANT], [priority.t.CUSTOMERS[0].CUSTNAME, 'V1', 'Final', 2], 'three used, one put back');
  assert.equal(store.get('stockMoves', 'sm3').sync.status, 'disabled');
  assert.match(store.get('stockMoves', 'sm5').sync.error, /לא ממופה/);
});

test('a received purchase order is approved and received in Priority; supplier invoices become expenses', async () => {
  const { store, engine, priority } = await setup({
    data: {
      suppliers: [{ id: 's1', name: 'ספק מיזוג', phone: '021234567', active: true }],
      purchaseOrders: [{ id: 'po1', number: 'PO-1', supplierId: 's1', caseId: 'k1', status: 'sent', lines: [{ itemId: 'i1', description: 'x', qty: 2, unitCost: 5000 }] }],
    },
  });
  await engine.sweep();
  await engine.chain;
  assert.equal(priority.t.PORDERS[0].STATDES, 'אושרה');
  userWrite(store, [{ op: 'patch', collection: 'purchaseOrders', id: 'po1', data: { status: 'received', toLocation: 'מחסן ראשי', receivedAt: new Date().toISOString() } }]);
  await engine.sweep();
  await engine.chain;
  const gr = priority.t.DOCUMENTS_P[0];
  assert.deepEqual([gr.STATDES, gr.TOWARHSNAME, gr.TRANSORDER_P_SUBFORM[0].ORDNAME], ['Final', 'Main', priority.t.PORDERS[0].ORDNAME]);
  priority.t.YINVOICES.push({ IVNUM: 'SI-9', SUPNAME: priority.t.SUPPLIERS[0].SUPNAME, ORDNAME: priority.t.PORDERS[0].ORDNAME, IVDATE: new Date().toISOString().slice(0, 10) + 'T00:00:00Z', TOTPRICE: 11800, FINAL: 'Y' });
  await engine.run('hot');
  const exp = store.list('money').find((m) => m.priorityId === 'SI-9');
  assert.deepEqual([exp.kind, exp.caseId, exp.amount, exp.source], ['expense', 'k1', 11800, 'priority']);
});

test('contacts added or edited in Priority come into the app', async () => {
  const { store, engine, priority } = await setup();
  await engine.sweep();
  await engine.chain;
  const cust = priority.t.CUSTOMERS[0];
  cust.CUSTPERSONNEL_SUBFORM = [{ NAME: 'דנה מהנהלת החשבונות', CELLPHONE: '0529991111', EMAIL: 'dana@example.com', FIRM: cust.CUSTDES }];
  await engine.run('warm');
  const ct = store.list('contacts').find((c) => c.name === 'דנה מהנהלת החשבונות');
  assert.equal(ct.customerId, 'c1');
  assert.equal(ct.phone, '0529991111');
  cust.CUSTPERSONNEL_SUBFORM[0].CELLPHONE = '0529992222';
  await engine.run('warm');
  assert.equal(store.get('contacts', ct.id).phone, '0529992222');
  const writes = priority.writes().length;
  await engine.sweep({ all: true });
  await engine.chain;
  assert.equal(priority.writes().length, writes, 'a contact that came from Priority is not sent back');
});
