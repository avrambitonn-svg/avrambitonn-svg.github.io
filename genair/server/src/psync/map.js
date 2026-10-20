// App entity <-> Priority row, plus the hashes that tell which side changed.
// hash       = the payload we last sent (or would send) for the app's current state
// remoteHash = the Priority row as we last saw it
// A record needs a push when its payload hash differs from sync.hash; a Priority change is
// one whose row hash differs from sync.remoteHash.
import { createHash } from 'node:crypto';

// Max lengths from $metadata. Longer values are cut here: a sync that fails forever over
// one long name is worse than a shortened name in Priority (the full text stays in the app).
export const LIMITS = {
  CUSTDES: 48, PHONE: 20, EMAIL: 68, ADDRESS: 80, STATE: 40, VATNUM: 16, DETAILS: 24, REFERENCE: 25, PARTNAME: 22, PDES: 59,
  NAME: 50, CELLPHONE: 20, POSITIONDES: 32, SUPDES: 48,
};

const cut = (v, n) => {
  const s = String(v ?? '').trim();
  return s.length > n ? s.slice(0, n) : s;
};

/** Drops empty fields so "" in the app never wipes a value in Priority. */
function clean(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== '') out[k] = v;
  return out;
}

function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

export const hashOf = (v) => createHash('sha1').update(stable(v)).digest('hex').slice(0, 16);

