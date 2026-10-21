// Customer-facing endpoints, no login: the personal portal (scoped by the case's portal token)
// and the public lead form. Each response carries only that case's data, and every write is
// built here on the server (the customer never sends entity data).
import { randomBytes } from 'node:crypto';
import { HttpError, clientIp, readJson } from './http.js';
import { createWindowLimiter } from './limiter.js';
import { requireStore } from './db/index.js';
import { filesDir, sendStoredFile, storeBuffer, storeUpload } from './files.js';
import { googleFeatures, jerusalemDate, uploadBufferToDrive } from './google.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const TOKEN_RE = /^[A-Za-z0-9]{12,64}$/;
const uid = (prefix) => `${prefix}${randomBytes(6).toString('hex')}`;
const nowIso = () => new Date().toISOString();
const today = () => jerusalemDate(nowIso());
const round2 = (n) => Math.round(n * 100) / 100;
export const firstName = (name) => {
  const clean = String(name ?? '').trim();
  return /^משפחת\s/.test(clean) ? clean : clean.split(/\s+/)[0] ?? '';
};

const limiters = {
  // every portal request, counted per address before the link is even looked up
  visit: createWindowLimiter({ max: 300, windowMs: 10 * 60_000 }),
  // links that matched no case: someone guessing
  miss: createWindowLimiter({ max: 20, windowMs: 10 * 60_000 }),
  read: createWindowLimiter({ max: 120, windowMs: 10 * 60_000 }),
  write: createWindowLimiter({ max: 30, windowMs: 10 * 60_000 }),
  message: createWindowLimiter({ max: 20, windowMs: 10 * 60_000 }),
  upload: createWindowLimiter({ max: 10, windowMs: 10 * 60_000 }),
  lead: createWindowLimiter({ max: 5, windowMs: 10 * 60_000 }),
  leadPhone: createWindowLimiter({ max: 3, windowMs: 60 * 60_000 }),
  // a ceiling for the whole form, counted only for valid leads, so junk requests cannot use it up
  leadGlobal: createWindowLimiter({ max: 1000, windowMs: 60 * 60_000 }),
};
export const resetPortalLimits = () => Object.values(limiters).forEach((l) => l.clear());

function limit(kind, key, { peek = false } = {}) {
  const v = peek ? limiters[kind].peek(key) : limiters[kind].hit(key);
  if (!v.allowed) {
    const e = new HttpError(429, 'too_many_requests', 'יותר מדי בקשות. נסו שוב בעוד כמה דקות');
    e.retryAfter = Math.ceil(v.retryAfterMs / 1000);
    throw e;
  }
}

const notFound = () => new HttpError(404, 'not_found', 'הקישור לא נמצא או שהאזור האישי נסגר');

// portal token -> case id, rebuilt only after the store changed (instead of scanning every case per request)
const tokenIndex = new WeakMap();
function caseIdByToken(store, token) {
  let idx = tokenIndex.get(store);
  if (!idx || idx.seq !== store.seq) {
    idx = { seq: store.seq, map: new Map() };
    for (const k of store.list('cases')) if (k.portal?.token) idx.map.set(k.portal.token, k.id);
    tokenIndex.set(store, idx);
  }
  return idx.map.get(token);
}

// a closed case keeps its link this long after closing (PORTAL_TTL_DAYS), so old links stop working on their own
const portalTtlMs = () => (Number(process.env.PORTAL_TTL_DAYS) > 0 ? Number(process.env.PORTAL_TTL_DAYS) : 365) * 86400_000;
function portalOpen(k) {
  if (!k?.portal?.token || k.portal.enabled === false) return false;
  if (k.portal.expiresAt && Date.parse(k.portal.expiresAt) < Date.now()) return false;
  if (k.stage === 'closed' || k.stage === 'lost') {
    const since = Date.parse(k.closedAt ?? k.updatedAt ?? '') || 0;
    if (since && Date.now() - since > portalTtlMs()) return false;
  }
  return true;
}

async function caseByToken(ctx) {
  const store = await requireStore(ctx.cfg);
  const ip = clientIp(ctx.req, ctx.cfg.db.trustProxy);
  limit('visit', ip);
  limit('miss', ip, { peek: true });
  const token = String(ctx.params.token ?? '');
  const k = TOKEN_RE.test(token) ? store.get('cases', caseIdByToken(store, token) ?? '') : undefined;
  if (!k || k.portal?.token !== token || !portalOpen(k)) {
    limiters.miss.hit(ip);
    throw notFound();
  }
  return { store, k, ip };
}

