// פעולות עסקיות מרכזיות. כל פעולה מעדכנת את הנתונים, רושמת היסטוריה ושולחת התראות למי שצריך.
import { app } from './store'
import type { Appointment, AppointmentType, Case, CaseStage, Contract, Customer, ID, InstalledUnit, Quote, QuoteLine, Signature } from './types'
import { addDays, nowIso, token, uid, ymd } from './format'
import { stageLabel } from './labels'
import { defaultTerms, totals } from './quote'
import { pushCustomer, pushOrder } from './integrations/priority'
import { createDriveFolder, pushAppointment } from './integrations/google'

const yy = () => String(new Date().getFullYear()).slice(2)

export function createCustomer(c: Omit<Customer, 'id' | 'createdAt' | 'sync' | 'temp'>): Customer {
  const customer: Customer = { ...c, id: uid('c'), createdAt: nowIso(), temp: true, sync: { status: 'not_synced' } }
  app().upsert('customers', customer)
  void pushCustomer(customer)
  return customer
}

export function createCase(input: Omit<Case, 'id' | 'number' | 'createdAt' | 'updatedAt' | 'portal' | 'survey' | 'stage' | 'tags' | 'installerIds'> &
  Partial<Pick<Case, 'stage' | 'tags' | 'installerIds'>>): Case {
  const s = app()
  const number = s.nextNumber('case', `GN-${yy()}`, 4)
  const k: Case = {
    stage: 'lead',
    tags: [],
    installerIds: [],
    ...input,
    id: uid('k'),
    number,
    survey: { rooms: [], photos: [] },
    portal: { token: token(), enabled: true },
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }
  s.upsert('cases', k)
  s.log({ kind: 'created', caseId: k.id, text: `התיק נפתח (${number})` })
  const notifyIds = new Set([k.agentId, k.engineerId, k.managerId, ...s.db.users.filter((u) => u.role === 'admin').map((u) => u.id)].filter(Boolean) as ID[])
  notifyIds.delete(s.currentUserId)
  notifyIds.forEach((uidTo) => s.notify(uidTo, `תיק חדש: ${k.title}`, `/cases/${k.id}`))
  void createDriveFolder(k)
  return k
}

export function setStage(caseId: ID, stage: CaseStage, note?: string) {
  const s = app()
  const k = s.db.cases.find((x) => x.id === caseId)
  if (!k || k.stage === stage) return
  s.patch('cases', caseId, { stage, updatedAt: nowIso(), ...(stage === 'closed' ? { closedAt: nowIso() } : {}), ...(stage === 'lost' && note ? { lostReason: note } : {}) })
  s.log({ kind: 'stage', caseId, text: `שלב: ${stageLabel[k.stage]} ← ${stageLabel[stage]}${note ? ` (${note})` : ''}` })
  if (k.agentId && k.agentId !== s.currentUserId) s.notify(k.agentId, `${k.title}: ${stageLabel[stage]}`, `/cases/${caseId}`)
}

export function touchCase(caseId: ID, changes: Partial<Case> = {}) {
  app().patch('cases', caseId, { ...changes, updatedAt: nowIso() })
}

export function createQuote(caseId: ID, lines: QuoteLine[], extra: Partial<Quote> = {}): Quote {
  const s = app()
  const existing = s.db.quotes.filter((q) => q.caseId === caseId)
  const q: Quote = {
    id: uid('q'),
    caseId,
    number: s.nextNumber('quote', `Q-${yy()}-`, 4),
    version: existing.length + 1,
    status: 'draft',
    lines,
    discountPct: 0,
    vatPct: s.settings.vatPct,
    validUntil: ymd(addDays(new Date(), s.settings.quoteValidityDays)),
    terms: defaultTerms,
    createdBy: s.currentUserId,
    createdAt: nowIso(),
    sync: { status: 'not_synced' },
    ...extra,
  }
  s.upsert('quotes', q)
  s.log({ kind: 'quote', caseId, text: `נוצרה הצעת מחיר ${q.number}${q.ai ? ' (טיוטה מ-AI)' : ''}` })
  const k = s.db.cases.find((x) => x.id === caseId)
  if (k && ['lead', 'survey'].includes(k.stage)) setStage(caseId, 'quote')
  return q
}

