// The rest of what has a counterpart in Priority: agents, extra addresses, files, installed units
// (serial numbers), service call status, stock movements, goods receipts, supplier invoices,
// customer notes, and contacts edited in Priority. Each function gets the engine (`e`) and works
// like the pushes and pulls in engine.js: idempotent, with sync state on the record.
import { HttpError } from '../http.js';
import * as P from './api.js';
import * as M from './map.js';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const cut = (v, n) => String(v ?? '').trim().slice(0, n);
const safeId = (s) => String(s).replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 100);
const dayIso = (d) => `${String(d ?? new Date().toISOString()).slice(0, 10)}T00:00:00Z`;
const y = (v) => v === 'Y';
const pick = (list, ...tests) => tests.map((t) => list.find(t)).find(Boolean);

/** PRIORITY_WAREHOUSES "Main=מחסן ראשי,Main:EAST=רכב — רון": location in the app -> warehouse (+ bin) in Priority. */
export function warehouseOf(e, location) {
  for (const [code, loc] of Object.entries(e.cfg.warehouses)) {
    if (loc !== location) continue;
    const [warhs, bin] = code.split(':');
    return { WARHSNAME: warhs, LOCNAME: bin || '0' };
  }
  return null;
}

// ------------------------------------------------------------ agents (users with the agent role)

export async function pushAgent(e, u, now) {
  if (u.role !== 'agent' || u.active === false) return;
  const sync = u.agentSync ?? {};
  if (u.priorityAgent && sync.status === 'synced') return;
  if (!e.due(sync, now)) return;
  if (!e.writeGate('users', u, 'agentSync')) return;
  const name = cut(u.name, 32);
  const existing = (await P.listAgents(e.client)).find((a) => String(a.AGENTNAME ?? '').trim() === name);
  let code = existing?.AGENTCODE;
  if (!code) {
    const base = cut(String(u.initials || '').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'GN', 6);
    code = await P.createAgent(e.client, { AGENTCODE: `${base}${String(e.store.reserve('priorityAgent', 1).from).padStart(3, '0')}`.slice(0, 16), AGENTNAME: name, ...(u.email ? { EMAIL: cut(u.email, 68) } : {}), ...(u.phone ? { CELLPHONE: cut(u.phone, 20) } : {}) });
    e.activity(`הסוכן ${u.name} נוסף ב-Priority (${code})`);
  }
  e.patch('users', u.id, { priorityAgent: String(code) });
  e.synced('users', u.id, 'agentSync', sync, { priorityId: String(code) });
}

/** The case's agent as a Priority agent code, when linked. */
export function agentCode(e, k) {
  const u = k?.agentId ? e.store.get('users', k.agentId) : undefined;
  return u?.priorityAgent;
}

// ------------------------------------------------------------ extra addresses -> customer sites

export const siteOut = (a, i) => ({
  CODEDES: cut(a.label || `${a.street ?? ''} ${a.number ?? ''}`.trim() || `אתר ${i + 2}`, 48),
  ADDRESS: cut(M.addressLine(a), 80),
  STATE: cut(a.city, 40),
});

export async function pushSites(e, c, custname) {
  if (!e.on('addresses')) return;
  const extra = (c.addresses ?? []).slice(1);
  if (!extra.length) return;
  const hash = M.hashOf(extra.map(siteOut));
  if (c.sync?.sitesHash === hash) return;
  const codes = { ...(c.addressCodes ?? {}) };
  const taken = new Set((await P.listSites(e.client, custname)).map((s) => String(s.CODE)));
  for (const [i, a] of extra.entries()) {
    const payload = siteOut(a, i);
    if (codes[a.id] && taken.has(codes[a.id])) {
      await P.updateSite(e.client, custname, codes[a.id], payload);
      continue;
    }
    let n = 1;
    while (taken.has(String(n).padStart(2, '0'))) n++;
    const code = String(n).padStart(2, '0');
    await P.createSite(e.client, custname, { CODE: code, ...payload });
    taken.add(code);
    codes[a.id] = code;
  }
  const cur = e.store.get('customers', c.id);
  e.patch('customers', c.id, { addressCodes: codes, sync: { ...(cur?.sync ?? {}), sitesHash: hash } });
}

// ------------------------------------------------------------ files

