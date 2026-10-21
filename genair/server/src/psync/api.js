// The Priority calls the sync engine makes, by meaning (find / create / update / list changes).
// Every function takes the raw OData client from priority.js ({ get, post, patch, del }).
// Field names come from Priority's $metadata - see PRIORITY_MAPPING.md.
import { buildQuery, escapeODataString } from '../priority.js';

const q = (v) => `'${escapeODataString(v)}'`; // inside $filter (buildQuery encodes the whole expression)
// Inside a URL path every reserved character of the value is percent-encoded, so a name with "/", "?", "#" or "%" cannot
// change which resource is addressed (the apostrophe stays literal: that is how OData quotes a key).
const qp = (v) => `'${encodeURIComponent(escapeODataString(v)).replace(/[()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}'`;
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

export const updateCustomer = (client, custname, payload) => client.patch(`CUSTOMERS(${qp(custname)})`, payload);

export const listCustomers = (client, filter) => all(client, 'CUSTOMERS', { $select: CUSTOMER_FIELDS, $filter: filter });

export async function getCustomer(client, custname) {
  return rows(await client.get('CUSTOMERS', buildQuery({ $select: CUSTOMER_FIELDS, $filter: `CUSTNAME eq ${q(custname)}`, $top: 1 })))[0];
}

const CONTACT_FIELDS = 'NAME,FIRM,CELLPHONE,PHONENUM,EMAIL,POSITIONDES';
const contactsPath = (custname) => `CUSTOMERS(${qp(custname)})/CUSTPERSONNEL_SUBFORM`;

export async function listContacts(client, custname) {
  return rows(await client.get(contactsPath(custname), buildQuery({ $select: CONTACT_FIELDS })));
}

export async function createContact(client, custname, payload) {
  const res = await client.post(contactsPath(custname), payload);
  return { NAME: String(res?.NAME ?? payload.NAME), FIRM: res?.FIRM };
}

// FIRM is the customer's name (a string) in CUSTPERSONNEL's key, checked against the demo
const firmKey = (f) => (typeof f === 'number' ? String(f) : qp(f));
export const updateContact = (client, custname, key, payload) =>
  client.patch(`${contactsPath(custname)}(NAME=${qp(key.NAME)},FIRM=${firmKey(key.FIRM)})`, payload);

// ---------------------------------------------------------------- statuses
// Every installation names its statuses differently; their meaning is in flags (checked in the demo):
// CUSTSTATS: ACTIVESTATFLAG, TMPFLAG, OPENORDFLAG, OPENSERVCALLFLAG
// CPROFSTATS: INITSTATFLAG, CHANGEFLAG (lines editable), ACTIVEFLAG, AFTERAPPFLAG (approved), OPENORDFLAG

export const listCustomerStatuses = (client) => all(client, 'CUSTSTATS', { $select: 'STATDES,INITSTATFLAG,TMPFLAG,ACTIVESTATFLAG,OPENORDFLAG,OPENSERVCALLFLAG' });
export const listQuoteStatuses = (client) => all(client, 'CPROFSTATS', { $select: 'STATDES,INITSTATFLAG,CHANGEFLAG,ACTIVEFLAG,AFTERAPPFLAG,OPENORDFLAG,TOAPPROVECPROF' });

export async function customerStatus(client, custname) {
  return rows(await client.get('CUSTOMERS', buildQuery({ $select: 'STATDES', $filter: `CUSTNAME eq ${q(custname)}`, $top: 1 })))[0]?.STATDES;
}

export async function quoteStatus(client, num) {
  return rows(await client.get('CPROF', buildQuery({ $select: 'STATDES', $filter: `CPROFNUM eq ${q(num)}`, $top: 1 })))[0]?.STATDES;
}

// ---------------------------------------------------------------- quotes and orders

export async function findQuote(client, reference) {
  return rows(await client.get('CPROF', buildQuery({ $select: 'CPROFNUM,STATDES', $filter: `REFERENCE eq ${q(reference)}`, $top: 1 })))[0];
}

export async function createQuote(client, payload) {
  const res = await client.post('CPROF', payload);
  return String(res?.CPROFNUM ?? '');
}

export const updateQuote = (client, num, head) => client.patch(`CPROF(${qp(num)})`, head);