// ------------------------------------------------------------ server-side writes

function write(store, ops) {
  const at = Date.now();
  return store.applyOps(ops.map((o) => ({ ...o, at })), { clientId: 'server' });
}
const upsert = (collection, data) => ({ op: 'upsert', collection, id: data.id, data });
const patch = (collection, id, data) => ({ op: 'patch', collection, id, data });
const activity = (a) => upsert('activities', { id: uid('a'), at: nowIso(), ...a });
const notification = (userId, text, link) => upsert('notifications', { id: uid('n'), at: nowIso(), userId, text, link, read: false });
const managers = (store) => store.list('users').filter((u) => u.active !== false && (u.role === 'office' || u.role === 'admin'));

function stageLabel(store, key) {
  const fallback = { lead: 'ליד חדש', survey: 'סקר בשטח', quote: 'הצעת מחיר', approved: 'אושר', scheduled: 'מתואם להתקנה', installing: 'בהתקנה', completed: 'הותקן', closed: 'נסגר', lost: 'לא נסגר' };
  return store.get('config', 'org')?.caseStages?.find((s) => s.key === key)?.label ?? fallback[key] ?? key;
}

// ------------------------------------------------------------ portal view model

export function quoteTotals(q) {
  const subtotal = round2((q.lines ?? []).reduce((s, l) => s + round2((Number(l.qty) || 0) * (Number(l.unitPrice) || 0)), 0));
  const discount = round2((subtotal * (Number(q.discountPct) || 0)) / 100);
  const net = round2(subtotal - discount);
  const vat = round2((net * (Number(q.vatPct) || 0)) / 100);
  return { subtotal, discount, net, vat, total: round2(net + vat) };
}

function customerQuote(store, caseId) {
  const list = store.list('quotes').filter((q) => q.caseId === caseId && q.status !== 'draft');
  return list.find((q) => q.status === 'approved') ?? [...list].sort((a, b) => (b.version ?? 0) - (a.version ?? 0) || String(b.createdAt).localeCompare(String(a.createdAt)))[0];
}

const portalQuote = (q) =>
  q && {
    id: q.id, number: q.number, version: q.version, status: q.status, discountPct: q.discountPct, vatPct: q.vatPct, validUntil: q.validUntil, notes: q.notes, terms: q.terms,
    lines: (q.lines ?? []).map((l) => ({ id: l.id, description: l.description, qty: l.qty, unit: l.unit, unitPrice: l.unitPrice, room: l.room })),
    signature: q.signature && { name: q.signature.name, dataUrl: q.signature.dataUrl, at: q.signature.at },
    deposit: q.deposit, sentAt: q.sentAt, viewedAt: q.viewedAt, decidedAt: q.decidedAt, createdAt: q.createdAt,
  };

const visibleDoc = (d) => d.customerVisible === true || (d.customerVisible !== false && (d.folder === 'customer' || (d.folder === 'installer' && /מסירה|אחריות|הוראות/.test(d.name ?? ''))));

function caseDocs(store, k) {
  return store.list('docs').filter((d) => d.caseId === k.id && visibleDoc(d));
}