/** Where a document goes in Priority: its supplier, or the customer of its case. */
function fileTarget(e, d) {
  if (d.supplierId) {
    const s = e.store.get('suppliers', d.supplierId);
    const id = s?.priorityId || s?.sync?.priorityId;
    return id ? { path: P.FILE_TARGETS.supplier(id), what: 'הספק' } : null;
  }
  const k = d.caseId ? e.store.get('cases', d.caseId) : undefined;
  const id = e.customerPid(d.customerId ?? k?.customerId);
  return id ? { path: P.FILE_TARGETS.customer(id), what: 'הלקוח', k } : null;
}

export async function pushDoc(e, d, now) {
  const sync = d.sync ?? {};
  if (sync.status === 'synced' || sync.status === 'disabled' || !e.due(sync, now)) return;
  if (!d.dataUrl && !d.fileId) return; // a Drive-only link has no bytes here
  // a doc may point only at a file uploaded for its own case (checked on write too, see permissions.js)
  if (d.fileId && e.readFileMeta) {
    const meta = await e.readFileMeta(d.fileId);
    if (!meta || (meta.caseId && meta.caseId !== d.caseId)) {
      return e.patch('docs', d.id, { sync: { ...sync, status: 'disabled', error: 'הקובץ לא שייך לתיק הזה, ולכן לא נשלח ל-Priority' } });
    }
  }
  const target = fileTarget(e, d);
  if (!target) return e.holdPending('docs', d, 'ממתין לפתיחת הלקוח או הספק ב-Priority');
  if (!e.writeGate('docs', d)) return;
  const max = e.cfg.filesMaxMb * 1024 * 1024;
  let data = d.dataUrl;
  if (!data) {
    const buf = await e.readFile?.(d.fileId);
    if (!buf) return e.markError('docs', d, new Error('הקובץ לא נמצא בשרת'));
    if (buf.length > max) return e.patch('docs', d.id, { sync: { ...sync, status: 'disabled', error: `גדול מ-${e.cfg.filesMaxMb}MB, לא נשלח ל-Priority` } });
    data = `data:${d.mime || 'application/octet-stream'};base64,${buf.toString('base64')}`;
  } else if (data.length * 0.75 > max) {
    return e.patch('docs', d.id, { sync: { ...sync, status: 'disabled', error: `גדול מ-${e.cfg.filesMaxMb}MB, לא נשלח ל-Priority` } });
  }
  const desc = cut(`${target.k?.number ? `${target.k.number} · ` : ''}${d.name}`, 68);
  const found = (await P.listFiles(e.client, target.path)).find((f) => String(f.EXTFILEDES ?? '').trim() === desc);
  const res = found ?? (await P.attachFile(e.client, target.path, { EXTFILEDES: desc, EXTFILENAME: data }));
  e.synced('docs', d.id, 'sync', sync, { priorityId: String(res?.EXTFILENUM ?? '') });
}

// ------------------------------------------------------------ installed units -> serial numbers

export async function pushUnit(e, u, now) {
  const sync = u.sync ?? {};
  if (sync.status === 'synced' || !e.due(sync, now) || !u.serial) return;
  const custname = e.customerPid(u.customerId);
  if (!custname) return e.holdPending('units', u, 'ממתין לפתיחת הלקוח ב-Priority');
  const item = u.itemId ? e.store.get('catalog', u.itemId) : undefined;
  if (!item?.sku) return e.holdPending('units', u, 'לדגם אין מק״ט בקטלוג, ולכן אי אפשר לפתוח לו מספר סידורי ב-Priority');
  if (!e.writeGate('units', u)) return;
  const sernum = cut(u.serial, 30);
  const partname = cut(item.sku, 22);
  if (!(await P.findSerial(e.client, sernum, partname))) {
    await P.createSerial(e.client, { SERNUM: sernum, PARTNAME: partname, CUSTNAME: custname, ...(u.installedAt ? { INSTDATE: dayIso(u.installedAt) } : {}), ...(u.location ? { LOCATION: cut(u.location, 20) } : {}) });
    e.activity(`מספר סידורי ${sernum} נפתח ב-Priority`, { customerId: u.customerId, ...(u.caseId ? { caseId: u.caseId } : {}) });
  }
  e.synced('units', u.id, 'sync', sync, { priorityId: `${partname}|${sernum}` });
}

