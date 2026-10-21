// A small in-memory Priority (the OData subset the sync engine uses), copied from server/test/psync.test.js.
import { HttpError } from './bundle.js';


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

export class FakePriority {
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
