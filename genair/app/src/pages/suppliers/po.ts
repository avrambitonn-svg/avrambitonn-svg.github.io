// הזמנות רכש: יצירה, שליחה לספק, אישור, קבלה למלאי (והוצאה בתיק המקושר), ביטול
import { app } from '../../lib/store'
import { nowIso, uid, ymd, date as fmtDate, money } from '../../lib/format'
import { mailLink, whatsappLink } from '../../lib/integrations/links'
import { moveStock, MAIN_WAREHOUSE } from '../../features/ops/ops'
import { brand } from '../../brand'
import type { ID, MoneyLine, PurchaseOrder, Supplier } from '../../lib/types'
import type { Tone } from '../../lib/labels'

export type PoStatus = PurchaseOrder['status']
export const poStatusLabel: Record<PoStatus, string> = { draft: 'טיוטה', sent: 'נשלחה', confirmed: 'אושרה ע״י הספק', received: 'התקבלה', cancelled: 'בוטלה' }
export const poStatusTone: Record<PoStatus, Tone> = { draft: 'muted', sent: 'info', confirmed: 'brand', received: 'success', cancelled: 'danger' }
export const poFlow: PoStatus[] = ['draft', 'sent', 'confirmed', 'received']
export const DIRECT = '__site' // קבלה ישירות לאתר: לא נכנס למלאי

const yy = () => String(new Date().getFullYear()).slice(2)
export const poTotal = (po: Pick<PurchaseOrder, 'lines'>) => po.lines.reduce((s, l) => s + l.qty * l.unitCost, 0)
export const isOpenPo = (po: PurchaseOrder) => po.status === 'draft' || po.status === 'sent' || po.status === 'confirmed'

// קטגוריית הוצאה מתאימה לפי סוג הספק (אפשר לשנות בקבלה)
const catBySupplier: Record<string, string> = { units: 'equipment', materials: 'materials', subcontractor: 'subcontractor', crane: 'crane', electric: 'subcontractor' }
export function expenseCategoryFor(s?: Supplier): string {
  const keys = app().db.config.expenseCategories.filter((o) => o.active).map((o) => o.key)
  const k = (s && catBySupplier[s.category]) || 'other'
  return keys.includes(k) ? k : keys[0] ?? k
}

export function createPurchaseOrder(p: Omit<PurchaseOrder, 'id' | 'number' | 'createdAt' | 'status'> & { status?: PoStatus }): PurchaseOrder {
  const s = app()
  const po: PurchaseOrder = { status: 'draft', ...p, id: uid('po'), number: s.nextNumber('po', `PO-${yy()}-`, 4), createdAt: nowIso(), createdBy: s.currentUserId }
  s.upsert('purchaseOrders', po)
  const sup = s.db.suppliers.find((x) => x.id === po.supplierId)
  if (po.caseId) s.log({ kind: 'note', caseId: po.caseId, text: `נפתחה הזמנת רכש ${po.number}${sup ? ` מ${sup.name}` : ''} (${money(poTotal(po))})` })
  return po
}

export function updatePurchaseOrder(id: ID, changes: Partial<PurchaseOrder>) {
  app().patch('purchaseOrders', id, changes)
}

// נוסח ההזמנה לספק (וואטסאפ / מייל)
export function poText(po: PurchaseOrder, sup?: Supplier): string {
  const s = app()
  const office = s.db.users.find((u) => u.id === po.createdBy) ?? s.db.users.find((u) => u.role === 'office')
  const k = po.caseId ? s.db.cases.find((x) => x.id === po.caseId) : undefined
  const sku = (itemId?: ID) => (itemId ? s.db.catalog.find((c) => c.id === itemId)?.sku : undefined)
  const dest = po.toLocation && po.toLocation !== DIRECT ? `אספקה ל${po.toLocation}: ${brand.address}` : k ? `אספקה לאתר: ${k.title}` : `אספקה ל${MAIN_WAREHOUSE}: ${brand.address}`
  return [
    `הזמנת רכש ${po.number} — ${brand.name}`,
    sup?.contactName ? `לכבוד ${sup.contactName}, ${sup.name}` : sup ? `לכבוד ${sup.name}` : null,
    `תאריך: ${fmtDate(po.createdAt)}`,
    '',
    ...po.lines.map((l) => `• ${sku(l.itemId) ? `${sku(l.itemId)} · ` : ''}${l.description} — ${l.qty} ${l.unit ?? 'יח׳'}`),
    '',
    dest,
    po.expectedAt ? `מועד אספקה מבוקש: ${fmtDate(po.expectedAt)}` : null,
    po.notes ? `הערות: ${po.notes}` : null,
    office ? `איש קשר: ${office.name}, ${office.phone.replace(/^(\d{3})/, '$1-')}` : `טלפון: ${brand.phone}`,
    'נא לאשר זמינות ומועד אספקה. תודה!',
  ].filter((x) => x !== null).join('\n')
}