/** Warranty end and service dates set in Priority come back to the unit. */
export async function pullUnits(e) {
  const linked = new Map(e.store.list('units').filter((u) => u.sync?.priorityId).map((u) => [u.sync.priorityId, u]));
  if (!linked.size) return { updated: 0 };
  const st = e.state();
  const started = e.now();
  const since = st.cursors?.units ? Date.parse(st.cursors.units) - 10 * MIN : e.now() - 30 * DAY;
  let updated = 0;
  for (const row of await P.listSerialsChanged(e.client, since)) {
    const u = linked.get(`${String(row.PARTNAME).trim()}|${String(row.SERNUM).trim()}`);
    if (!u) continue;
    const d = (v) => (v ? String(v).slice(0, 10) : undefined);
    const patch = {};
    if (d(row.WARDATEFINAL) && d(row.WARDATEFINAL) !== u.warrantyUntil) patch.warrantyUntil = d(row.WARDATEFINAL);
    if (d(row.NEXTMAINTDATE) && d(row.NEXTMAINTDATE) !== u.nextServiceAt) patch.nextServiceAt = d(row.NEXTMAINTDATE);
    if (d(row.LASTMAINTDATE) && d(row.LASTMAINTDATE) !== u.lastServiceAt) patch.lastServiceAt = d(row.LASTMAINTDATE);
    if (!Object.keys(patch).length) continue;
    e.patch('units', u.id, patch);
    updated++;
  }
  e.saveState({ cursors: { ...(e.state().cursors ?? {}), units: new Date(started).toISOString() } });
  return { updated };
}

// ------------------------------------------------------------ service call status (both ways)

async function callStatuses(e) {
  if (e.callCache && e.now() - e.callCache.at < 60 * MIN) return e.callCache;
  const list = await P.listCallStatuses(e.client);
  e.callCache = {
    at: e.now(),
    done: pick(list, (r) => y(r.FINAL) && !y(r.CANCEL))?.CODE,
    cancelled: pick(list, (r) => y(r.CANCEL))?.CODE,
    isDone: (code) => y(list.find((r) => r.CODE === code)?.FINAL) && !y(list.find((r) => r.CODE === code)?.CANCEL),
    isCancelled: (code) => y(list.find((r) => r.CODE === code)?.CANCEL),
  };
  return e.callCache;
}

/** A call closed or cancelled in the app is closed in Priority, with what was done (DETAILS) first. */
export async function pushCallStatus(e, sc) {
  const docno = sc.sync?.priorityId;
  if (!docno || !['done', 'cancelled'].includes(sc.status) || !e.canWrite) return;
  const st = await callStatuses(e);
  const code = sc.status === 'done' ? st.done : st.cancelled;
  if (!code || sc.priorityStatus === code) return;
  if (sc.status === 'done' && sc.resolution) await P.updateServiceCall(e.client, docno, { DETAILS: cut(sc.resolution, 24) });
  await P.updateServiceCall(e.client, docno, { CALLSTATUSCODE: code });
  e.patch('serviceCalls', sc.id, { priorityStatus: code });
  e.activity(`קריאה ${sc.number} ב-Priority: ${code}`, { serviceCallId: sc.id, customerId: sc.customerId });
}

/** A call closed (or cancelled) in Priority closes here too. */
export async function pullServiceCalls(e, window) {
  const byDoc = new Map(e.store.list('serviceCalls').filter((s) => s.sync?.priorityId).map((s) => [String(s.sync.priorityId), s]));
  if (!byDoc.size) return { updated: 0 };
  const st = await callStatuses(e);
  let updated = 0;
  for (const row of await P.listServiceCallsChanged(e.client, e.now() - window)) {
    const sc = byDoc.get(String(row.DOCNO));
    const code = String(row.CALLSTATUSCODE ?? '').trim();
    if (!sc || !code || code === sc.priorityStatus) continue;
    const patch = { priorityStatus: code };
    const open = !['done', 'cancelled'].includes(sc.status);
    if (open && st.isDone(code)) Object.assign(patch, { status: 'done', closedAt: new Date(e.now()).toISOString() });
    if (open && st.isCancelled(code)) patch.status = 'cancelled';
    e.patch('serviceCalls', sc.id, patch);
    e.activity(`קריאה ${sc.number}: הסטטוס ב-Priority "${code}"${patch.status ? ' (נסגרה גם במערכת)' : ''}`, { serviceCallId: sc.id, customerId: sc.customerId });
    updated++;
  }
  return { updated };
}

// ------------------------------------------------------------ stock movements -> stock documents

const GRACE = 2 * MIN; // a part taken by mistake and put back within two minutes never reaches Priority