export function portalData(store, k) {
  const customer = store.get('customers', k.customerId);
  const contacts = store.list('contacts');
  const mine = contacts.filter((c) => (k.contactIds ?? []).includes(c.id));
  const contact = mine.find((c) => c.primary) ?? mine[0] ?? contacts.find((c) => c.customerId === k.customerId && c.primary);
  const users = new Map(store.list('users').map((u) => [u.id, u]));
  const agent = users.get(k.agentId);
  const address = customer?.addresses?.find((a) => a.id === k.addressId) ?? customer?.addresses?.[0];
  const since = jerusalemDate(new Date(Date.now() - 30 * 86400_000).toISOString());
  const appointments = store
    .list('appointments')
    .filter((a) => (a.caseId === k.id || (!a.caseId && a.customerId === k.customerId)) && a.status !== 'cancelled' && jerusalemDate(a.end ?? a.start) >= since)
    .sort((a, b) => String(a.start).localeCompare(String(b.start)))
    .map((a) => ({ id: a.id, type: a.type, start: a.start, end: a.end, allDay: a.allDay, status: a.status, team: (a.userIds ?? []).map((id) => firstName(users.get(id)?.name)).filter(Boolean) }));
  const units = store
    .list('units')
    .filter((u) => u.customerId === k.customerId && (u.caseId === k.id || u.addressId === k.addressId))
    .map((u) => ({ id: u.id, model: u.model, serial: u.serial, location: u.location, btu: u.btu, installedAt: u.installedAt, warrantyUntil: u.warrantyUntil, nextServiceAt: u.nextServiceAt, addressId: u.addressId }));
  const docs = caseDocs(store, k).map((d) => ({
    id: d.id, name: d.name, mime: d.mime, size: d.size, folder: d.folder, uploadedAt: d.uploadedAt, fromCustomer: d.source === 'portal',
    url: d.fileId ? `/api/portal/${k.portal.token}/files/${d.id}` : d.url ?? (d.dataUrl && d.dataUrl.length < 2_800_000 ? d.dataUrl : undefined),
  }));
  const messages = store
    .list('messages')
    .filter((m) => m.caseId === k.id && m.channel === 'portal')
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
    .slice(-100)
    .map((m) => ({ id: m.id, direction: m.direction, body: m.body, at: m.at, by: m.direction === 'out' ? firstName(users.get(m.by)?.name) : undefined }));
  const settings = store.get('settings', 'org') ?? {};
  return {
    case: { id: k.id, number: k.number, title: k.title, stage: k.stage, projectType: k.projectType, installWindow: k.installWindow, addressId: k.addressId, createdAt: k.createdAt },
    customer: { firstName: firstName(customer?.name), name: customer?.name, type: customer?.type },
    contact: contact ? { firstName: firstName(contact.name), name: contact.name } : null,
    address: address && { id: address.id, city: address.city, street: address.street, number: address.number, floor: address.floor, apartment: address.apartment, label: address.label },
    agent: agent ? { firstName: firstName(agent.name), name: agent.name, phone: agent.phone } : null,
    quote: portalQuote(customerQuote(store, k.id)) ?? null,
    appointments,
    units,
    docs,
    messages,
    settings: { depositPct: Number(settings.depositPct ?? 20) },
    serverTime: nowIso(),
  };
}

// ------------------------------------------------------------ routes

export async function getPortal(ctx) {
  const { store, k, ip } = await caseByToken(ctx);
  limit('read', ip);
  return { status: 200, body: portalData(store, k) };
}

/** A visit: "last viewed", one activity line per half hour, and the first look at a sent quote. */
export async function viewPortal(ctx) {
  const { store, k, ip } = await caseByToken(ctx);
  limit('write', `${ip}|${k.id}`);
  const ops = [];
  const last = Date.parse(k.portal?.lastViewedAt ?? '') || 0;
  if (Date.now() - last > 30 * 60_000) {
    ops.push(patch('cases', k.id, { portal: { ...k.portal, lastViewedAt: nowIso() } }));
    ops.push(activity({ kind: 'portal', caseId: k.id, customerId: k.customerId, text: 'הלקוח נכנס לאזור האישי' }));
  }
  const q = customerQuote(store, k.id);
  if (q && q.status === 'sent') {
    ops.push(patch('quotes', q.id, { status: 'viewed', viewedAt: nowIso() }));
    ops.push(activity({ kind: 'portal', caseId: k.id, text: `הלקוח צפה בהצעה ${q.number}` }));
    if (k.agentId) ops.push(notification(k.agentId, `הלקוח צפה בהצעה ${q.number}`, `/cases/${k.id}`));
  }
  if (ops.length) write(store, ops);
  return { status: 200, body: { ok: true } };
}

function openQuote(store, k, quoteId) {
  const q = store.get('quotes', String(quoteId ?? ''));
  if (!q || q.caseId !== k.id) throw new HttpError(404, 'not_found', 'ההצעה לא נמצאה');
  if (!['sent', 'viewed'].includes(q.status)) throw new HttpError(409, 'quote_closed', 'ההצעה כבר לא פתוחה לאישור');
  if (q.validUntil && q.validUntil < today()) throw new HttpError(409, 'quote_expired', 'תוקף ההצעה הסתיים');
  return q;
}

const SIG_RE = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
const DEPOSIT_METHODS = { credit: 'כרטיס אשראי', bit: 'ביט', transfer: 'העברה בנקאית' };

