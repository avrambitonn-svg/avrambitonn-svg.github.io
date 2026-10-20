// The Priority calls the sync engine makes, by meaning (find / create / update / list changes).
// Every function takes the raw OData client from priority.js ({ get, post, patch, del }).
// Field names come from Priority's $metadata - see PRIORITY_MAPPING.md.
import { buildQuery, escapeODataString } from '../priority.js';

const q = (v) => `'${escapeODataString(v)}'`;
const rows = (data) => (Array.isArray(data?.value) ? data.value : []);
const PAGE = 200;
const MAX_ROWS = 50_000;

/** Every row of a query, page by page. */
export async function all(client, form, params) {
  const out = [];
  for (let skip = 0; skip < MAX_ROWS; skip += PAGE) {
    const page = rows(await client.get(form, buildQuery({ ...params, $top: PAGE, $skip: skip })));
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}

/** OData date literal for $filter (Priority keeps most document dates at midnight UTC). */
export const odataDate = (iso) => new Date(iso).toISOString().replace(/\.\d{3}Z$/, 'Z');

// ---------------------------------------------------------------- customers and contacts

const CUSTOMER_FIELDS = 'CUSTNAME,CUSTDES,PHONE,EMAIL,ADDRESS,STATE,STATEA,VATNUM,CREATEDDATE';

export async function findCustomer(client, { phone, vat }) {
  const or = [];
  if (vat) or.push(`VATNUM eq ${q(vat)}`);
  if (phone) or.push(`PHONE eq ${q(phone)}`);
  if (!or.length) return [];
  return rows(await client.get('CUSTOMERS', buildQuery({ $select: CUSTOMER_FIELDS, $filter: or.join(' or '), $top: 3 })));
}

export async function createCustomer(client, payload) {
  const res = await client.post('CUSTOMERS', payload);
  return String(res?.CUSTNAME ?? '');
}

export const updateCustomer = (client, custname, payload) => client.patch(`CUSTOMERS(${q(custname)})`, payload);

export const listCustomers = (client, filter) => all(client, 'CUSTOMERS', { $select: CUSTOMER_FIELDS, $filter: filter });

export async function getCustomer(client, custname) {
  return rows(await client.get('CUSTOMERS', buildQuery({ $select: CUSTOMER_FIELDS, $filter: `CUSTNAME eq ${q(custname)}`, $top: 1 })))[0];
}

const CONTACT_FIELDS = 'NAME,FIRM,CELLPHONE,PHONENUM,EMAIL,POSITIONDES';
const contactsPath = (custname) => `CUSTOMERS(${q(custname)})/CUSTPERSONNEL_SUBFORM`;

export async function listContacts(client, custname) {
  return rows(await client.get(contactsPath(custname), buildQuery({ $select: CONTACT_FIELDS })));
}

export async function createContact(client, custname, payload) {
  const res = await client.post(contactsPath(custname), payload);
  return { NAME: String(res?.NAME ?? payload.NAME), FIRM: res?.FIRM };
}

export const updateContact = (client, custname, key, payload) =>
  client.patch(`${contactsPath(custname)}(NAME=${q(key.NAME)},FIRM=${Number(key.FIRM)})`, payload);

// ---------------------------------------------------------------- quotes and orders

export async function findQuote(client, reference) {
  return rows(await client.get('CPROF', buildQuery({ $select: 'CPROFNUM,STATDES', $filter: `REFERENCE eq ${q(reference)}`, $top: 1 })))[0];
}

export async function createQuote(client, payload) {
  const res = await client.post('CPROF', payload);
  return String(res?.CPROFNUM ?? '');
}

export const updateQuote = (client, num, head) => client.patch(`CPROF(${q(num)})`, head);

/** Lines can't be matched one to one, so an edited quote gets its lines replaced. */
export async function replaceQuoteLines(client, num, lines) {
  const path = `CPROF(${q(num)})/CPROFITEMS_SUBFORM`;
  const old = rows(await client.get(path, buildQuery({ $select: 'KLINE' })));
  for (const l of old) await client.del(`${path}(${Number(l.KLINE)})`);
  for (const l of lines) await client.post(path, l);
}

export async function findOrder(client, reference) {
  return rows(await client.get('ORDERS', buildQuery({ $select: 'ORDNAME,ORDSTATUSDES', $filter: `REFERENCE eq ${q(reference)}`, $top: 1 })))[0];
}

export async function createOrder(client, payload) {
  const res = await client.post('ORDERS', payload);
  return String(res?.ORDNAME ?? '');
}

export const listOrdersChanged = (client, since) =>
  all(client, 'ORDERS', {
    $select: 'ORDNAME,CUSTNAME,REFERENCE,ORDSTATUSDES,BOOLCLOSED,TOTPRICE,STATUSDATE',
    $filter: `STATUSDATE ge ${odataDate(since)}`,
  });

// ---------------------------------------------------------------- suppliers and purchase orders

const SUPPLIER_FIELDS = 'SUPNAME,SUPDES,PHONE,EMAIL,ADDRESS,VATNUM';

export async function findSupplier(client, { vat, name }) {
  const or = [];
  if (vat) or.push(`VATNUM eq ${q(vat)}`);
  if (name) or.push(`SUPDES eq ${q(name)}`);
  if (!or.length) return undefined;
  return rows(await client.get('SUPPLIERS', buildQuery({ $select: SUPPLIER_FIELDS, $filter: or.join(' or '), $top: 1 })))[0];
}

export async function createSupplier(client, payload) {
  const res = await client.post('SUPPLIERS', payload);
  return String(res?.SUPNAME ?? '');
}

export const updateSupplier = (client, supname, payload) => client.patch(`SUPPLIERS(${q(supname)})`, payload);

export async function findPurchaseOrder(client, details) {
  return rows(await client.get('PORDERS', buildQuery({ $select: 'ORDNAME,STATDES', $filter: `DETAILS eq ${q(details)}`, $top: 1 })))[0];
}

export async function createPurchaseOrder(client, payload) {
  const res = await client.post('PORDERS', payload);
  return String(res?.ORDNAME ?? '');
}

// ---------------------------------------------------------------- service calls

export async function findServiceCall(client, reference) {
  return rows(await client.get('DOCUMENTS_Q', buildQuery({ $select: 'DOCNO', $filter: `REFERENCE eq ${q(reference)}`, $top: 1 })))[0];
}

export async function createServiceCall(client, payload) {
  const res = await client.post('DOCUMENTS_Q', payload);
  return String(res?.DOCNO ?? '');
}

// ---------------------------------------------------------------- money (read only)

export const INVOICE_FORMS = ['AINVOICES', 'CINVOICES', 'EINVOICES'];

/** Final (issued) invoices / receipts from a date on. Drafts are not money yet. */
export const listFinalDocs = (client, form, since) =>
  all(client, form, {
    $select: 'IVNUM,CUSTNAME,IVDATE,ORDNAME,TOTPRICE,FINAL,DETAILS',
    $filter: `IVDATE ge ${odataDate(since)} and FINAL eq 'Y'`,
  });

export const listBalances = (client) => all(client, 'OBLIGO', { $select: 'CUSTNAME,OBLIGO,IV_DEBIT,ACC_DEBIT,ORD_DEBIT' });

// ---------------------------------------------------------------- items and stock

export const listItemsChanged = (client, since) =>
  all(client, 'LOGPART', {
    $select: 'PARTNAME,PARTDES,BASEPLPRICE,PRICE,COST,UNITNAME,PUNITNAME,STATDES,UDATE',
    $filter: `UDATE ge ${odataDate(since)}`,
  });

export function listStock(client, warehouses) {
  const filter = warehouses.map((w) => `WARHSNAME eq ${q(w)}`).join(' or ');
  return all(client, 'PARTBAL', { $select: 'PARTNAME,WARHSNAME,BALANCE', $filter: filter });
}