export function markQuoteSent(quoteId: ID) {
  const s = app()
  const q = s.db.quotes.find((x) => x.id === quoteId)
  if (!q) return
  if (q.status === 'draft') s.patch('quotes', quoteId, { status: 'sent', sentAt: nowIso() })
}

export function markQuoteViewed(quoteId: ID) {
  const s = app()
  const q = s.db.quotes.find((x) => x.id === quoteId)
  if (!q || !['sent', 'draft'].includes(q.status)) return
  s.patch('quotes', quoteId, { status: 'viewed', viewedAt: nowIso() })
  s.log({ kind: 'portal', caseId: q.caseId, text: `הלקוח צפה בהצעה ${q.number}` })
  const k = s.db.cases.find((x) => x.id === q.caseId)
  if (k?.agentId) s.notify(k.agentId, `הלקוח צפה בהצעה ${q.number}`, `/cases/${q.caseId}`)
}

// אישור הלקוח: חתימה, מקדמה, שלב "אושר", והזמנה ל-Priority
export function approveQuote(quoteId: ID, signature: Signature, deposit?: Quote['deposit']) {
  const s = app()
  const q = s.db.quotes.find((x) => x.id === quoteId)
  if (!q) return
  const approved: Quote = { ...q, status: 'approved', signature, deposit, decidedAt: nowIso() }
  s.upsert('quotes', approved)
  s.log({ kind: 'quote', caseId: q.caseId, text: `הלקוח אישר וחתם על הצעה ${q.number} (${signature.name})` })
  if (deposit?.paidAt) {
    s.upsert('money', { id: uid('mn'), caseId: q.caseId, kind: 'payment', category: 'מקדמה', description: `מקדמה — ${q.number}`, amount: deposit.amount, at: ymd() })
    s.log({ kind: 'payment', caseId: q.caseId, text: `התקבלה מקדמה ₪${deposit.amount.toLocaleString('he-IL')}` })
  }
  // שאר ההצעות בתיק נדחות אוטומטית
  s.db.quotes.filter((x) => x.caseId === q.caseId && x.id !== q.id && ['draft', 'sent', 'viewed'].includes(x.status)).forEach((x) => s.patch('quotes', x.id, { status: 'rejected' }))
  setStage(q.caseId, 'approved')
  const k = s.db.cases.find((x) => x.id === q.caseId)
  const office = s.db.users.filter((u) => u.role === 'office' || u.role === 'admin')
  office.forEach((u) => s.notify(u.id, `הצעה אושרה: ${k?.title ?? q.number} — לתאם התקנה`, `/cases/${q.caseId}`))
  const t = totals(approved, s.db.catalog)
  if (k?.agentId) {
    s.upsert('money', {
      id: uid('mn'), caseId: q.caseId, kind: 'commission', category: 'עמלת סוכן',
      description: `${s.db.users.find((u) => u.id === k.agentId)?.name ?? ''} — ${s.settings.commissionPct}%`, amount: Math.round((t.net * s.settings.commissionPct) / 100), at: ymd(), userId: k.agentId,
    })
  }
  const cust = s.db.customers.find((c) => c.id === k?.customerId)
  if (cust?.sync.priorityId) void pushOrder(approved, cust.sync.priorityId)
  else s.patch('quotes', q.id, { sync: { status: 'pending' } })
}

export function rejectQuote(quoteId: ID, reason?: string) {
  const s = app()
  const q = s.db.quotes.find((x) => x.id === quoteId)
  if (!q) return
  s.patch('quotes', quoteId, { status: 'rejected', decidedAt: nowIso() })
  s.log({ kind: 'quote', caseId: q.caseId, text: `ההצעה ${q.number} נדחתה${reason ? `: ${reason}` : ''}` })
}

export function scheduleAppointment(a: Omit<Appointment, 'id' | 'status' | 'checklist' | 'photosBefore' | 'photosAfter'> & Partial<Pick<Appointment, 'checklist' | 'status'>>): Appointment {
  const s = app()
  const ap: Appointment = { status: 'planned', checklist: [], ...a, id: uid('ap'), photosBefore: [], photosAfter: [] }
  s.upsert('appointments', ap)
  if (ap.caseId) {
    s.log({ kind: 'appointment', caseId: ap.caseId, text: `נקבע: ${ap.title}` })
    const k = s.db.cases.find((x) => x.id === ap.caseId)
    if (k && ap.type === 'installation' && ['approved', 'quote'].includes(k.stage)) {
      setStage(k.id, 'scheduled')
      touchCase(k.id, { installerIds: [...new Set([...k.installerIds, ...ap.userIds])], installWindow: { from: ymd(ap.start), to: ymd(ap.end) } })
    }
    if (k && ap.type === 'survey' && k.stage === 'lead') setStage(k.id, 'survey')
  }
  ap.userIds.filter((x) => x !== s.currentUserId).forEach((u) => s.notify(u, `שובצת: ${ap.title}`, `/field`))
  void pushAppointment(ap)
  return ap
}