/** Signature + deposit method. The server sets the quote and case fields; a staff device finishes the rest once (approvedVia). */
export async function approveQuote(ctx) {
  const { store, k, ip } = await caseByToken(ctx);
  limit('write', `${ip}|${k.id}`);
  const body = await readJson(ctx.req);
  const q = openQuote(store, k, body.quoteId);
  const name = typeof body.signature?.name === 'string' ? body.signature.name.trim() : '';
  const dataUrl = body.signature?.dataUrl;
  const method = body.deposit?.method;
  const fields = [];
  if (name.length < 2 || name.length > 80) fields.push({ field: 'signature.name', message: 'צריך שם מלא' });
  if (typeof dataUrl !== 'string' || !SIG_RE.test(dataUrl) || dataUrl.length > 400_000) fields.push({ field: 'signature.dataUrl', message: 'חסרה חתימה' });
  if (!['credit', 'bit', 'transfer'].includes(method)) fields.push({ field: 'deposit.method', message: 'אמצעי תשלום לא תקין' });
  if (fields.length) throw new HttpError(400, 'validation_error', 'נתונים חסרים או שגויים', { fields });

  const at = nowIso();
  const settings = store.get('settings', 'org') ?? {};
  const total = quoteTotals(q).total;
  const amount = Math.round((total * Number(settings.depositPct ?? 20)) / 100);
  // There is no payment provider yet: the customer only chose how to pay. The deposit waits until the office
  // confirms the money arrived (no paidAt, no payment line), so nothing reports money that was never received.
  const deposit = { amount, method, status: 'pending' };
  const ops = [
    patch('quotes', q.id, { status: 'approved', signature: { name, dataUrl, at, ip }, deposit, decidedAt: at, approvedVia: 'portal', approvedFromStage: k.stage }),
    activity({ kind: 'quote', caseId: k.id, text: `הלקוח אישר וחתם על הצעה ${q.number} (${name})` }),
    activity({ kind: 'payment', caseId: k.id, text: `הלקוח בחר לשלם מקדמה של ₪${amount.toLocaleString('he-IL')} (${DEPOSIT_METHODS[method]}). ממתין לאימות התשלום` }),
  ];
  for (const other of store.list('quotes')) {
    if (other.caseId === k.id && other.id !== q.id && ['draft', 'sent', 'viewed'].includes(other.status)) ops.push(patch('quotes', other.id, { status: 'rejected' }));
  }
  if (k.stage !== 'approved') {
    ops.push(patch('cases', k.id, { stage: 'approved', updatedAt: at }));
    ops.push(activity({ kind: 'stage', caseId: k.id, text: `שלב: ${stageLabel(store, k.stage)} ← ${stageLabel(store, 'approved')}` }));
    if (k.agentId) ops.push(notification(k.agentId, `${k.title}: ${stageLabel(store, 'approved')}`, `/cases/${k.id}`));
  }
  for (const u of managers(store)) {
    ops.push(notification(u.id, `הצעה אושרה: ${k.title} — לתאם התקנה`, `/cases/${k.id}`));
    ops.push(notification(u.id, `לאמת את תשלום המקדמה (₪${amount.toLocaleString('he-IL')}, ${DEPOSIT_METHODS[method]}): ${k.title}`, `/cases/${k.id}`));
  }
  write(store, ops);
  return { status: 200, body: { ok: true, deposit, decidedAt: at } };
}

export async function rejectQuote(ctx) {
  const { store, k, ip } = await caseByToken(ctx);
  limit('write', `${ip}|${k.id}`);
  const body = await readJson(ctx.req);
  const q = openQuote(store, k, body.quoteId);
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
  const ops = [
    patch('quotes', q.id, { status: 'rejected', decidedAt: nowIso() }),
    activity({ kind: 'quote', caseId: k.id, text: `ההצעה ${q.number} נדחתה: מהאזור האישי${reason ? `: ${reason}` : ''}` }),
  ];
  if (k.agentId) ops.push(notification(k.agentId, `הלקוח דחה את ההצעה ${q.number}${reason ? `: ${reason}` : ''}`, `/cases/${k.id}`));
  write(store, ops);
  return { status: 200, body: { ok: true } };
}

const SYMPTOMS = { not_cooling: 'לא מקרר / לא מחמם', leak: 'נזילת מים', noise: 'רעש חריג', error_code: 'קוד שגיאה', no_power: 'לא נדלק', remote: 'שלט', smell: 'ריח', other: 'משהו אחר' };