export async function pushStockMove(e, m, now) {
  const sync = m.sync ?? {};
  if (sync.status === 'synced' || sync.status === 'disabled' || !e.due(sync, now)) return;
  if (m.kind === 'receive') return; // goes up as the goods receipt of its purchase order
  if (m.kind === 'return') return netReturn(e, m);
  if (e.now() - Date.parse(m.at) < GRACE) return;
  const item = e.store.get('catalog', m.itemId);
  if (!item?.sku) return e.holdPending('stockMoves', m, 'לפריט אין מק״ט');
  const from = warehouseOf(e, m.from);
  if (!from) return e.holdPending('stockMoves', m, `המיקום "${m.from}" לא ממופה למחסן ב-Priority (PRIORITY_WAREHOUSES)`);

  // what was put back for the same job and item cancels out
  const returns = e.store.list('stockMoves').filter((r) => r.kind === 'return' && r.itemId === m.itemId && r.to === m.from && !r.sync?.status && (r.serviceCallId ?? r.appointmentId) === (m.serviceCallId ?? m.appointmentId) && r.at >= m.at);
  let qty = m.qty;
  for (const r of returns) {
    const take = Math.min(qty, r.qty);
    qty -= take;
    e.patch('stockMoves', r.id, { sync: { status: 'disabled', error: 'קוזז מול הוצאה מאותה עבודה' } });
    if (!qty) break;
  }
  if (!qty) return e.patch('stockMoves', m.id, { sync: { ...sync, status: 'disabled', error: 'הוחזר במלואו לפני שנשלח' } });

  let type;
  let head;
  if (m.kind === 'transfer') {
    const to = warehouseOf(e, m.to);
    if (!to) return e.holdPending('stockMoves', m, `המיקום "${m.to}" לא ממופה למחסן ב-Priority (PRIORITY_WAREHOUSES)`);
    type = 'T';
    head = { WARHSNAME: from.WARHSNAME, LOCNAME: from.LOCNAME, TOWARHSNAME: to.WARHSNAME, TOLOCNAME: to.LOCNAME };
  } else {
    const k = m.caseId ? e.store.get('cases', m.caseId) : undefined;
    const custname = e.customerPid(m.customerId ?? k?.customerId);
    if (!custname) return e.holdPending('stockMoves', m, 'ממתין לפתיחת הלקוח ב-Priority');
    type = 'D';
    head = { CUSTNAME: custname, WARHSNAME: from.WARHSNAME, LOCNAME: from.LOCNAME };
  }
  if (!e.writeGate('stockMoves', m)) return;
  const details = cut(`SM ${m.id}`, 24);
  let docno = (await P.findStockDoc(e.client, type, details))?.DOCNO;
  if (!docno) {
    docno = await P.createStockDoc(e.client, type, { CURDATE: dayIso(m.at), DETAILS: details, ...head, [P.STOCK_DOCS[type].lines]: [{ PARTNAME: cut(item.sku, 22), TQUANT: qty }] });
    if (!docno) throw new HttpError(502, 'priority_bad_response', 'Priority לא החזיר מספר תעודה');
    await P.setStockDocStatus(e.client, type, docno, await P.finalStatus(e.client, type));
    e.activity(`${type === 'T' ? 'העברה בין מחסנים' : 'משלוח חלקים ללקוח'} ב-Priority: ${docno} (${item.name} × ${qty})`, m.caseId ? { caseId: m.caseId } : m.serviceCallId ? { serviceCallId: m.serviceCallId } : {});
  }
  e.synced('stockMoves', m.id, 'sync', sync, { priorityId: docno, ...(qty !== m.qty ? { netQty: qty } : {}) });
}

/** A return after its part already went to Priority needs a return document there; it is flagged for the office. */
export function netReturn(e, m) {
  const used = e.store.list('stockMoves').find((u) => u.kind === 'use' && u.itemId === m.itemId && u.from === m.to && (u.serviceCallId ?? u.appointmentId) === (m.serviceCallId ?? m.appointmentId) && u.at <= m.at);
  if (used?.sync?.status === 'synced') e.holdPending('stockMoves', m, `החלק כבר נרשם כמשלוח ללקוח ב-Priority (${used.sync.priorityId}). את ההחזרה רושמים שם`);
}

// ------------------------------------------------------------ purchase orders: status and goods receipt

