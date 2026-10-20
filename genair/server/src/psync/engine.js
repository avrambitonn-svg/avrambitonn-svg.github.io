// Two-way sync between the shared store and Priority, running inside the server.
//
// App -> Priority: every change a user saves fires the store's 'change' event. The engine collects
// the changed records, waits a moment for the burst to settle, and pushes them (create or update).
// A sweep every minute retries what failed and catches anything a restart missed.
//
// Priority -> App: Priority has no change feed over its API, so the engine polls by date:
// orders, invoices and receipts every minute ("hot"), customers, items, balances and stock every
// ten minutes ("warm"). A Priority webhook (business rule) can call /api/priority/webhook to pull
// at once instead of waiting for the next round.
//
// No ping-pong: the engine's own writes carry origin 'priority-sync' and are ignored, and every
// record keeps the hash of what was last sent (sync.hash) and last seen in Priority (sync.remoteHash),
// so a value that came from Priority is never sent back.
import { randomBytes } from 'node:crypto';
import { HttpError } from '../http.js';
import * as P from './api.js';
import * as M from './map.js';
import * as X from './more.js';

export const ORIGIN = 'priority-sync';
export const STATE = { c: 'integrations', id: 'priority' };

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const uid = (prefix) => `${prefix}${randomBytes(6).toString('hex')}`;
const safeId = (s) => String(s).replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 100);
const errText = (e) => (e instanceof HttpError ? (e.details?.message ? `${e.message} (${e.details.message})` : e.message) : String(e?.message ?? e));

// collection -> the stream that pushes it, in dependency order (customers before what hangs on them)
const PUSH = [
  ['users', 'agents'],
  ['customers', 'customers'],
  ['contacts', 'contacts'],
  ['suppliers', 'suppliers'],
  ['quotes', 'quotes'],
  ['purchaseOrders', 'purchasing'],
  ['serviceCalls', 'service'],
  ['units', 'units'],
  ['docs', 'files'],
  ['stockMoves', 'stockmoves'],
  ['activities', 'notes'],
];
const PUSH_OF = new Map(PUSH);

/** Priority answered, but this form is closed to the API in this installation. */
const apiClosed = (e) => e instanceof HttpError && e.code === 'priority_rejected' && /API/.test(String(e.details?.message ?? ''));
/** Priority itself is down or refuses us: stop this round, try the next one. */
const fatal = (e) => e instanceof HttpError && (e.code === 'priority_auth_failed' || e.code === 'priority_rate_limited' || e.code === 'priority_unavailable' || /_timeout$|_unreachable$/.test(e.code));

export class PrioritySync {
  constructor({ store, client, priority, sync, now = Date.now, log = console, readFile }) {
    this.store = store;
    this.readFile = readFile;
    this.client = client;
    this.p = priority;
    this.cfg = sync;
    this.now = now;
    this.log = log;
    this.dirty = new Set();
    this.timers = [];
    this.debounce = null;
    this.chain = Promise.resolve();
    this.queued = new Set();
    this.inflight = new Set();
    this.closedUntil = {};
    this.started = false;
    this.onChange = this.onChange.bind(this);
  }

  /** Writes to Priority only with PRIORITY_ALLOW_WRITE, and never to the shared public demo. */
  get canWrite() {
    return Boolean(this.p.allowWrite) && this.p.mode === 'live';
  }

  on(stream) {
    return this.cfg.streams.has(stream) && !((this.closedUntil[stream] ?? 0) > this.now());
  }

  // ------------------------------------------------------------ lifecycle

  start({ firstRunMs = 3000 } = {}) {
    if (this.started) return this;
    this.started = true;
    this.store.on('change', this.onChange);
    const st = this.state();
    this.saveState({
      engine: { active: true, startedAt: new Date(this.now()).toISOString(), mode: this.p.mode, write: this.canWrite, streams: [...this.cfg.streams] },
      // customers opened in Priority from now on are imported (PRIORITY_IMPORT_CUSTOMERS=new)
      customersSince: st.customersSince ?? new Date(this.now()).toISOString(),
    });
    const every = (ms, fn) => {
      const t = setInterval(fn, ms);
      t.unref?.();
      this.timers.push(t);
    };
    const first = setTimeout(() => void this.run('full'), firstRunMs);
    first.unref?.();
    this.timers.push(first);
    every(this.cfg.hotSec * 1000, () => void this.run('hot'));
    every(this.cfg.warmSec * 1000, () => void this.run('warm'));
    every(6 * HOUR, () => void this.run('full'));
    return this;
  }

  async stop() {
    if (!this.started) return;
    this.started = false;
    this.store.off('change', this.onChange);
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    if (this.debounce) clearTimeout(this.debounce);
    await this.chain;
    this.saveState({ engine: { ...this.state().engine, active: false } });
  }

  /** Runs `fn` after everything already queued: one conversation with Priority at a time. */
  enqueue(fn) {
    const next = this.chain.then(fn).catch((e) => this.log.error?.('[priority-sync]', errText(e)));
    this.chain = next;
    return next;
  }

