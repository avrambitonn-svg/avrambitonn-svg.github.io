// סנכרון מול Priority דרך שרת האינטגרציות. כל שינוי נכנס לתור ("ממתין") ונשלח כשהשרת זמין.
import { app } from '../store'
import { api, serverConfigured, ServerError } from './server'
import type { Customer, Quote, SyncState } from '../types'
import { nowIso } from '../format'
import { addressText } from './links'

export interface PCustomer {
  custname: string
  name: string
  phone?: string
  email?: string
  address?: string
  city?: string
  vatNum?: string
}
export interface PItem {
  partname: string
  description: string
  price: number
  currency?: string
  unit?: string
}

export const priorityEnabled = () => app().settings.priorityMode === 'server' && serverConfigured()

export const testConnection = () => api<{ ok: boolean; latencyMs: number; mode: string; serviceRoot: string; sample: { customers: number } }>('/api/priority/test')
export const listCustomers = (search = '', top = 50) =>
  api<{ items: PCustomer[] }>(`/api/priority/customers?search=${encodeURIComponent(search)}&top=${top}`)
export const listItems = (search = '', top = 50) => api<{ items: PItem[] }>(`/api/priority/items?search=${encodeURIComponent(search)}&top=${top}`)

function setSync<C extends 'customers' | 'quotes' | 'catalog'>(c: C, id: string, sync: SyncState) {
  app().patch(c, id, { sync } as never)
}

const errText = (e: unknown) => (e instanceof ServerError || e instanceof Error ? e.message : 'שגיאה לא ידועה')

// לקוח חדש: נפתח ב-Priority ומקבל מספר קבוע. עד אז הוא "לקוח זמני".
export async function pushCustomer(c: Customer): Promise<SyncState> {
  if (!priorityEnabled()) {
    const s: SyncState = { ...c.sync, status: 'pending' }
    setSync('customers', c.id, s)
    return s
  }
  try {
    const a = c.addresses[0]
    const res = await api<{ custname: string }>('/api/priority/customers', {
      method: 'POST',
      json: { name: c.name, phone: c.phone, email: c.email, address: addressText(a), city: a?.city, vatNum: c.idNumber },
    })
    const s: SyncState = { status: 'synced', priorityId: res.custname, lastSync: nowIso() }
    setSync('customers', c.id, s)
    app().patch('customers', c.id, { temp: false })
    app().log({ kind: 'sync', customerId: c.id, text: `הלקוח נפתח ב-Priority (${res.custname})` })
    return s
  } catch (e) {
    const s: SyncState = { ...c.sync, status: 'error', error: errText(e), lastSync: nowIso() }
    setSync('customers', c.id, s)
    return s
  }
}

// הצעה שאושרה הופכת להזמנה ב-Priority (בלי הקלדה כפולה)
export async function pushOrder(q: Quote, custname: string): Promise<SyncState> {
  if (!priorityEnabled()) {
    const s: SyncState = { ...q.sync, status: 'pending' }
    setSync('quotes', q.id, s)
    return s
  }
  const catalog = app().db.catalog
  try {
    const res = await api<{ ordname: string }>('/api/priority/orders', {
      method: 'POST',
      json: {
        custname,
        reference: q.number,
        details: `הזמנה מהצעה ${q.number}`,
        lines: q.lines.map((l) => ({
          partname: catalog.find((c) => c.id === l.itemId)?.sku ?? '000',
          qty: l.qty,
          price: l.unitPrice * (1 - q.discountPct / 100),
          description: l.description,
        })),
      },
    })
    const s: SyncState = { status: 'synced', priorityId: res.ordname, lastSync: nowIso() }
    setSync('quotes', q.id, s)
    app().log({ kind: 'sync', caseId: q.caseId, text: `נפתחה הזמנה ב-Priority: ${res.ordname}` })
    return s
  } catch (e) {
    const s: SyncState = { ...q.sync, status: 'error', error: errText(e), lastSync: nowIso() }
    setSync('quotes', q.id, s)
    return s
  }
}

// עיבוד התור: כל מה שממתין או נכשל
export async function processQueue(): Promise<{ done: number; failed: number }> {
  let done = 0
  let failed = 0
  const { db } = app()
  for (const c of db.customers.filter((x) => x.sync.status === 'pending' || x.sync.status === 'error' || x.temp)) {
    const s = await pushCustomer(c)
    s.status === 'synced' ? done++ : failed++
  }
  for (const q of app().db.quotes.filter((x) => x.status === 'approved' && (x.sync.status === 'pending' || x.sync.status === 'error'))) {
    const kase = app().db.cases.find((k) => k.id === q.caseId)
    const cust = app().db.customers.find((c) => c.id === kase?.customerId)
    if (!cust?.sync.priorityId) {
      failed++
      continue
    }
    const s = await pushOrder(q, cust.sync.priorityId)
    s.status === 'synced' ? done++ : failed++
  }
  return { done, failed }
}

// משיכת מחירים מ-Priority לקטלוג (לפי מק״ט)
export async function pullPrices(): Promise<{ updated: number; scanned: number; matched: number }> {
  const { db, patch } = app()
  let updated = 0
  // השרת מחזיר עד 200 פריטים לקריאה; כל עמוד הוא טרנזקציה אחת מהחבילה החודשית
  const items: PItem[] = []
  for (let skip = 0; skip < 2000; skip += 200) {
    const res = await api<{ items: PItem[] }>(`/api/priority/items?top=200&skip=${skip}`)
    items.push(...res.items)
    if (res.items.length < 200) break
  }
  let matched = 0
  for (const p of items) {
    const item = db.catalog.find((c) => c.sku === p.partname)
    if (item) matched++
    if (item && p.price > 0 && p.price !== item.price) {
      patch('catalog', item.id, { price: p.price, sync: { status: 'synced', priorityId: p.partname, lastSync: nowIso() } })
      updated++
    }
  }
  return { updated, scanned: items.length, matched }
}