export const poWhatsapp = (po: PurchaseOrder, sup?: Supplier) => {
  const text = poText(po, sup)
  return sup?.phone && sup.phone.replace(/\D/g, '').length >= 9 ? whatsappLink(sup.phone, text) : `https://wa.me/?text=${encodeURIComponent(text)}`
}
export const poMail = (po: PurchaseOrder, sup?: Supplier) => mailLink(sup?.email ?? '', `הזמנת רכש ${po.number} — ${brand.name}`, poText(po, sup))

export function markPoSent(id: ID, via: PurchaseOrder['sentVia']) {
  const s = app()
  const po = s.db.purchaseOrders.find((x) => x.id === id)
  if (!po) return
  s.patch('purchaseOrders', id, { status: po.status === 'draft' ? 'sent' : po.status, sentAt: po.sentAt ?? nowIso(), sentVia: via })
  if (po.caseId && po.status === 'draft') s.log({ kind: 'note', caseId: po.caseId, text: `הזמנת רכש ${po.number} נשלחה לספק` })
}

export function confirmPo(id: ID, expectedAt?: string) {
  app().patch('purchaseOrders', id, { status: 'confirmed', confirmedAt: nowIso(), ...(expectedAt ? { expectedAt } : {}) })
}

export function cancelPo(id: ID) {
  const s = app()
  const po = s.db.purchaseOrders.find((x) => x.id === id)
  if (!po || po.status === 'received') return
  s.patch('purchaseOrders', id, { status: 'cancelled', cancelledAt: nowIso() })
  if (po.caseId) s.log({ kind: 'note', caseId: po.caseId, text: `הזמנת רכש ${po.number} בוטלה` })
}

// קבלת סחורה: הכמויות נכנסות למיקום שנבחר, ואם ההזמנה מקושרת לתיק — נרשמת הוצאה בתיק
export function receivePo(id: ID, opts: { location: string; qty?: Record<number, number>; category?: string; addExpense?: boolean }): { stocked: number; expense?: MoneyLine } {
  const s = app()
  const po = s.db.purchaseOrders.find((x) => x.id === id)
  if (!po || po.status === 'received' || po.status === 'cancelled') return { stocked: 0 }
  const sup = s.db.suppliers.find((x) => x.id === po.supplierId)
  const lines = po.lines.map((l, i) => ({ ...l, qty: opts.qty?.[i] ?? l.qty }))
  let stocked = 0
  if (opts.location !== DIRECT) {
    lines.forEach((l) => {
      if (!l.itemId || l.qty <= 0) return
      const item = s.db.catalog.find((c) => c.id === l.itemId)
      if (!item || item.category === 'labor' || (item.category === 'service' && item.id !== 's-gas')) return
      moveStock(l.itemId, opts.location, l.qty, { kind: 'receive', purchaseOrderId: po.id, caseId: po.caseId })
      stocked++
    })
  }
  const total = poTotal({ lines })
  let expense: MoneyLine | undefined
  if (po.caseId && opts.addExpense !== false && total > 0) {
    expense = {
      id: uid('mn'), caseId: po.caseId, kind: 'expense', category: opts.category ?? expenseCategoryFor(sup), description: `הזמנת רכש ${po.number}${sup ? ` — ${sup.name}` : ''}`,
      amount: Math.round(total), at: ymd(), supplierId: po.supplierId, purchaseOrderId: po.id, userId: s.currentUserId,
    }
    s.upsert('money', expense)
    s.log({ kind: 'payment', caseId: po.caseId, text: `התקבלה הזמנת רכש ${po.number}: נרשמה הוצאה ${money(expense.amount)}` })
  }
  s.patch('purchaseOrders', id, { status: 'received', receivedAt: nowIso(), lines, toLocation: opts.location, ...(expense ? { moneyLineId: expense.id } : {}) })
  // עדכון למי שאחראי על התיק
  const k = po.caseId ? s.db.cases.find((x) => x.id === po.caseId) : undefined
  const to = new Set([k?.projectManagerId, k?.managerId].filter(Boolean) as ID[])
  to.delete(s.currentUserId)
  to.forEach((u) => s.notify(u, `התקבלה הזמנת רכש ${po.number}${k ? ` לתיק ${k.title}` : ''}`, k ? `/cases/${k.id}` : `/suppliers?po=${po.id}`))
  return { stocked, expense }
}