/** Lines can't be matched one to one, so an edited quote gets its lines replaced. */
export async function replaceQuoteLines(client, num, lines) {
  const path = `CPROF(${qp(num)})/CPROFITEMS_SUBFORM`;
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

export const updateSupplier = (client, supname, payload) => client.patch(`SUPPLIERS(${qp(supname)})`, payload);

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

// ---------------------------------------------------------------- attachments
// Customers keep files in CUSTEXTFILE_SUBFORM, suppliers in SUPEXTFILE_SUBFORM (EXTFILES_SUBFORM on a
// customer is closed to the API in the demo). The file goes up inline as a data: URI in EXTFILENAME.

export const FILE_TARGETS = {
  customer: (id) => `CUSTOMERS(${qp(id)})/CUSTEXTFILE_SUBFORM`,
  supplier: (id) => `SUPPLIERS(${qp(id)})/SUPEXTFILE_SUBFORM`,
};

export async function listFiles(client, path) {
  return rows(await client.get(path, buildQuery({ $select: 'EXTFILEDES,EXTFILENUM' })));
}

export const attachFile = (client, path, payload) => client.post(path, payload);

// ---------------------------------------------------------------- serial numbers (installed units)

const SERIAL_FIELDS = 'SERNUM,PARTNAME,CUSTNAME,INSTDATE,WARDATEFINAL,LASTMAINTDATE,NEXTMAINTDATE,LOCATION,UDATE';

export async function findSerial(client, sernum, partname) {
  return rows(await client.get('SERNUMBERS', buildQuery({ $select: SERIAL_FIELDS, $filter: `SERNUM eq ${q(sernum)} and PARTNAME eq ${q(partname)}`, $top: 1 })))[0];
}

export const createSerial = (client, payload) => client.post('SERNUMBERS', payload);

export const listSerialsChanged = (client, since) => all(client, 'SERNUMBERS', { $select: SERIAL_FIELDS, $filter: `UDATE ge ${odataDate(since)}` });

// ---------------------------------------------------------------- service call status

const callPath = (docno) => `DOCUMENTS_Q(DOCNO=${qp(docno)},TYPE='Q')`;
export const listCallStatuses = (client) => all(client, 'CALLSTATUSES', { $select: 'CODE,INITSTATFLAG,ACTIVEFLAG,FINAL,CANCEL' });
export const updateServiceCall = (client, docno, data) => client.patch(callPath(docno), data);
export const listServiceCallsChanged = (client, since) =>
  all(client, 'DOCUMENTS_Q', { $select: 'DOCNO,CALLSTATUSCODE,STATUSDATE', $filter: `STATUSDATE ge ${odataDate(since)}` });

// ---------------------------------------------------------------- stock documents
// T = transfer between warehouses, D = shipment to a customer (parts used on a job), P = goods receipt.
// They are created as drafts and then moved to the status marked final in xDOCSTATS.

export const STOCK_DOCS = {
  T: { form: 'DOCUMENTS_T', lines: 'TRANSORDER_T_SUBFORM', stats: 'TDOCSTATS' },
  D: { form: 'DOCUMENTS_D', lines: 'TRANSORDER_D_SUBFORM', stats: 'DDOCSTATS' },
  P: { form: 'DOCUMENTS_P', lines: 'TRANSORDER_P_SUBFORM', stats: null },
};

export async function finalStatus(client, type) {
  const stats = STOCK_DOCS[type].stats;
  if (!stats) return 'Final';
  const list = await all(client, stats, { $select: 'STATDES,FINALFLAG,DEFAULTFINAL' });
  return (list.find((r) => r.FINALFLAG === 'Y' && r.DEFAULTFINAL === 'Y') ?? list.find((r) => r.FINALFLAG === 'Y'))?.STATDES ?? 'Final';
}

export async function findStockDoc(client, type, details) {
  return rows(await client.get(STOCK_DOCS[type].form, buildQuery({ $select: 'DOCNO,STATDES', $filter: `DETAILS eq ${q(details)}`, $top: 1 })))[0];
}

export async function createStockDoc(client, type, payload) {
  const res = await client.post(STOCK_DOCS[type].form, payload);
  return String(res?.DOCNO ?? '');
}

export const setStockDocStatus = (client, type, docno, status) => client.patch(`${STOCK_DOCS[type].form}(DOCNO=${qp(docno)},TYPE='${type}')`, { STATDES: status });

// ---------------------------------------------------------------- purchase order status, supplier invoices

export const listPurchaseStatuses = (client) => all(client, 'PORDSTATS', { $select: 'STATDES,INITSTATFLAG,OPENDOCFLAG,APPROVED,AFTERAPPFLAG,CLOSEDBOOL,CLOSESTATFLAG' });
export const updatePurchaseOrder = (client, ordname, data) => client.patch(`PORDERS(${qp(ordname)})`, data);
export const listPurchaseOrders = (client, filter) => all(client, 'PORDERS', { $select: 'ORDNAME,STATDES,CLOSEDBOOL', $filter: filter });

export const SUPPLIER_INVOICE_FORMS = ['YINVOICES', 'PINVOICES'];
export const listFinalSupplierDocs = (client, form, since) =>
  all(client, form, { $select: 'IVNUM,SUPNAME,IVDATE,ORDNAME,TOTPRICE,FINAL,DETAILS', $filter: `IVDATE ge ${odataDate(since)} and FINAL eq 'Y'` });

// ---------------------------------------------------------------- agents, sites, customer activities

export const listAgents = (client) => all(client, 'AGENTS', { $select: 'AGENTCODE,AGENTNAME,EMAIL,CELLPHONE' });
export async function createAgent(client, payload) {
  const res = await client.post('AGENTS', payload);
  return String(res?.AGENTCODE ?? payload.AGENTCODE);
}

const destsPath = (custname) => `CUSTOMERS(${qp(custname)})/CUSTDESTS_SUBFORM`;
export async function listSites(client, custname) {
  return rows(await client.get(destsPath(custname), buildQuery({ $select: 'CODE,CODEDES,ADDRESS,STATE' })));
}
export const createSite = (client, custname, payload) => client.post(destsPath(custname), payload);
export const updateSite = (client, custname, code, payload) => client.patch(`${destsPath(custname)}(${qp(code)})`, payload);

export const createCustomerNote = (client, custname, payload) => client.post(`CUSTOMERS(${qp(custname)})/CUSTNOTES_SUBFORM`, payload);