export async function serviceRequest(ctx) {
  const { store, k, ip } = await caseByToken(ctx);
  limit('write', `${ip}|${k.id}`);
  const body = await readJson(ctx.req);
  const symptom = body.symptom ? String(body.symptom) : undefined;
  if (symptom && !SYMPTOMS[symptom]) throw new HttpError(400, 'validation_error', 'סוג התקלה לא תקין', { fields: [{ field: 'symptom' }] });
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, 2000) : '';
  if (!symptom && text.length < 3) throw new HttpError(400, 'validation_error', 'ספרו לנו בקצרה מה קרה', { fields: [{ field: 'text' }] });
  const unit = body.unitId ? store.get('units', String(body.unitId)) : undefined;
  if (body.unitId && (!unit || unit.customerId !== k.customerId)) throw new HttpError(400, 'validation_error', 'המזגן לא נמצא', { fields: [{ field: 'unitId' }] });
  const contract = store.list('contracts').find((c) => c.customerId === k.customerId && c.status !== 'cancelled' && c.status !== 'expired' && (!unit || (c.unitIds ?? []).includes(unit.id)));
  const { from } = store.reserve('service', 1);
  const code = symptom === 'error_code' && typeof body.errorCode === 'string' && body.errorCode.trim() ? body.errorCode.trim().slice(0, 20).toUpperCase() : undefined;
  const sc = {
    id: uid('sc'),
    number: `SC-${String(from).padStart(4, '0')}`,
    customerId: k.customerId,
    addressId: unit?.addressId ?? k.addressId,
    unitId: unit?.id,
    contractId: contract?.id,
    description: [SYMPTOMS[symptom], text].filter(Boolean).join(': ') + (unit?.location ? ` (${unit.location})` : ''),
    symptom,
    errorCode: code,
    urgency: symptom === 'leak' || symptom === 'no_power' ? 'high' : 'normal',
    status: 'new',
    underWarranty: unit ? unit.warrantyUntil >= today() : undefined,
    source: 'portal',
    createdAt: nowIso(),
  };
  for (const key of Object.keys(sc)) if (sc[key] === undefined) delete sc[key];
  const customer = store.get('customers', k.customerId);
  write(store, [
    upsert('serviceCalls', sc),
    activity({ kind: 'service', serviceCallId: sc.id, customerId: k.customerId, caseId: k.id, text: `קריאת שירות ${sc.number} נפתחה מהאזור האישי` }),
    ...managers(store).map((u) => notification(u.id, `קריאת שירות מהאזור האישי: ${customer?.name ?? k.title}`, `/service/${sc.id}`)),
  ]);
  return { status: 201, body: { number: sc.number, underWarranty: sc.underWarranty ?? null } };
}