export const installChecklist = () =>
  ['בדיקת מיקומים מול הלקוח', 'קידוח ומעברי צנרת', 'התקנת יחידות פנימיות', 'התקנת יחידות חיצוניות', 'ואקום ובדיקת לחצים', 'הפעלה ובדיקת ניקוז', 'הדרכת לקוח ותפעול שלט', 'ניקיון האתר'].map((text) => ({
    id: uid('cl'),
    text,
    done: false,
  }))

// סיום התקנה: יחידות נרשמות עם אחריות, נפתח חוזה תחזוקה מוצע, התיק עובר ל"הותקן"
export function completeInstallation(appointmentId: ID, signature: Signature, serials: Record<string, string> = {}) {
  const s = app()
  const ap = s.db.appointments.find((x) => x.id === appointmentId)
  if (!ap) return
  s.patch('appointments', appointmentId, { status: 'done', customerSignature: signature })
  if (!ap.caseId) return
  const k = s.db.cases.find((x) => x.id === ap.caseId)!
  const others = s.db.appointments.filter((x) => x.caseId === k.id && x.id !== ap.id && x.type === 'installation' && x.status !== 'done' && x.status !== 'cancelled')
  if (others.length) {
    s.log({ kind: 'appointment', caseId: k.id, text: `יום התקנה הסתיים (${ap.title}), נשארו ${others.length} ימים` })
    return
  }
  const q = s.db.quotes.find((x) => x.caseId === k.id && x.status === 'approved')
  const created: InstalledUnit[] = []
  q?.lines.forEach((l) => {
    const item = s.db.catalog.find((c) => c.id === l.itemId)
    if (!item || (item.category !== 'unit' && item.category !== 'heating' && item.category !== 'ventilation') || item.unit === 'מ״ר') return
    for (let i = 0; i < l.qty; i++) {
      const u: InstalledUnit = {
        id: uid('un'), customerId: k.customerId, addressId: k.addressId, caseId: k.id, itemId: item.id, model: item.name.split('(')[0].trim(),
        serial: serials[`${l.id}-${i}`] || `${item.sku}-${Date.now().toString(36).toUpperCase().slice(-5)}${i}`, location: l.room, btu: item.btu,
        installedAt: ymd(), warrantyUntil: ymd(addDays(new Date(), (item.warrantyMonths ?? 36) * 30)), nextServiceAt: ymd(addDays(new Date(), 180)),
      }
      created.push(u)
      s.upsert('units', u)
    }
  })
  setStage(k.id, 'completed')
  s.log({ kind: 'appointment', caseId: k.id, text: `ההתקנה הסתיימה. הלקוח חתם (${signature.name}), נרשמו ${created.length} יחידות עם אחריות` })
  if (created.length) {
    const contract: Contract = {
      id: uid('kt'), number: s.nextNumber('contract', 'CT-', 4), customerId: k.customerId, title: `טיפול שנתי — ${created.length} יחידות (מוצע)`, type: 'maintenance',
      unitIds: created.map((u) => u.id), frequencyMonths: 12, pricePerYear: created.length * 290, startDate: ymd(), endDate: ymd(addDays(new Date(), 365)),
      nextVisit: ymd(addDays(new Date(), 180)), autoRenew: true, status: 'active', notes: 'נפתח אוטומטית בסיום ההתקנה. להציע ללקוח.',
    }
    s.upsert('contracts', contract)
  }
  s.db.users.filter((u) => u.role === 'office' || u.role === 'admin').forEach((u) => s.notify(u.id, `ההתקנה הסתיימה: ${k.title}`, `/cases/${k.id}`))
}

export function newAppointmentDraft(type: AppointmentType, caseId?: ID): Partial<Appointment> {
  return { type, caseId, userIds: [], checklist: type === 'installation' ? installChecklist() : [] }
}