/** The same fields picked from a Priority row, normalized like a payload. */
export function pick(row, keys) {
  const out = {};
  for (const k of keys) {
    const v = row?.[k];
    if (v !== undefined && v !== null && v !== '') out[k] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}

// ---------------------------------------------------------------- customers

export const addressLine = (a) =>
  a ? [[a.street, a.number].filter(Boolean).join(' '), a.floor ? `קומה ${a.floor}` : '', a.apartment ? `דירה ${a.apartment}` : ''].filter(Boolean).join(', ') : '';

export const CUSTOMER_KEYS = ['CUSTDES', 'PHONE', 'EMAIL', 'ADDRESS', 'STATE', 'VATNUM'];

export function customerOut(c) {
  const a = c.addresses?.[0];
  return clean({
    CUSTDES: cut(c.name, LIMITS.CUSTDES),
    PHONE: cut(c.phone, LIMITS.PHONE),
    EMAIL: cut(c.email, LIMITS.EMAIL),
    ADDRESS: cut(addressLine(a), LIMITS.ADDRESS),
    STATE: cut(a?.city, LIMITS.STATE),
    VATNUM: cut(c.idNumber, LIMITS.VATNUM),
  });
}

/** Priority's row as a remote hash (STATEA = city in some installs, STATE in others). */
export const customerRow = (row) => pick({ ...row, STATE: row?.STATE || row?.STATEA }, CUSTOMER_KEYS);

/** The app fields a Priority customer row sets. Address is replaced only when Priority's text changed. */
export function customerIn(row, current) {
  const r = customerRow(row);
  const patch = {};
  if (r.CUSTDES && r.CUSTDES !== cut(current?.name, LIMITS.CUSTDES)) patch.name = r.CUSTDES;
  if (r.PHONE && r.PHONE !== current?.phone) patch.phone = r.PHONE;
  if ((r.EMAIL ?? '') !== (current?.email ?? '') && r.EMAIL) patch.email = r.EMAIL;
  if (r.VATNUM && r.VATNUM !== current?.idNumber) patch.idNumber = r.VATNUM;
  const a = current?.addresses?.[0];
  if ((r.ADDRESS && r.ADDRESS !== cut(addressLine(a), LIMITS.ADDRESS)) || (r.STATE && r.STATE !== (a?.city ?? ''))) {
    const next = { ...(a ?? { id: `ad-p${Date.now().toString(36)}` }), street: r.ADDRESS ?? a?.street ?? '', city: r.STATE ?? a?.city ?? '' };
    if (r.ADDRESS) {
      delete next.number;
      delete next.floor;
      delete next.apartment;
    }
    patch.addresses = [next, ...(current?.addresses ?? []).slice(1)];
  }
  return patch;
}

// ---------------------------------------------------------------- contacts

export const CONTACT_KEYS = ['NAME', 'CELLPHONE', 'EMAIL', 'POSITIONDES'];

export const contactOut = (c) =>
  clean({ NAME: cut(c.name, LIMITS.NAME), CELLPHONE: cut(c.phone, LIMITS.CELLPHONE), EMAIL: cut(c.email, LIMITS.EMAIL), POSITIONDES: cut(c.role, LIMITS.POSITIONDES) });

// ---------------------------------------------------------------- quotes and orders

/**
 * Quote lines as Priority document lines. A catalog item goes out by its SKU only: Priority refuses a
 * different description unless the part allows it. Lines without a catalog item go out under the
 * generic part with their own description.
 */
export function documentLines(q, catalog, genericPart) {
  const factor = 1 - (Number(q.discountPct) || 0) / 100;
  return (q.lines ?? [])
    .filter((l) => Number(l.qty) > 0)
    .map((l) => {
      const item = l.itemId ? catalog.get(l.itemId) : undefined;
      return clean({
        PARTNAME: cut(item?.sku || genericPart, LIMITS.PARTNAME),
        TQUANT: Number(l.qty),
        PRICE: Math.round(Number(l.unitPrice) * factor * 100) / 100,
        PDES: item?.sku ? undefined : cut(l.description, LIMITS.PDES),
      });
    });
}

/** The same lines without descriptions, for parts that don't allow changing theirs. */
export const withoutDescriptions = (lines) => lines.map(({ PDES: _d, ...rest }) => rest);

/** Priority refused a line description ("אין לשנות תאור מוצר..."). */
export const descriptionRefused = (e) => /תאור מוצר|PDES|part description/i.test(String(e?.details?.message ?? e?.message ?? ''));

export const quoteHead = (q, custname, title) => clean({ CUSTNAME: custname, REFERENCE: cut(q.number, LIMITS.REFERENCE), DETAILS: cut(title || q.number, LIMITS.DETAILS) });

export function orderIn(row) {
  return clean({
    number: row.ORDNAME,
    status: typeof row.ORDSTATUSDES === 'string' ? row.ORDSTATUSDES.trim() : undefined,
    closed: row.BOOLCLOSED === 'Y',
    total: Number(row.TOTPRICE) || 0,
    statusAt: row.STATUSDATE,
  });
}

// ---------------------------------------------------------------- suppliers and purchase orders

export const SUPPLIER_KEYS = ['SUPDES', 'PHONE', 'EMAIL', 'ADDRESS', 'VATNUM'];

export const supplierOut = (s) =>
  clean({
    SUPDES: cut(s.name, LIMITS.SUPDES),
    PHONE: cut(s.phone, LIMITS.PHONE),
    EMAIL: cut(s.email, LIMITS.EMAIL),
    ADDRESS: cut(s.address, LIMITS.ADDRESS),
    VATNUM: cut(s.vatNum, LIMITS.VATNUM),
  });

export function purchaseLines(po, catalog, genericPart) {
  return (po.lines ?? [])
    .filter((l) => Number(l.qty) > 0)
    .map((l) => {
      const item = l.itemId ? catalog.get(l.itemId) : undefined;
      return clean({ PARTNAME: cut(item?.sku || genericPart, LIMITS.PARTNAME), TQUANT: Number(l.qty), PRICE: Number(l.unitCost) || 0, PDES: item?.sku ? undefined : cut(l.description, LIMITS.PDES) });
    });
}

// ---------------------------------------------------------------- money from Priority

const FORM_LABEL = { AINVOICES: 'חשבונית מס', CINVOICES: 'חשבונית מרכזת', EINVOICES: 'חשבונית מס קבלה', TINVOICES: 'קבלה' };

/** A final Priority document as a read-only money line in the case. */
export function moneyFromDoc(form, row, caseId, kind) {
  const day = String(row.IVDATE ?? '').slice(0, 10);
  return {
    id: `pv-${kind === 'payment' ? 'p' : 'i'}-${String(row.IVNUM).replace(/[^A-Za-z0-9_.:-]/g, '_')}`,
    caseId,
    kind,
    category: FORM_LABEL[form] ?? 'Priority',
    description: `${FORM_LABEL[form] ?? form} ${row.IVNUM}${row.DETAILS ? ` · ${String(row.DETAILS).trim()}` : ''}`,
    amount: Math.round((Number(row.TOTPRICE) || 0) * 100) / 100,
    at: day,
    ...(kind === 'payment' ? { status: 'paid' } : {}),
    source: 'priority',
    priorityId: String(row.IVNUM),
    priorityForm: form,
  };
}