/** A photo or PDF from the customer: stored, filed under the case's "customer" folder, staff notified. */
export async function uploadFromPortal(ctx) {
  const { store, k, ip } = await caseByToken(ctx);
  limit('upload', `${ip}|${k.id}`);
  const mime = String(ctx.req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (!/^image\/(jpeg|png|webp|heic|heif|gif)$/.test(mime) && mime !== 'application/pdf') {
    throw new HttpError(415, 'unsupported_type', 'אפשר להעלות תמונה או PDF');
  }
  const meta = await storeUpload(ctx.req, ctx.cfg, { maxBytes: Math.min(ctx.cfg.db.filesMaxBytes, 10 * 1024 * 1024), meta: { caseId: k.id, folder: 'customer', source: 'portal' } });
  const doc = { id: uid('d'), caseId: k.id, customerId: k.customerId, folder: 'customer', name: meta.name, mime: meta.mime, size: meta.size, fileId: meta.id, uploadedAt: nowIso(), source: 'portal', customerVisible: true };
  const driveFolder = k.driveFolders?.customer;
  if (driveFolder && googleFeatures(ctx.cfg).drive) {
    try {
      const d = await uploadBufferToDrive(ctx.cfg, { name: meta.name, mime: meta.mime, data: await readFile(join(filesDir(ctx.cfg), meta.id)), folderId: driveFolder });
      doc.driveFileId = d.id;
      doc.webViewLink = d.webViewLink;
    } catch {
      /* the file is safe on the server; Drive can be retried from the app */
    }
  }
  const to = k.agentId ? [k.agentId] : managers(store).map((u) => u.id);
  write(store, [
    upsert('docs', doc),
    activity({ kind: 'document', caseId: k.id, customerId: k.customerId, text: `הלקוח העלה קובץ מהאזור האישי: ${meta.name}` }),
    ...to.map((id) => notification(id, `קובץ חדש מהלקוח: ${meta.name}`, `/cases/${k.id}`)),
  ]);
  return { status: 201, body: { id: doc.id, name: doc.name, size: doc.size, url: `/api/portal/${k.portal.token}/files/${doc.id}` } };
}

/** Chat from the customer: Message { channel: 'portal', direction: 'in' }. Staff answer with direction 'out'. */
export async function postMessage(ctx) {
  const { store, k, ip } = await caseByToken(ctx);
  limit('message', `${ip}|${k.id}`);
  const body = await readJson(ctx.req);
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!text || text.length > 2000) throw new HttpError(400, 'validation_error', 'ההודעה ריקה או ארוכה מדי', { fields: [{ field: 'body' }] });
  const msg = { id: uid('m'), caseId: k.id, customerId: k.customerId, channel: 'portal', direction: 'in', body: text, at: nowIso(), status: 'delivered' };
  const customer = store.get('customers', k.customerId);
  const to = k.agentId ? [k.agentId] : managers(store).map((u) => u.id);
  write(store, [upsert('messages', msg), ...to.map((id) => notification(id, `הודעה מ${customer?.name ?? 'הלקוח'}: ${text.slice(0, 60)}`, `/cases/${k.id}`))]);
  return { status: 201, body: { id: msg.id, at: msg.at } };
}

export async function portalFile(ctx) {
  const { store, k, ip } = await caseByToken(ctx);
  limit('read', ip);
  const doc = caseDocs(store, k).find((d) => d.id === ctx.params.docId);
  if (!doc?.fileId) throw new HttpError(404, 'not_found', 'הקובץ לא נמצא');
  return sendStoredFile(ctx.res, ctx.cfg, doc.fileId, { download: ctx.url.searchParams.get('download') === '1' });
}

// ------------------------------------------------------------ public lead form

const TITLES = {
  replacement: 'החלפת מזגן', apartment: 'מיזוג דירה', luxury: 'מיזוג בית פרטי', commercial: 'מיזוג לעסק', institution: 'מיזוג מבנה ציבור',
  residential_building: 'בנייה רוויה', underfloor_heating: 'חימום תת-רצפתי', smoke_ventilation: 'מערכת שחרור עשן', other: 'פנייה כללית',
};
const customerTypeOf = (t) => (t === 'commercial' ? 'business' : t === 'institution' ? 'institution' : t === 'residential_building' ? 'developer' : 'private');
const SOURCES = ['website', 'facebook', 'whatsapp'];
const PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

export function normalizePhone(p) {
  let d = String(p ?? '').replace(/\D/g, '');
  if (d.startsWith('972')) d = `0${d.slice(3)}`;
  return /^05\d{8}$/.test(d) || /^0[2-9]\d{7}$/.test(d) || /^07\d{8}$/.test(d) ? d : null;
}

function portalToken(len = 18) {
  const abc = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(randomBytes(len), (b) => abc[b % abc.length]).join('');
}