async function purchaseStatuses(e) {
  if (e.poCache && e.now() - e.poCache.at < 60 * MIN) return e.poCache;
  const list = await P.listPurchaseStatuses(e.client);
  e.poCache = {
    at: e.now(),
    approved: pick(list, (r) => y(r.APPROVED) && y(r.OPENDOCFLAG) && y(r.AFTERAPPFLAG), (r) => y(r.APPROVED) && y(r.OPENDOCFLAG))?.STATDES,
    cancelled: pick(list, (r) => y(r.CLOSEDBOOL) && !y(r.CLOSESTATFLAG))?.STATDES,
  };
  return e.poCache;
}

/** After the order exists: approved when sent, cancelled when cancelled, and a goods receipt when received. */
export async function pushPurchaseFollowups(e, po) {
  const ordname = po.sync?.priorityId;
  if (!ordname || !e.canWrite) return;
  const st = await purchaseStatuses(e);
  const want = po.status === 'cancelled' ? st.cancelled : st.approved;
  if (want && po.priorityStatus !== want) {
    await P.updatePurchaseOrder(e.client, ordname, { STATDES: want });
    e.patch('purchaseOrders', po.id, { priorityStatus: want });
  }
  if (po.status !== 'received' || po.receipt?.status === 'synced') return;
  const to = warehouseOf(e, po.toLocation) ?? (Object.keys(e.cfg.warehouses).length ? null : { WARHSNAME: 'Main', LOCNAME: '0' });
  if (!to) return e.holdPending('purchaseOrders', po, `המיקום "${po.toLocation}" לא ממופה למחסן ב-Priority`, 'receipt');
  const catalog = new Map(e.store.list('catalog').map((i) => [i.id, i]));
  const lines = M.purchaseLines(po, catalog, e.cfg.genericPart).map(({ PARTNAME, TQUANT }) => ({ PARTNAME, TQUANT, ORDNAME: ordname }));
  const sup = e.store.get('suppliers', po.supplierId);
  const details = cut(`GR ${po.number}`, 24);
  let docno = (await P.findStockDoc(e.client, 'P', details))?.DOCNO;
  if (!docno) {
    docno = await P.createStockDoc(e.client, 'P', { SUPNAME: sup?.priorityId || sup?.sync?.priorityId, CURDATE: dayIso(po.receivedAt), TOWARHSNAME: to.WARHSNAME, TOLOCNAME: to.LOCNAME, DETAILS: details, TRANSORDER_P_SUBFORM: lines });
    if (!docno) throw new HttpError(502, 'priority_bad_response', 'Priority לא החזיר מספר קבלה');
    await P.setStockDocStatus(e.client, 'P', docno, await P.finalStatus(e.client, 'P'));
    e.activity(`קבלת סחורה ב-Priority: ${docno} (הזמנה ${po.number})`, po.caseId ? { caseId: po.caseId } : {});
  }
  e.synced('purchaseOrders', po.id, 'receipt', po.receipt ?? {}, { priorityId: docno });
}

/** Status of our purchase orders as Priority has it. */
export async function pullPurchaseOrders(e) {
  const ours = e.store.list('purchaseOrders').filter((p) => p.sync?.priorityId);
  let updated = 0;
  for (let i = 0; i < ours.length; i += 20) {
    const batch = ours.slice(i, i + 20);
    const filter = batch.map((p) => `ORDNAME eq '${String(p.sync.priorityId).replace(/'/g, "''")}'`).join(' or ');
    for (const row of await P.listPurchaseOrders(e.client, filter)) {
      const po = batch.find((p) => p.sync.priorityId === row.ORDNAME);
      const status = String(row.STATDES ?? '').trim();
      if (!po || !status || status === po.priorityStatus) continue;
      e.patch('purchaseOrders', po.id, { priorityStatus: status });
      updated++;
    }
  }
  return { updated };
}