  onChange(e) {
    if (e.origin === ORIGIN) return;
    if (e.reset) return void this.run('hot');
    let any = false;
    for (const ch of e.changes ?? []) {
      if (ch.del || !PUSH_OF.has(ch.c)) continue;
      this.dirty.add(`${ch.c}\u0000${ch.id}`);
      any = true;
    }
    if (!any) return;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = null;
      void this.enqueue(() => this.pushDirty());
    }, this.cfg.pushDebounceMs);
    this.debounce.unref?.();
  }

  // ------------------------------------------------------------ state (shown on the sync screen)

  state() {
    return this.store.get(STATE.c, STATE.id) ?? {};
  }

  saveState(patch) {
    const cur = this.state();
    this.write([{ op: 'upsert', collection: STATE.c, id: STATE.id, data: { ...cur, ...patch, id: STATE.id } }]);
  }

  noteStream(name, info) {
    const streams = { ...(this.state().streams ?? {}) };
    streams[name] = { ...(streams[name] ?? {}), ...info, at: new Date(this.now()).toISOString() };
    this.saveState({ streams });
  }

  write(ops) {
    const at = this.now();
    return this.store.applyOps(ops.map((o) => ({ ...o, at })), { clientId: ORIGIN, userId: ORIGIN });
  }

  patch(c, id, data) {
    return this.write([{ op: 'patch', collection: c, id, data }]);
  }

  activity(text, ref = {}) {
    this.write([{ op: 'upsert', collection: 'activities', id: uid('a'), data: { at: new Date(this.now()).toISOString(), kind: 'sync', text, ...ref } }]);
  }

  // ------------------------------------------------------------ rounds

  /** hot: push sweep + orders, invoices, receipts. warm: customers, items, balances, stock. full: everything. */
  run(kind = 'hot') {
    if (this.queued.has(kind)) return this.chain;
    this.queued.add(kind);
    return this.enqueue(async () => {
      this.queued.delete(kind);
      // before the organization is set up there is nothing to sync
      if (!this.store.list('users').length) return;
      const t0 = this.now();
      let error = null;
      try {
        if (kind !== 'warm') await this.sweep({ all: kind === 'full' });
        if (kind !== 'warm') {
          await this.stream('orders', () => this.pullOrders(kind === 'full' ? 30 * DAY : DAY));
          await this.stream('invoices', () => this.pullMoney(P.INVOICE_FORMS, kind === 'full' ? 120 * DAY : 14 * DAY));
          await this.stream('receipts', () => this.pullMoney(['TINVOICES'], kind === 'full' ? 120 * DAY : 14 * DAY));
          await this.stream('service', () => X.pullServiceCalls(this, kind === 'full' ? 30 * DAY : DAY));
          await this.stream('supplierinvoices', () => X.pullSupplierInvoices(this, kind === 'full' ? 120 * DAY : 14 * DAY));
        }
        if (kind !== 'hot') {
          await this.stream('customers', () => this.pullCustomers());
          await this.stream('items', () => this.pullItems(kind === 'full'));
          await this.stream('balances', () => this.pullBalances());
          await this.stream('stock', () => this.pullStock());
          await this.stream('units', () => X.pullUnits(this));
          await this.stream('contacts', () => X.pullContacts(this));
          await this.stream('purchasing', () => X.pullPurchaseOrders(this));
        }
      } catch (e) {
        error = errText(e);
      }
      const runs = { ...(this.state().runs ?? {}) };
      runs[kind] = { at: new Date(t0).toISOString(), ms: this.now() - t0, ok: !error, ...(error ? { error } : {}) };
      this.saveState({ runs, lastError: error ?? null });
    });
  }

  /** Runs one stream; a closed form pauses that stream for six hours, Priority being down stops the round. */
  async stream(name, fn) {
    if (!this.on(name)) return;
    try {
      const counts = (await fn()) ?? {};
      this.noteStream(name, { ok: true, error: null, ...counts });
    } catch (e) {
      if (apiClosed(e)) {
        this.closedUntil[name] = this.now() + 6 * HOUR;
        this.noteStream(name, { ok: false, error: `המסך סגור ל-API ב-Priority: ${errText(e)}`, pausedUntil: new Date(this.closedUntil[name]).toISOString() });
        return;
      }
      this.noteStream(name, { ok: false, error: errText(e) });
      if (fatal(e)) throw e;
    }
  }

  // ------------------------------------------------------------ app -> Priority

  async pushDirty() {
    const keys = [...this.dirty];
    this.dirty.clear();
    const order = new Map(PUSH.map(([c], i) => [c, i]));
    keys.sort((a, b) => order.get(a.split('\u0000')[0]) - order.get(b.split('\u0000')[0]));
    for (const key of keys) {
      const [c, id] = key.split('\u0000');
      const e = this.store.get(c, id);
      if (e) await this.pushOne(c, e, { now: true });
    }
  }

  /** Everything that differs from what Priority last got, with backoff for records that keep failing. */
  async sweep({ all = false } = {}) {
    for (const [c] of PUSH) {
      if (!this.on(PUSH_OF.get(c)) && !(c === 'quotes' && this.on('orders'))) continue;
      for (const e of this.store.list(c)) await this.pushOne(c, e, { now: all });
    }
  }

  async pushOne(c, stale, { now = false } = {}) {
    if (!this.on(PUSH_OF.get(c)) && !(c === 'quotes' && this.on('orders'))) return;
    // one push per record at a time, always from its latest state (an earlier push may have just linked it)
    const key = `${c}\u0000${stale.id}`;
    if (this.inflight.has(key)) return;
    const e = this.store.get(c, stale.id);
    if (!e) return;
    this.inflight.add(key);
    try {
      if (c === 'users') await X.pushAgent(this, e, now);
      else if (c === 'units') await X.pushUnit(this, e, now);
      else if (c === 'docs') await X.pushDoc(this, e, now);
      else if (c === 'stockMoves') await X.pushStockMove(this, e, now);
      else if (c === 'activities') await X.pushNote(this, e, now);
      else if (c === 'customers') await this.pushCustomer(e, now);
      else if (c === 'contacts') await this.pushContact(e, now);
      else if (c === 'suppliers') await this.pushSupplier(e, now);
      else if (c === 'quotes') await this.pushQuote(e, now);
      else if (c === 'purchaseOrders') await this.pushPurchaseOrder(e, now);
      else if (c === 'serviceCalls') await this.pushServiceCall(e, now);
    } catch (err) {
      if (apiClosed(err)) {
        const stream = PUSH_OF.get(c);
        this.closedUntil[stream] = this.now() + 6 * HOUR;
        this.noteStream(stream, { ok: false, error: `המסך סגור ל-API ב-Priority: ${errText(err)}`, pausedUntil: new Date(this.closedUntil[stream]).toISOString() });
      }
      if (fatal(err)) throw err;
      this.markError(c, e, err);
    } finally {
      this.inflight.delete(key);
    }
  }

  /** false while a failing record waits out its backoff (1, 2, 4 ... minutes, up to 6 hours). */
  due(sync, now) {
    if (now || !sync || sync.status !== 'error') return true;
    const wait = Math.min(2 ** Math.max(0, (sync.attempts ?? 1) - 1) * MIN, 6 * HOUR);
    return this.now() - Date.parse(sync.lastSync ?? 0) >= wait;
  }

  markError(c, e, err, field = 'sync') {
    const cur = e[field] ?? {};
    this.patch(c, e.id, { [field]: { ...cur, status: 'error', error: errText(err), lastSync: new Date(this.now()).toISOString(), attempts: (cur.attempts ?? 0) + 1 } });
  }

  /** Writes are off: the record waits as "pending" with the reason, written once. */
  holdPending(c, e, reason, field = 'sync') {
    const cur = e[field] ?? {};
    if (cur.status === 'pending' && cur.error === reason) return;
    this.patch(c, e.id, { [field]: { ...cur, status: 'pending', error: reason } });
  }

  synced(c, id, field, cur, extra) {
    this.patch(c, id, { [field]: { ...cur, status: 'synced', error: undefined, attempts: 0, lastSync: new Date(this.now()).toISOString(), ...extra } });
  }

  writeGate(c, e, field = 'sync') {
    if (this.canWrite) return true;
    this.holdPending(c, e, this.p.mode === 'live' ? 'הכתיבה ל-Priority כבויה בשרת (PRIORITY_ALLOW_WRITE)' : 'סביבת הדמו של Priority: בלי כתיבה', field);
    return false;
  }

  // ---- customers

  async pushCustomer(c, now) {
    const payload = M.customerOut(c);
    const hash = M.hashOf(payload);
    const sync = c.sync ?? {};
    if (sync.priorityId && sync.hash === hash && sync.status === 'synced') return this.canWrite ? X.pushSites(this, c, sync.priorityId) : undefined;
    if (sync.status === 'disabled' || !this.due(sync, now)) return;
    if (!payload.CUSTDES || !payload.PHONE) return this.holdPending('customers', c, 'חסר שם או טלפון');
    // linked before the engine ran: no baseline yet, so nothing is overwritten; the next pull decides
    if (sync.priorityId && !sync.hash) return this.patch('customers', c.id, { sync: { ...sync, hash } });
    if (!this.writeGate('customers', c)) return;

    if (sync.priorityId) {
      await P.updateCustomer(this.client, sync.priorityId, payload);
      this.synced('customers', c.id, 'sync', sync, { hash, remoteHash: M.hashOf(M.pick(payload, M.CUSTOMER_KEYS)) });
      return X.pushSites(this, this.store.get('customers', c.id), sync.priorityId);
    }
    const found = await P.findCustomer(this.client, { phone: payload.PHONE, vat: payload.VATNUM });
    if (found.length > 1) {
      return this.markError('customers', c, new Error(`ב-Priority יש ${found.length} לקוחות עם אותו טלפון או ח״פ (${found.map((r) => r.CUSTNAME).join(', ')}). צריך לבחור ידנית.`));
    }
    if (found.length === 1) return this.linkCustomer(c, found[0]);
    const custname = await this.createNumberedCustomer(payload);
    if (!custname) throw new HttpError(502, 'priority_bad_response', 'Priority לא החזיר מספר לקוח');
    this.patch('customers', c.id, { temp: false });
    this.synced('customers', c.id, 'sync', sync, { priorityId: custname, hash, remoteHash: M.hashOf(M.pick(payload, M.CUSTOMER_KEYS)) });
    this.activity(`הלקוח נפתח ב-Priority (${custname})`, { customerId: c.id });
    await X.pushSites(this, this.store.get('customers', c.id), custname);
    this.queueDependents(c.id);
  }

  /**
   * With a prefix the customer gets the next number here (GN000123) and is a regular customer in Priority
   * at once; a number already taken in Priority is skipped. Without one, Priority numbers it (temporary).
   */
  async createNumberedCustomer(payload) {
    const prefix = this.cfg.customerPrefix;
    if (!prefix) return P.createCustomer(this.client, payload);
    for (let i = 0; i < 20; i++) {
      const { from } = this.store.reserve('priorityCustomer', 1);
      const custname = `${prefix}${String(from).padStart(6, '0')}`;
      if (await P.getCustomer(this.client, custname)) continue;
      return P.createCustomer(this.client, { CUSTNAME: custname, ...payload });
    }
    throw new HttpError(409, 'customer_number_taken', `לא נמצא מספר לקוח פנוי עם הקידומת ${prefix}`);
  }

  /** An existing Priority customer: Priority's details win, and only what it lacks is filled in from the app. */
  async linkCustomer(c, row) {
    const fromP = M.customerIn(row, c);
    const merged = { ...c, ...fromP };
    const payload = M.customerOut(merged);
    const have = M.customerRow(row);
    const missing = Object.fromEntries(Object.entries(payload).filter(([k]) => !have[k]));
    if (Object.keys(missing).length) await P.updateCustomer(this.client, row.CUSTNAME, missing);
    this.patch('customers', c.id, { ...fromP, temp: false });
    this.synced('customers', c.id, 'sync', c.sync ?? {}, {
      priorityId: String(row.CUSTNAME),
      hash: M.hashOf(payload),
      remoteHash: M.hashOf({ ...have, ...missing }),
    });
    this.activity(`הלקוח קושר ללקוח קיים ב-Priority (${row.CUSTNAME})`, { customerId: c.id });
    this.queueDependents(c.id);
  }

  /** Once a customer exists in Priority, what waited for it goes out in the same queue. */
  queueDependents(customerId) {
    const cases = new Set(this.store.list('cases').filter((k) => k.customerId === customerId).map((k) => k.id));
    for (const ct of this.store.list('contacts')) if (ct.customerId === customerId) this.dirty.add(`contacts\u0000${ct.id}`);
    for (const q of this.store.list('quotes')) if (cases.has(q.caseId)) this.dirty.add(`quotes\u0000${q.id}`);
    for (const sc of this.store.list('serviceCalls')) if (sc.customerId === customerId) this.dirty.add(`serviceCalls\u0000${sc.id}`);
    if (this.dirty.size) void this.enqueue(() => this.pushDirty());
  }

  customerPid(customerId) {
    const c = customerId ? this.store.get('customers', customerId) : undefined;
    return c?.sync?.status === 'synced' || c?.sync?.priorityId ? c?.sync?.priorityId : undefined;
  }

  // ---- contacts

  async pushContact(ct, now) {
    const payload = M.contactOut(ct);
    const hash = M.hashOf(payload);
    const sync = ct.sync ?? {};
    if (sync.key && sync.hash === hash && sync.status === 'synced') return;
    if (!payload.NAME || !this.due(sync, now)) return;
    const custname = this.customerPid(ct.customerId);
    if (!custname) return this.holdPending('contacts', ct, 'ממתין לפתיחת הלקוח ב-Priority');
    if (!this.writeGate('contacts', ct)) return;
    if (sync.key) {
      await P.updateContact(this.client, custname, sync.key, payload);
      return this.synced('contacts', ct.id, 'sync', sync, { hash, key: { ...sync.key, NAME: payload.NAME } });
    }
    const list = await P.listContacts(this.client, custname);
    const digits = (s) => String(s ?? '').replace(/\D/g, '');
    let row = list.find((r) => String(r.NAME).trim() === payload.NAME || (digits(ct.phone) && [r.CELLPHONE, r.PHONENUM].some((p) => digits(p) === digits(ct.phone))));
    if (row) {
      await P.updateContact(this.client, custname, { NAME: row.NAME, FIRM: row.FIRM }, payload);
    } else {
      const key = await P.createContact(this.client, custname, payload);
      row = key.FIRM !== undefined ? key : (await P.listContacts(this.client, custname)).find((r) => String(r.NAME).trim() === payload.NAME);
    }
    this.synced('contacts', ct.id, 'sync', sync, { hash, key: row ? { NAME: payload.NAME, FIRM: row.FIRM } : undefined, priorityId: custname });
  }

  // ---- suppliers

  async pushSupplier(s, now) {
    const payload = M.supplierOut(s);
    const hash = M.hashOf(payload);
    const sync = s.sync ?? {};
    const pid = s.priorityId || sync.priorityId;
    if (pid && sync.hash === hash && sync.status === 'synced') return;
    if (s.active === false || !payload.SUPDES || !this.due(sync, now)) return;
    if (pid && !sync.hash) return this.patch('suppliers', s.id, { sync: { ...sync, priorityId: pid, status: 'synced', hash } });
    if (!this.writeGate('suppliers', s)) return;
    if (pid) {
      await P.updateSupplier(this.client, pid, payload);
      return this.synced('suppliers', s.id, 'sync', sync, { priorityId: pid, hash });
    }
    const found = await P.findSupplier(this.client, { vat: payload.VATNUM, name: payload.SUPDES });
    const supname = found ? String(found.SUPNAME) : await P.createSupplier(this.client, payload);
    if (!supname) throw new HttpError(502, 'priority_bad_response', 'Priority לא החזיר מספר ספק');
    this.patch('suppliers', s.id, { priorityId: supname });
    this.synced('suppliers', s.id, 'sync', sync, { priorityId: supname, hash });
    this.activity(`${found ? 'הספק קושר לספק קיים' : 'הספק נפתח'} ב-Priority: ${s.name} (${supname})`);
  }

  // ---- quotes -> CPROF, approved quotes -> ORDERS

  /** Priority's status tables (cached for an hour): which status means what in this installation. */
  async statuses() {
    if (this.statusCache && this.now() - this.statusCache.at < HOUR) return this.statusCache;
    const [cust, cprof] = await Promise.all([P.listCustomerStatuses(this.client), P.listQuoteStatuses(this.client)]);
    const y = (v) => v === 'Y';
    const pick = (list, ...tests) => tests.map((t) => list.find(t)).find(Boolean)?.STATDES;
    this.statusCache = {
      at: this.now(),
      // a customer that may have orders / service calls opened for it
      custFor: (flag) => pick(cust, (r) => y(r.ACTIVESTATFLAG) && y(r[flag]), (r) => y(r[flag]) && !y(r.TMPFLAG)),
      custAllows: (name, flag) => y(cust.find((r) => r.STATDES === name)?.[flag]),
      quoteApproved: pick(cprof, (r) => y(r.AFTERAPPFLAG) && y(r.OPENORDFLAG), (r) => y(r.OPENORDFLAG) && y(r.ACTIVEFLAG) && !y(r.INITSTATFLAG)),
      quoteRejected: pick(cprof, (r) => !y(r.ACTIVEFLAG) && !y(r.OPENORDFLAG) && !/cancel|בוטל/i.test(r.STATDES), (r) => !y(r.ACTIVEFLAG) && !y(r.OPENORDFLAG)),
      quoteEditable: (name) => !name || y(cprof.find((r) => r.STATDES === name)?.CHANGEFLAG),
    };
    return this.statusCache;
  }

  /**
   * New customers start in Priority as temporary / potential. Before an order or a service call is
   * opened for one, it is moved to the active status that allows it (PRIORITY_AUTO_ACTIVATE=off to leave that to the office).
   */
  async ensureCustomerAllows(custname, flag, ref = {}) {
    const st = await this.statuses();
    const cur = await P.customerStatus(this.client, custname);
    if (cur && st.custAllows(cur, flag)) return;
    if (!this.cfg.autoActivate) throw new HttpError(409, 'customer_not_active', `הלקוח ${custname} בסטטוס "${cur}" ב-Priority, שלא מאפשר את הפעולה. צריך להעביר אותו לסטטוס פעיל ב-Priority`);
    const to = st.custFor(flag);
    if (!to) return;
    try {
      await P.updateCustomer(this.client, custname, { STATDES: to });
    } catch (e) {
      // a temporary customer (number T...) can be made regular only by Priority's own action
      if (/לקוח\s*זמני|temporary/i.test(String(e?.details?.message ?? ''))) {
        throw new HttpError(409, 'customer_temporary', `הלקוח ${custname} הוא לקוח זמני ב-Priority. צריך להפוך אותו ללקוח רגיל ב-Priority (פעולה "הפיכת לקוח זמני ללקוח"), ואז זה ימשיך לבד`);
      }
      throw e;
    }
    this.activity(`הלקוח עבר ב-Priority מ"${cur}" ל"${to}"`, ref);
  }

  /** Sends document lines; if Priority refuses a line description, sends them again without descriptions. */
  async lenient(send, lines) {
    try {
      return await send(lines);
    } catch (e) {
      if (!M.descriptionRefused(e) || !lines.some((l) => l.PDES)) throw e;
      return send(M.withoutDescriptions(lines));
    }
  }

  quoteContext(q) {
    const k = this.store.get('cases', q.caseId);
    const custname = this.customerPid(k?.customerId);
    const catalog = new Map(this.store.list('catalog').map((i) => [i.id, i]));
    return { k, custname, agent: X.agentCode(this, k), lines: M.documentLines(q, catalog, this.cfg.genericPart) };
  }

  async pushQuote(q, now) {
    if (q.status === 'rejected') return this.closeQuote(q);
    if (!['sent', 'viewed', 'approved'].includes(q.status)) return;
    const { k, custname, agent, lines } = this.quoteContext(q);
    if (!k || !lines.length) return;
    const head = { ...M.quoteHead(q, custname, k.title), ...(agent ? { AGENTCODE: agent } : {}) };

    // the quote itself, while it is still open
    // once the order exists, the quote in Priority is history and is left alone
    if (this.on('quotes') && !(q.status === 'approved' && q.sync?.priorityId)) {
      const payload = { ...head, CPROFITEMS_SUBFORM: lines };
      const hash = M.hashOf(payload);
      const cprof = q.cprof ?? {};
      if (!(cprof.priorityId && cprof.hash === hash && cprof.status === 'synced') && this.due(cprof, now)) {
        if (!custname) this.holdPending('quotes', q, 'ממתין לפתיחת הלקוח ב-Priority', 'cprof');
        else if (this.writeGate('quotes', q, 'cprof')) {
          try {
            let num = cprof.priorityId;
            if (!num) num = (await P.findQuote(this.client, head.REFERENCE))?.CPROFNUM;
            if (num) {
              // lines can be replaced only while the quote is in a status that allows changes (Draft)
              if (!(await this.statuses()).quoteEditable(await P.quoteStatus(this.client, num))) {
                throw new HttpError(409, 'quote_locked', `ההצעה ${num} ב-Priority כבר לא בטיוטה, ולכן אי אפשר לעדכן בה שורות. שינוי נוסף צריך להיות גרסה חדשה של ההצעה`);
              }
              const { CUSTNAME: _c, ...rest } = head;
              await P.updateQuote(this.client, num, rest);
              await this.lenient((l) => P.replaceQuoteLines(this.client, num, l), lines);
            } else {
              num = await this.lenient((l) => P.createQuote(this.client, { ...head, CPROFITEMS_SUBFORM: l }), lines);
              this.activity(`הצעה ${q.number} נפתחה ב-Priority (${num})`, { caseId: q.caseId });
            }
            this.synced('quotes', q.id, 'cprof', cprof, { priorityId: String(num), hash });
          } catch (err) {
            if (fatal(err) || apiClosed(err)) throw err;
            this.markError('quotes', q, err, 'cprof');
          }
        }
      }
    }

    // the order, once: after that the order belongs to Priority (status, invoices)
    if (q.status !== 'approved' || !this.on('orders')) return;
    const sync = q.sync ?? {};
    if (sync.priorityId && sync.status === 'synced') return;
    if (!this.due(sync, now)) return;
    if (!custname) return this.holdPending('quotes', q, 'ממתין לפתיחת הלקוח ב-Priority');
    if (!this.writeGate('quotes', q)) return;
    let ordname = (await P.findOrder(this.client, head.REFERENCE))?.ORDNAME;
    if (!ordname) {
      await this.ensureCustomerAllows(custname, 'OPENORDFLAG', { caseId: q.caseId });
      const cprofNum = this.store.get('quotes', q.id)?.cprof?.priorityId;
      // the quote in Priority is marked approved, so the order can be based on it
      let linked = false;
      if (cprofNum) {
        const approved = (await this.statuses()).quoteApproved;
        try {
          if (approved && (await P.quoteStatus(this.client, cprofNum)) !== approved) await P.updateQuote(this.client, cprofNum, { STATDES: approved });
          linked = true;
        } catch (err) {
          if (fatal(err)) throw err;
        }
      }
      const send = (withQuote) => this.lenient((l) => P.createOrder(this.client, { ...head, ...(withQuote ? { CPROFNUM: cprofNum } : {}), ORDERITEMS_SUBFORM: l }), lines);
      try {
        ordname = await send(linked);
      } catch (err) {
        // the order still opens without the link, with the quote number as its reference
        if (!linked || fatal(err) || !/הצעת מחיר|CPROF/.test(String(err?.details?.message ?? ''))) throw err;
        ordname = await send(false);
      }
      if (!ordname) throw new HttpError(502, 'priority_bad_response', 'Priority לא החזיר מספר הזמנה');
      this.activity(`נפתחה הזמנה ב-Priority: ${ordname} (מהצעה ${q.number})`, { caseId: q.caseId });
    }
    this.synced('quotes', q.id, 'sync', sync, { priorityId: String(ordname) });
  }

  /** A quote the customer turned down is closed in Priority too (once). */
  async closeQuote(q) {
    const cprof = q.cprof ?? {};
    if (!cprof.priorityId || cprof.closed || !this.on('quotes') || !this.canWrite) return;
    const to = (await this.statuses()).quoteRejected;
    if (to) await P.updateQuote(this.client, cprof.priorityId, { STATDES: to });
    this.patch('quotes', q.id, { cprof: { ...cprof, closed: true } });
    this.activity(`הצעה ${q.number} סומנה ב-Priority כ"${to}"`, { caseId: q.caseId });
  }

  // ---- purchase orders

  async pushPurchaseOrder(po, now) {
    const sync = po.sync ?? {};
    if (sync.priorityId && sync.status === 'synced') return X.pushPurchaseFollowups(this, po);
    if (!['sent', 'confirmed', 'received'].includes(po.status)) return;
    if (!this.due(sync, now)) return;
    const sup = this.store.get('suppliers', po.supplierId);
    const supname = sup?.priorityId || sup?.sync?.priorityId;
    if (!supname) return this.holdPending('purchaseOrders', po, 'ממתין לפתיחת הספק ב-Priority');
    const catalog = new Map(this.store.list('catalog').map((i) => [i.id, i]));
    const lines = M.purchaseLines(po, catalog, this.cfg.genericPart);
    if (!lines.length) return;
    if (!this.writeGate('purchaseOrders', po)) return;
    const details = String(po.number).slice(0, M.LIMITS.DETAILS);
    let num = (await P.findPurchaseOrder(this.client, details))?.ORDNAME;
    if (!num) {
      num = await this.lenient((l) => P.createPurchaseOrder(this.client, { SUPNAME: supname, DETAILS: details, PORDERITEMS_SUBFORM: l }), lines);
      if (!num) throw new HttpError(502, 'priority_bad_response', 'Priority לא החזיר מספר הזמנת רכש');
      this.activity(`הזמנת רכש ${po.number} נפתחה ב-Priority (${num})`, po.caseId ? { caseId: po.caseId } : {});
    }
    this.synced('purchaseOrders', po.id, 'sync', sync, { priorityId: String(num) });
    await X.pushPurchaseFollowups(this, this.store.get('purchaseOrders', po.id));
  }

  // ---- service calls

  async pushServiceCall(sc, now) {
    const sync = sc.sync ?? {};
    if (sync.priorityId && sync.status === 'synced') return X.pushCallStatus(this, sc);
    if (sc.status === 'cancelled') return;
    if (!this.due(sync, now)) return;
    const custname = this.customerPid(sc.customerId);
    if (!custname) return this.holdPending('serviceCalls', sc, 'ממתין לפתיחת הלקוח ב-Priority');
    if (!this.writeGate('serviceCalls', sc)) return;
    const ref = String(sc.number).slice(0, M.LIMITS.REFERENCE);
    let docno = (await P.findServiceCall(this.client, ref))?.DOCNO;
    if (!docno) {
      await this.ensureCustomerAllows(custname, 'OPENSERVCALLFLAG', { serviceCallId: sc.id, customerId: sc.customerId });
      const unit = sc.unitId ? this.store.get('units', sc.unitId) : undefined;
      const cust = this.store.get('customers', sc.customerId);
      docno = await P.createServiceCall(this.client, {
        CUSTNAME: custname,
        REFERENCE: ref,
        ...(unit?.serial ? { SERNUM: String(unit.serial).slice(0, 20) } : {}),
        ...(cust?.phone ? { PHONENUM: String(cust.phone).slice(0, 20) } : {}),
        DOCTEXT_Q_SUBFORM: { TEXT: String(sc.description ?? '').slice(0, 2000) },
      });
      if (!docno) throw new HttpError(502, 'priority_bad_response', 'Priority לא החזיר מספר קריאה');
      this.activity(`קריאת שירות ${sc.number} נפתחה ב-Priority (${docno})`, { serviceCallId: sc.id, customerId: sc.customerId });
    }
    this.synced('serviceCalls', sc.id, 'sync', sync, { priorityId: String(docno) });
    await X.pushCallStatus(this, this.store.get('serviceCalls', sc.id));
  }

  // ------------------------------------------------------------ Priority -> app

  linkedCustomers() {
    const m = new Map();
    for (const c of this.store.list('customers')) if (c.sync?.priorityId) m.set(String(c.sync.priorityId), c);
    return m;
  }

  /** Changes to linked customers, and customers opened in Priority since the sync started. */
  async pullCustomers() {
    const linked = this.linkedCustomers();
    let updated = 0;
    let conflicts = 0;
    let imported = 0;
    const ids = [...linked.keys()];
    for (let i = 0; i < ids.length; i += 20) {
      const filter = ids.slice(i, i + 20).map((id) => `CUSTNAME eq '${id.replace(/'/g, "''")}'`).join(' or ');
      for (const row of await P.listCustomers(this.client, filter)) {
        const c = linked.get(String(row.CUSTNAME));
        if (!c) continue;
        const r = this.applyCustomerRow(c, row);
        if (r === 'updated') updated++;
        if (r === 'conflict') conflicts++;
      }
    }
    const mode = this.cfg.importCustomers;
    if (mode !== 'off') {
      const since = mode === 'all' ? '2000-01-01T00:00:00Z' : this.state().customersSince;
      if (since) {
        const fresh = await P.listCustomers(this.client, `CREATEDDATE ge ${P.odataDate(Date.parse(since) - DAY)}`);
        for (const row of fresh) if (!linked.has(String(row.CUSTNAME)) && this.importCustomer(row)) imported++;
      }
    }
    return { updated, conflicts, imported };
  }

  applyCustomerRow(c, row) {
    const remote = M.hashOf(M.customerRow(row));
    const sync = c.sync ?? {};
    if (remote === sync.remoteHash) return 'same';
    // no baseline yet (linked before the engine ran): Priority's details are taken as they are
    const localPending = Boolean(sync.hash) && M.hashOf(M.customerOut(c)) !== sync.hash;
    if (localPending) {
      // both sides changed: the app's edit is newer than what we last saw, so it goes out
      this.synced('customers', c.id, 'sync', sync, { remoteHash: remote, status: 'pending' });
      this.dirty.add(`customers\u0000${c.id}`);
      this.activity(`הלקוח שונה גם ב-Priority וגם במערכת. נשמרו הפרטים מהמערכת ונשלחו ל-Priority`, { customerId: c.id });
      return 'conflict';
    }
    const patch = M.customerIn(row, c);
    const merged = { ...c, ...patch };
    this.patch('customers', c.id, patch);
    this.synced('customers', c.id, 'sync', sync, { remoteHash: remote, hash: M.hashOf(M.customerOut(merged)) });
    const what = Object.keys(patch).map((f) => ({ name: 'שם', phone: 'טלפון', email: 'מייל', idNumber: 'ח״פ', addresses: 'כתובת' })[f]).filter(Boolean);
    if (what.length) this.activity(`עודכן מ-Priority: ${what.join(', ')}`, { customerId: c.id });
    return 'updated';
  }

  /** A customer opened in Priority. If the app already has one with the same phone, the two are linked. */
  importCustomer(row) {
    const r = M.customerRow(row);
    if (!r.CUSTDES) return false;
    const digits = (s) => String(s ?? '').replace(/\D/g, '');
    const twin = r.PHONE && this.store.list('customers').find((c) => !c.sync?.priorityId && digits(c.phone) === digits(r.PHONE));
    if (twin) {
      const patch = M.customerIn(row, twin);
      this.patch('customers', twin.id, { ...patch, temp: false });
      this.synced('customers', twin.id, 'sync', twin.sync ?? {}, { priorityId: String(row.CUSTNAME), remoteHash: M.hashOf(r), hash: M.hashOf(M.customerOut({ ...twin, ...patch })) });
      return true;
    }
    const id = `pc-${safeId(row.CUSTNAME)}`;
    if (this.store.get('customers', id)) return false;
    const base = { id, name: r.CUSTDES, type: r.VATNUM ? 'business' : 'private', phone: r.PHONE ?? '', addresses: [], createdAt: new Date(this.now()).toISOString(), tags: ['מ-Priority'] };
    const c = { ...base, ...M.customerIn(row, base) };
    this.write([{ op: 'upsert', collection: 'customers', id, data: { ...c, sync: { status: 'synced', priorityId: String(row.CUSTNAME), hash: M.hashOf(M.customerOut(c)), remoteHash: M.hashOf(r), lastSync: new Date(this.now()).toISOString() } } }]);
    this.activity(`לקוח חדש נוסף מ-Priority: ${c.name} (${row.CUSTNAME})`, { customerId: id });
    return true;
  }

  /** Order status, closed flag and total, onto the quote it came from. */
  async pullOrders(window) {
    const byOrder = new Map(this.store.list('quotes').filter((q) => q.sync?.priorityId).map((q) => [String(q.sync.priorityId), q]));
    if (!byOrder.size) return { updated: 0 };
    const since = Math.min(Date.parse(this.state().cursors?.orders ?? 0) || Infinity, this.now()) - window;
    let updated = 0;
    for (const row of await P.listOrdersChanged(this.client, Math.max(since, this.now() - 400 * DAY))) {
      const q = byOrder.get(String(row.ORDNAME));
      if (!q) continue;
      const info = M.orderIn(row);
      const hash = M.hashOf(info);
      if (q.priorityOrder?.hash === hash) continue;
      const before = q.priorityOrder?.status;
      this.patch('quotes', q.id, { priorityOrder: { ...info, hash, at: new Date(this.now()).toISOString() } });
      if (info.status && info.status !== before) this.activity(`הזמנה ${row.ORDNAME} ב-Priority: ${info.status}${info.closed ? ' (סגורה)' : ''}`, { caseId: q.caseId });
      updated++;
    }
    this.cursor('orders');
    return { updated };
  }

  cursor(name) {
    this.saveState({ cursors: { ...(this.state().cursors ?? {}), [name]: new Date(this.now()).toISOString() } });
  }

  /** The case a Priority document belongs to: by its order, else the customer's latest open case. */
  caseFor(row, byOrder, cust) {
    const q = row.ORDNAME ? byOrder.get(String(row.ORDNAME)) : undefined;
    if (q) return q.caseId;
    const cases = this.store.list('cases').filter((k) => k.customerId === cust.id);
    const open = cases.filter((k) => !['closed', 'lost'].includes(k.stage));
    const pick = (open.length ? open : cases).sort((a, b) => String(b.updatedAt ?? b.createdAt).localeCompare(String(a.updatedAt ?? a.createdAt)))[0];
    return pick?.id;
  }

  /** Final invoices and receipts of our customers become read-only lines in the case's money tab. */
  async pullMoney(forms, window) {
    const customers = this.linkedCustomers();
    if (!customers.size) return { added: 0 };
    const byOrder = new Map(this.store.list('quotes').filter((q) => q.sync?.priorityId).map((q) => [String(q.sync.priorityId), q]));
    const money = this.store.list('money');
    const known = new Set(money.filter((m) => m.priorityId).map((m) => `${m.kind}|${m.priorityId}`));
    let added = 0;
    let linked = 0;
    let unmatched = 0;
    for (const form of forms) {
      const since = this.now() - window;
      for (const row of await P.listFinalDocs(this.client, form, since)) {
        const cust = customers.get(String(row.CUSTNAME));
        if (!cust) continue;
        const caseId = this.caseFor(row, byOrder, cust);
        if (!caseId) {
          unmatched++;
          continue;
        }
        const kinds = form === 'TINVOICES' ? ['payment'] : form === 'EINVOICES' ? ['invoice', 'payment'] : ['invoice'];
        for (const kind of kinds) {
          if (known.has(`${kind}|${row.IVNUM}`)) continue;
          const line = M.moneyFromDoc(form, row, caseId, kind);
          known.add(`${kind}|${row.IVNUM}`);
          // a payment the office already typed in (or the portal deposit) is linked, not doubled
          const twin = kind === 'payment' && money.find((m) => m.kind === 'payment' && m.caseId === caseId && !m.priorityId && Math.abs(Number(m.amount) - line.amount) < 1 && Math.abs(Date.parse(m.at) - Date.parse(line.at)) <= 10 * DAY);
          if (twin) {
            twin.priorityId = line.priorityId;
            this.patch('money', twin.id, { priorityId: line.priorityId, priorityForm: form, source: 'priority', status: 'paid' });
            linked++;
            continue;
          }
          this.write([{ op: 'upsert', collection: 'money', id: line.id, data: line }]);
          if (kind === 'payment') this.activity(`התקבל תשלום ב-Priority: ₪${line.amount.toLocaleString('he-IL')} (${line.description})`, { caseId });
          added++;
        }
      }
    }
    this.cursor(forms.includes('TINVOICES') ? 'receipts' : 'invoices');
    return { added, linked, unmatched };
  }

  /** Prices of catalog items by SKU (and new items, with PRIORITY_IMPORT_ITEMS). */
  async pullItems(full) {
    const st = this.state();
    const since = full || !st.cursors?.items ? this.now() - 3650 * DAY : Date.parse(st.cursors.items) - 10 * MIN;
    const started = this.now();
    const bySku = new Map(this.store.list('catalog').filter((i) => i.sku).map((i) => [String(i.sku), i]));
    let updated = 0;
    let imported = 0;
    for (const row of await P.listItemsChanged(this.client, since)) {
      const sku = String(row.PARTNAME ?? '').trim();
      const price = Number(row.BASEPLPRICE) || Number(row.PRICE) || 0;
      const cost = Number(row.COST) || 0;
      const item = bySku.get(sku);
      if (item) {
        const patch = {};
        if (price > 0 && price !== item.price) patch.price = price;
        if (cost > 0 && cost !== item.cost) patch.cost = cost;
        if (!Object.keys(patch).length && item.sync?.status === 'synced') continue;
        this.patch('catalog', item.id, { ...patch, sync: { status: 'synced', priorityId: sku, lastSync: new Date(this.now()).toISOString() } });
        if (Object.keys(patch).length) updated++;
      } else if (this.cfg.importItems && sku && row.PARTDES) {
        const id = `pi-${safeId(sku)}`;
        if (this.store.get('catalog', id)) continue;
        this.write([{ op: 'upsert', collection: 'catalog', id, data: { id, sku, name: String(row.PARTDES).trim(), category: 'material', unit: String(row.UNITNAME || row.PUNITNAME || 'יח׳').trim(), price, cost, active: true, sync: { status: 'synced', priorityId: sku, lastSync: new Date(this.now()).toISOString() } } }]);
        imported++;
      }
    }
    this.saveState({ cursors: { ...(this.state().cursors ?? {}), items: new Date(started).toISOString() } });
    return { updated, imported };
  }

  /** Open balance (obligo) of each linked customer, shown on the customer and in the case. */
  async pullBalances() {
    const customers = this.linkedCustomers();
    if (!customers.size) return { updated: 0 };
    let updated = 0;
    for (const row of await P.listBalances(this.client)) {
      const c = customers.get(String(row.CUSTNAME));
      if (!c) continue;
      const bal = { obligo: Number(row.OBLIGO) || 0, invoices: Number(row.IV_DEBIT) || 0, account: Number(row.ACC_DEBIT) || 0, orders: Number(row.ORD_DEBIT) || 0 };
      const hash = M.hashOf(bal);
      if (c.balance?.hash === hash) continue;
      this.patch('customers', c.id, { balance: { ...bal, hash, at: new Date(this.now()).toISOString() } });
      updated++;
    }
    return { updated };
  }

  /** Stock per mapped warehouse (PRIORITY_WAREHOUSES): Priority's count wins. */
  async pullStock() {
    const map = this.cfg.warehouses;
    const names = [...new Set(Object.keys(map).map((k) => k.split(':')[0]))];
    if (!names.length) return { updated: 0, skipped: 'אין מיפוי מחסנים (PRIORITY_WAREHOUSES)' };
    // "Main" sums every bin of the warehouse; "Main:EAST" is that bin only
    const locationOf = (row) => map[`${row.WARHSNAME}:${String(row.LOCNAME ?? '').trim()}`] ?? map[row.WARHSNAME];
    const bySku = new Map(this.store.list('catalog').filter((i) => i.sku).map((i) => [String(i.sku), i]));
    const stock = this.store.list('stock');
    const totals = new Map();
    for (const row of await P.listStock(this.client, names)) {
      const item = bySku.get(String(row.PARTNAME ?? '').trim());
      const location = locationOf(row);
      if (!item || !location) continue;
      const key = `${item.id}\u0000${location}`;
      totals.set(key, { item, location, row, qty: (totals.get(key)?.qty ?? 0) + (Number(row.BALANCE) || 0) });
    }
    let updated = 0;
    for (const { item, location, row, qty } of totals.values()) {
      const cur = stock.find((s) => s.itemId === item.id && s.location === location);
      if (cur && cur.qty === qty) continue;
      if (cur) this.patch('stock', cur.id, { qty });
      else this.write([{ op: 'upsert', collection: 'stock', id: `ps-${safeId(item.id)}-${safeId(row.WARHSNAME)}`, data: { itemId: item.id, location, qty, min: 0 } }]);
      updated++;
    }
    return { updated };
  }

  // ------------------------------------------------------------ for the routes

  /** A webhook or the "sync now" button: pull these streams (or everything) right away. */
  trigger(kind = 'hot') {
    return this.run(kind);
  }

  status() {
    return { ...this.state(), queue: { dirty: this.dirty.size, waiting: [...this.queued] }, canWrite: this.canWrite };
  }
}