/** POST /api/public/leads - customer + contact + case, like the form does in the demo. Honeypot field: website. */
export async function createLead(ctx) {
  const store = await requireStore(ctx.cfg);
  const ip = clientIp(ctx.req, ctx.cfg.db.trustProxy);
  limit('lead', ip);
  limit('leadGlobal', 'all', { peek: true });
  const body = await readJson(ctx.req);
  if (typeof body.website === 'string' && body.website.trim()) return { status: 201, body: { ok: true, number: null, portalToken: null } };
  const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
  const phone = normalizePhone(body.phone);
  const cfgTypes = (store.get('config', 'org')?.projectTypes ?? []).filter((t) => t.active !== false).map((t) => t.key);
  const type = typeof body.type === 'string' && (TITLES[body.type] || cfgTypes.includes(body.type)) ? body.type : null;
  const city = typeof body.city === 'string' ? body.city.trim().slice(0, 60) : '';
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, 2000) : '';
  const photos = Array.isArray(body.photos) ? body.photos : [];
  const fields = [];
  if (name.length < 2 || name.length > 80) fields.push({ field: 'name', message: 'איך קוראים לכם?' });
  if (!phone) fields.push({ field: 'phone', message: 'צריך מספר טלפון תקין' });
  if (!type) fields.push({ field: 'type', message: 'בחרו את סוג הפרויקט' });
  if (photos.length > 6 || photos.some((p) => typeof p !== 'string' || !PHOTO_RE.test(p) || p.length > 2_000_000)) fields.push({ field: 'photos', message: 'עד 6 תמונות' });
  if (fields.length) throw new HttpError(400, 'validation_error', 'נתונים חסרים או שגויים', { fields });
  limit('leadPhone', phone);
  limit('leadGlobal', 'all');

  const source = SOURCES.includes(body.source) ? body.source : 'website';
  const at = nowIso();
  const addressId = uid('ad');
  // Anyone can send the form with any phone number, so this customer is not trusted yet: it is not sent to
  // Priority (where it could be matched by phone to a real customer, whose details would then flow back into
  // this case and its portal) until someone in the office has looked at it and cleared pendingReview.
  const customer = {
    id: uid('c'), name, type: customerTypeOf(type), phone, addresses: [{ id: addressId, city: city || 'לא צוין', street: '' }], tags: ['פנייה מהאתר'], temp: true,
    pendingReview: true, sync: { status: 'pending', error: 'פנייה מהאתר: ממתין לאישור במשרד' }, createdAt: at,
  };
  const contact = { id: uid('ct'), customerId: customer.id, name, phone, primary: true };
  const numbering = store.get('config', 'org')?.caseNumbering ?? {};
  const { from } = store.reserve('case', 1);
  const yy = today().slice(2, 4);
  const number = `${numbering.prefix ?? 'GN-'}${yy}${String(from).padStart(Number(numbering.pad) || 4, '0')}`;
  const title = `${TITLES[type] ?? 'פנייה כללית'} — ${name}${city ? `, ${city}` : ''}`;
  const k = {
    id: uid('k'), number, title, customerId: customer.id, contactIds: [contact.id], addressId, projectType: type, stage: 'lead', source, priority: 'normal', tags: [], installerIds: [],
    notes: text ? `מהטופס: "${text}"` : undefined,
    survey: { rooms: [], photos: [] },
    portal: { token: portalToken(), enabled: true }, createdAt: at, updatedAt: at, createdVia: 'lead',
  };
  if (!k.notes) delete k.notes;
  // the photos go to the file store and the case's "customer" folder, not into the database itself
  const docs = [];
  for (const [i, dataUrl] of photos.entries()) {
    const [, mime, b64] = /^data:(image\/[a-z]+);base64,(.+)$/.exec(dataUrl);
    const name = `תמונה מהלקוח ${i + 1}.${mime === 'image/jpeg' ? 'jpg' : mime.slice(6)}`;
    const meta = await storeBuffer(ctx.cfg, Buffer.from(b64, 'base64'), { name, mime, meta: { caseId: k.id, folder: 'customer', source: 'lead' } });
    docs.push({ id: uid('d'), caseId: k.id, customerId: customer.id, folder: 'customer', name: meta.name, mime: meta.mime, size: meta.size, fileId: meta.id, uploadedAt: at, source: 'portal', customerVisible: true });
  }
  const sourceLabel = { website: 'אתר', facebook: 'פייסבוק / אינסטגרם', whatsapp: 'וואטסאפ' }[source];
  const users = store.list('users').filter((u) => u.active !== false);
  write(store, [
    upsert('customers', customer),
    upsert('contacts', contact),
    upsert('cases', k),
    ...docs.map((d) => upsert('docs', d)),
    activity({ kind: 'created', caseId: k.id, text: `התיק נפתח (${number})` }),
    activity({ kind: 'created', caseId: k.id, customerId: customer.id, text: `ליד חדש מטופס "השאירו פרטים" (${sourceLabel})${photos.length ? `, ${photos.length} תמונות` : ''}` }),
    ...users.filter((u) => u.role === 'admin').map((u) => notification(u.id, `תיק חדש: ${title}`, `/cases/${k.id}`)),
    ...users.filter((u) => u.role === 'office').map((u) => notification(u.id, `ליד חדש מהאתר: ${name}${city ? `, ${city}` : ''}`, `/cases/${k.id}`)),
  ]);
  return { status: 201, body: { ok: true, number, portalToken: k.portal.token } };
}