/** Final supplier invoices for our purchase orders become expenses in the order's case. */
export async function pullSupplierInvoices(e, window) {
  const byOrder = new Map(e.store.list('purchaseOrders').filter((p) => p.sync?.priorityId).map((p) => [String(p.sync.priorityId), p]));
  if (!byOrder.size) return { added: 0 };
  const money = e.store.list('money');
  const known = new Set(money.filter((m) => m.priorityId).map((m) => `${m.kind}|${m.priorityId}`));
  let added = 0;
  let linked = 0;
  for (const form of P.SUPPLIER_INVOICE_FORMS) {
    for (const row of await P.listFinalSupplierDocs(e.client, form, e.now() - window)) {
      const po = row.ORDNAME ? byOrder.get(String(row.ORDNAME)) : undefined;
      if (!po?.caseId || known.has(`expense|${row.IVNUM}`)) continue;
      known.add(`expense|${row.IVNUM}`);
      const amount = Math.round((Number(row.TOTPRICE) || 0) * 100) / 100;
      const twin = po.moneyLineId && money.find((m) => m.id === po.moneyLineId && !m.priorityId);
      if (twin) {
        e.patch('money', twin.id, { priorityId: String(row.IVNUM), priorityForm: form, source: 'priority', amount });
        linked++;
        continue;
      }
      const id = `pv-e-${safeId(row.IVNUM)}`;
      e.write([{ op: 'upsert', collection: 'money', id, data: { id, caseId: po.caseId, kind: 'expense', category: 'חשבונית ספק', description: `חשבונית ספק ${row.IVNUM} · הזמנה ${po.number}`, amount, at: String(row.IVDATE ?? '').slice(0, 10), supplierId: po.supplierId, purchaseOrderId: po.id, source: 'priority', priorityId: String(row.IVNUM), priorityForm: form } }]);
      added++;
    }
  }
  return { added, linked };
}

// ------------------------------------------------------------ notes -> customer activities

/** Notes written in a case after the sync started go to the customer's activities in Priority. */
export async function pushNote(e, a, now) {
  if (a.kind !== 'note' || a.sync?.status === 'synced' || !e.due(a.sync, now)) return;
  const since = e.state().customersSince;
  if (since && a.at < since) return;
  const k = a.caseId ? e.store.get('cases', a.caseId) : undefined;
  const custname = e.customerPid(a.customerId ?? k?.customerId);
  if (!custname) return;
  if (!e.writeGate('activities', a)) return;
  await P.createCustomerNote(e.client, custname, { SUBJECT: cut(`${k?.number ? `${k.number}: ` : ''}${a.text}`, 52), CURDATE: dayIso(a.at) });
  e.synced('activities', a.id, 'sync', a.sync ?? {}, { priorityId: custname });
}

// ------------------------------------------------------------ contacts edited or added in Priority

/** Contacts of linked customers, a batch per round: edits in Priority update the app, new ones are added. */
export async function pullContacts(e) {
  const linked = [...e.linkedCustomers().entries()];
  if (!linked.length) return { updated: 0, added: 0 };
  const start = e.state().cursors?.contactsAt ?? 0;
  const batch = linked.slice(start, start + 50);
  const next = start + 50 >= linked.length ? 0 : start + 50;
  let updated = 0;
  let added = 0;
  const all = e.store.list('contacts');
  for (const [custname, c] of batch) {
    for (const row of await P.listContacts(e.client, custname)) {
      const name = String(row.NAME ?? '').trim();
      if (!name) continue;
      const remote = M.hashOf(M.pick(row, M.CONTACT_KEYS));
      const ct = all.find((x) => x.customerId === c.id && (x.sync?.key?.NAME === name || x.name === name));
      const fields = { name, phone: String(row.CELLPHONE || row.PHONENUM || '').trim(), email: row.EMAIL ? String(row.EMAIL).trim() : undefined, role: row.POSITIONDES ? String(row.POSITIONDES).trim() : undefined };
      if (!ct) {
        const id = `pct-${safeId(custname)}-${safeId(name)}`.slice(0, 120);
        if (e.store.get('contacts', id)) continue;
        e.write([{ op: 'upsert', collection: 'contacts', id, data: { id, customerId: c.id, ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v)), sync: { status: 'synced', key: { NAME: name, FIRM: row.FIRM }, priorityId: custname, remoteHash: remote, hash: M.hashOf(M.contactOut(fields)) } } }]);
        added++;
        continue;
      }
      const sync = ct.sync ?? {};
      if (sync.remoteHash === remote) continue;
      const localPending = Boolean(sync.hash) && M.hashOf(M.contactOut(ct)) !== sync.hash;
      if (localPending) {
        e.synced('contacts', ct.id, 'sync', sync, { remoteHash: remote });
        continue;
      }
      const patch = Object.fromEntries(Object.entries(fields).filter(([k, v]) => v && v !== ct[k]));
      if (Object.keys(patch).length) e.patch('contacts', ct.id, patch);
      e.synced('contacts', ct.id, 'sync', sync, { remoteHash: remote, key: { NAME: name, FIRM: row.FIRM }, hash: M.hashOf(M.contactOut({ ...ct, ...patch })) });
      if (Object.keys(patch).length) updated++;
    }
  }
  e.saveState({ cursors: { ...(e.state().cursors ?? {}), contactsAt: next } });
  return { updated, added };
}
