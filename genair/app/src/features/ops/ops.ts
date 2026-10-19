// עזרים למודול התפעול: שיבוץ, שטח, שירות ומלאי
import { useEffect, useState } from 'react'
import { app } from '../../lib/store'
import type {
  Address, Appointment, AppointmentType, Case, Certification, ChecklistItem, Contact, Contract, Customer, DB, ID, InstalledUnit, LeaveRequest, ServiceCall, Settings, StockEntry, User,
} from '../../lib/types'
import { addDays, daysBetween, date as fmtDate, time as fmtTime, uid, ymd } from '../../lib/format'
import { dayStatus, loadCalendar, type Calendar, type DayStatus } from '../../lib/integrations/hebcal'
import { forecast, type DayForecast } from '../../lib/integrations/weather'
import { addressText, portalUrl } from '../../lib/integrations/links'
import { installChecklist } from '../../lib/actions'
import type { Tone } from '../../lib/labels'
import { brand } from '../../brand'

export const MAIN_WAREHOUSE = 'מחסן ראשי'
export const vanOf = (u?: Pick<User, 'name'>) => (u ? `רכב — ${u.name}` : '')
export const isVan = (loc: string) => loc.startsWith('רכב')

// ---------- שעות ----------
export const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}
export const fromMin = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`
export const hhmmOf = (d: Date | string) => {
  const x = typeof d === 'string' ? new Date(d) : d
  return fromMin(x.getHours() * 60 + x.getMinutes())
}
export const dayStart = (d: Date | string) => {
  const x = typeof d === 'string' ? new Date(d.length === 10 ? d + 'T00:00:00' : d) : new Date(d.getTime())
  x.setHours(0, 0, 0, 0)
  return x
}
export const at = (day: string, hhmm: string) => {
  const x = dayStart(day)
  x.setMinutes(toMin(hhmm))
  return x
}
export function addMonths(d: Date | string, n: number): Date {
  const x = typeof d === 'string' ? dayStart(d) : new Date(d.getTime())
  const day = x.getDate()
  x.setDate(1)
  x.setMonth(x.getMonth() + n)
  const last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate()
  x.setDate(Math.min(day, last))
  return x
}
export const durationLabel = (min: number) => {
  if (min <= 0) return '—'
  const h = Math.floor(min / 60)
  const m = min % 60
  if (!h) return `${m} דק׳`
  const hs = h === 1 ? 'שעה' : h === 2 ? 'שעתיים' : `${h} שעות`
  return m ? `${hs} ו-${m} דק׳` : hs
}

// "סאמר ויעקב", "סאמר, יעקב ונתן"
export function joinHe(names: string[]) {
  const n = names.filter(Boolean)
  if (n.length <= 1) return n[0] ?? ''
  return `${n.slice(0, -1).join(', ')} ו${n[n.length - 1]}`
}
const titles = new Set(['ד״ר', 'ד"ר', 'דר׳', 'הרב', 'רב', 'אדריכל', 'עו״ד', 'פרופ׳', 'מר', 'גב׳'])
export function firstName(name = '') {
  const parts = name.trim().split(/\s+/).filter((p) => !titles.has(p))
  return parts[0] ?? name
}

// ---------- הקשר של משימה: לקוח, איש קשר, כתובת, צוות ----------
export interface JobContext {
  customer?: Customer
  contact?: Contact
  address?: Address
  phone?: string
  kase?: Case
  call?: ServiceCall
  contract?: Contract
  team: User[]
}

export function jobContext(db: DB, a: Partial<Pick<Appointment, 'caseId' | 'serviceCallId' | 'contractId' | 'customerId' | 'addressId' | 'userIds'>>): JobContext {
  const kase = a.caseId ? db.cases.find((x) => x.id === a.caseId) : undefined
  const call = a.serviceCallId ? db.serviceCalls.find((x) => x.id === a.serviceCallId) : undefined
  const contract = a.contractId ? db.contracts.find((x) => x.id === a.contractId) : call?.contractId ? db.contracts.find((x) => x.id === call.contractId) : undefined
  const customerId = a.customerId ?? kase?.customerId ?? call?.customerId ?? contract?.customerId
  const customer = customerId ? db.customers.find((x) => x.id === customerId) : undefined
  const contactId = kase?.contactIds[0]
  const contact =
    (contactId && db.contacts.find((x) => x.id === contactId)) ||
    db.contacts.find((x) => x.customerId === customerId && x.primary) ||
    db.contacts.find((x) => x.customerId === customerId) ||
    undefined
  const unitAddr = contract?.unitIds.length ? db.units.find((u) => u.id === contract.unitIds[0])?.addressId : undefined
  const addressId = a.addressId ?? kase?.addressId ?? call?.addressId ?? unitAddr
  const address = customer?.addresses.find((x) => x.id === addressId) ?? customer?.addresses[0]
  const team = (a.userIds ?? []).map((id) => db.users.find((u) => u.id === id)).filter(Boolean) as User[]
  return { customer, contact, address, phone: contact?.phone ?? customer?.phone, kase, call, contract, team }
}

export const addressLine = (a?: Address) => {
  if (!a) return ''
  const extra = [a.floor && `קומה ${a.floor}`, a.apartment && `דירה ${a.apartment}`].filter(Boolean).join(', ')
  return [addressText(a), extra].filter(Boolean).join(' · ')
}

// איך פונים ללקוח בהודעה: שם פרטי של איש הקשר, ולקוח פרטי בלי איש קשר לפי שמו הפרטי
export function greetName(customer?: Pick<Customer, 'name' | 'type'>, contact?: Pick<Contact, 'name'>) {
  if (contact) return firstName(contact.name)
  if (!customer) return ''
  return customer.type === 'private' && !/^משפחת /.test(customer.name) ? firstName(customer.name) : customer.name
}

// תאריך להודעה: "19 באוקטובר (יום שני)", כך שגם "ל-{date}" בתבניות נקרא טבעי
const dayMonth = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long' })
export const msgDate = (d: Date | string) => `${dayMonth.format(typeof d === 'string' ? new Date(d) : d)} (יום ${dowLong(d)})`

// משתנים לתבניות ההודעה
export function messageVars(ctx: JobContext, ap: Pick<Appointment, 'start'>, extra: Record<string, string | number | undefined> = {}) {
  const s = app()
  return {
    name: greetName(ctx.customer, ctx.contact),
    date: msgDate(ap.start),
    time: fmtTime(ap.start),
    team: joinHe(ctx.team.map((u) => u.name)),
    address: addressText(ctx.address),
    portal: ctx.kase ? portalUrl(ctx.kase.portal.token) : brand.website,
    number: ctx.call?.number,
    review: s.settings.reviewUrl,
    ...extra,
  }
}

// הודעות שאין להן תבנית מוכנה במערכת ההודעות
export const visitText: Partial<Record<AppointmentType, string>> = {
  service: 'שלום {name}, נקבע ביקור טכנאי ל-{date} בשעה {time} בכתובת {address}. הטכנאי: {team}. {brand}',
  maintenance: 'שלום {name}, הטיפול התקופתי נקבע ל-{date} בשעה {time}. הטכנאי: {team}. {brand}',
  inspection: 'שלום {name}, הבדיקה השנתית למערכת שחרור העשן נקבעה ל-{date} בשעה {time}. נבקש לדאוג לגישה לגג ולחדר הפיקוד. {brand}',
  meeting: 'שלום {name}, נקבעה פגישה ל-{date} בשעה {time}. {brand}',
}
export const serviceDoneText = 'שלום {name}, הטיפול בקריאה {number} הסתיים. {resolution} אם משהו עדיין לא תקין, אפשר לענות להודעה הזו. {brand}'
export const visitDoneText = 'שלום {name}, הטכנאי סיים את הביקור היום. תודה שבחרתם ב-{brand}!'

// ---------- סוגי משימות ----------
export const defaultDuration: Record<AppointmentType, number> = { survey: 90, installation: 0, service: 60, maintenance: 120, inspection: 180, meeting: 60 }
export const outdoorTypes: AppointmentType[] = ['installation', 'maintenance', 'inspection', 'survey']
export const fieldRoles: Record<AppointmentType, User['role'][]> = {
  survey: ['agent', 'engineer'],
  installation: ['installer'],
  service: ['installer'],
  maintenance: ['installer'],
  inspection: ['installer', 'engineer'],
  meeting: ['agent', 'engineer', 'office', 'admin'],
}

const list = (items: string[]): ChecklistItem[] => items.map((text) => ({ id: uid('cl'), text, done: false }))
export function checklistFor(type: AppointmentType): ChecklistItem[] {
  switch (type) {
    case 'installation':
      return installChecklist()
    case 'maintenance':
      return list(['ניקוי פילטרים', 'ניקוי סוללה ומגש ניקוז', 'בדיקת קו ניקוז', 'בדיקת לחצי גז וזרם', 'ניקוי יחידה חיצונית', 'הפעלה ובדיקת טמפרטורת יציאה'])
    case 'inspection':
      return list(['בדיקת מפוחים והפעלה ידנית', 'בדיקת בקר ולוח פיקוד', 'בדיקת חיבור למערכת גילוי אש', 'בדיקת תריסים ומדפים', 'מדידת ספיקת אוויר', 'בדיקת אספקת חשמל וגיבוי'])
    case 'service':
      return list(['אבחון התקלה', 'תיקון או החלפת חלק', 'בדיקת תפקוד מול הלקוח'])
    case 'survey':
      return list(['מדידת חדרים', 'צילום מיקומים ולוח חשמל', 'בדיקת מיקום ליחידות חיצוניות', 'שיחה על לוחות זמנים ותקציב'])
    default:
      return []
  }
}

// ---------- התנגשויות והצעת מועדים ----------
const live = (a: Appointment) => a.status !== 'cancelled'
export const overlaps = (s1: number, e1: number, s2: number, e2: number) => s1 < e2 && s2 < e1

export function conflictsFor(appts: Appointment[], userIds: ID[], start: Date, end: Date, excludeIds: ID[] = []) {
  const s = start.getTime()
  const e = end.getTime()
  return appts
    .filter((a) => live(a) && !excludeIds.includes(a.id) && a.userIds.some((u) => userIds.includes(u)) && overlaps(s, e, +new Date(a.start), +new Date(a.end)))
    .sort((a, b) => a.start.localeCompare(b.start))
}

export function busyOn(appts: Appointment[], userId: ID, day: string) {
  return appts.filter((a) => live(a) && a.userIds.includes(userId) && ymd(a.start) === day).sort((a, b) => a.start.localeCompare(b.start))
}

// סוף יום העבודה בפועל: שעת הסיום הרגילה, או מוקדם יותר בשישי ובערב חג
export function dayEndMin(st: DayStatus, s: Settings) {
  const end = toMin(s.workEnd)
  return st.endBy ? Math.min(end, toMin(st.endBy)) : end
}

export interface Slot {
  start: Date
  end: Date
  short?: boolean
  label?: string
}

// ---------- חופשות: מי לא זמין ומתי ----------
// רק בקשות שאושרו חוסמות שיבוץ. חופשה חלקית (hours) חוסמת רק את השעות שלה, ביום אחד
export const leaveCovers = (l: Pick<LeaveRequest, 'from' | 'to'>, day: string) => l.from <= day && day <= l.to

export function leavesOn(leaves: LeaveRequest[] | undefined, day: string, userId?: ID, statuses: LeaveRequest['status'][] = ['approved']) {
  return (leaves ?? []).filter((l) => statuses.includes(l.status) && (!userId || l.userId === userId) && leaveCovers(l, day))
}

// החופשה שחוסמת את העובד בטווח (או undefined). בלי שעות = כל היום
export function leaveBlocking(leaves: LeaveRequest[] | undefined, userId: ID, start: Date, end: Date): LeaveRequest | undefined {
  if (!leaves?.length) return undefined
  const s = start.getTime()
  const e = end.getTime()
  const last = ymd(e > s ? new Date(e - 1) : start)
  for (let d = dayStart(start); ymd(d) <= last; d = addDays(d, 1)) {
    const k = ymd(d)
    const hit = leavesOn(leaves, k, userId).find((l) => !l.hours || overlaps(s, e, +at(k, l.hours.start), +at(k, l.hours.end)))
    if (hit) return hit
  }
  return undefined
}

export function leaveConflicts(leaves: LeaveRequest[] | undefined, userIds: ID[], start: Date, end: Date) {
  return userIds.map((userId) => ({ userId, leave: leaveBlocking(leaves, userId, start, end) })).filter((x): x is { userId: ID; leave: LeaveRequest } => !!x.leave)
}

// משימות של העובד בטווח ימים (לאזהרה לפני אישור חופשה)
export function appointmentsInRange(appts: Appointment[], userId: ID, from: string, to: string, hours?: LeaveRequest['hours']) {
  return appts
    .filter((a) => live(a) && a.status !== 'done' && a.userIds.includes(userId) && ymd(a.start) <= to && ymd(a.end) >= from)
    .filter((a) => !hours || overlaps(+new Date(a.start), +new Date(a.end), +at(from, hours.start), +at(from, hours.end)))
    .sort((a, b) => a.start.localeCompare(b.start))
}

// מספר ימי העבודה בטווח (לתצוגה: "3 ימים")
export function leaveWorkDays(l: Pick<LeaveRequest, 'from' | 'to' | 'hours'>, s: Pick<Settings, 'workDays'>) {
  if (l.hours) return 0
  let n = 0
  for (let d = dayStart(l.from); ymd(d) <= l.to; d = addDays(d, 1)) if (s.workDays.includes(d.getDay())) n++
  return n
}

export function suggestSlots(opts: { appts: Appointment[]; userIds: ID[]; durationMin: number; cal: Calendar; settings: Settings; from?: Date; count?: number; maxDays?: number; excludeIds?: ID[]; leaves?: LeaveRequest[] }): Slot[] {
  const { appts, userIds, cal, settings, count = 3, maxDays = 45, excludeIds = [], leaves } = opts
  const from = opts.from ?? new Date()
  const out: Slot[] = []
  const ws = toMin(settings.workStart)
  for (let d = 0; d <= maxDays && out.length < count; d++) {
    const day = addDays(dayStart(from), d)
    if (!settings.workDays.includes(day.getDay())) continue
    const st = dayStatus(day, cal)
    if (!st.ok) continue
    const de = dayEndMin(st, settings)
    const dur = opts.durationMin > 0 ? opts.durationMin : de - ws
    let first = ws
    if (d === 0) {
      const now = from.getHours() * 60 + from.getMinutes() + 30
      first = Math.max(ws, Math.ceil(now / 30) * 30)
    }
    for (let t = first; t + dur <= de; t += 30) {
      const start = new Date(day.getTime())
      start.setMinutes(t)
      const end = new Date(day.getTime())
      end.setMinutes(t + dur)
      if (userIds.length && conflictsFor(appts, userIds, start, end, excludeIds).length) continue
      if (userIds.length && leaveConflicts(leaves, userIds, start, end).length) continue
      out.push({ start, end, short: st.short, label: st.label })
      break
    }
  }
  return out
}

// ---------- הסמכות ----------
export function certIssue(u: User, type: Certification['type'], onDay: string): { tone: 'danger' | 'warning'; text: string } | null {
  const c = u.certifications?.find((x) => x.type === type)
  if (!c) return { tone: 'danger', text: `ל${u.name} אין אישור ${type} רשום` }
  const left = daysBetween(onDay, c.expires)
  if (left < 0) return { tone: 'danger', text: `האישור של ${u.name} ל${type} פג ב-${fmtDate(c.expires)}` }
  if (left <= 14) return { tone: 'warning', text: `האישור של ${u.name} ל${type} יפוג ב-${fmtDate(c.expires)} (${left} ימים אחרי המועד)` }
  return null
}

export function needsHeightWork(db: DB, caseId?: ID) {
  if (!caseId) return false
  const k = db.cases.find((x) => x.id === caseId)
  if (k?.survey.workAtHeight || k?.survey.craneNeeded) return true
  const q = db.quotes.filter((x) => x.caseId === caseId && x.status !== 'rejected')
  return q.some((x) => x.lines.some((l) => l.itemId === 'l-height' || l.itemId === 'l-crane' || /גובה|סנפלינג|מנוף/.test(l.description)))
}

// ---------- אחריות ----------
export function warrantyOf(unit?: InstalledUnit): { under: boolean; until?: string } {
  if (!unit) return { under: false }
  return { under: unit.warrantyUntil >= ymd(), until: unit.warrantyUntil }
}

// ---------- שירות ----------
export type Symptom = NonNullable<ServiceCall['symptom']>
export const symptomLabel: Record<Symptom, string> = {
  not_cooling: 'לא מקרר / לא מחמם',
  leak: 'נזילת מים',
  noise: 'רעש או רעידות',
  error_code: 'קוד תקלה בתצוגה',
  no_power: 'לא נדלק',
  smell: 'ריח לא טוב',
  remote: 'שלט / תצוגה',
  other: 'אחר',
}
export const urgencyLabel: Record<ServiceCall['urgency'], string> = { low: 'נמוכה', normal: 'רגילה', high: 'גבוהה', urgent: 'דחופה' }
export const urgencyTone: Record<ServiceCall['urgency'], Tone> = { low: 'muted', normal: 'neutral', high: 'warning', urgent: 'danger' }
export const openStatuses: ServiceCall['status'][] = ['new', 'assigned', 'scheduled', 'in_progress', 'waiting_parts']

// ---------- מלאי ----------
export const findStock = (stock: StockEntry[], itemId: ID, location: string) => stock.find((x) => x.itemId === itemId && x.location === location)

// שינוי כמות במיקום. אם אין רשומה, נוצרת אחת (מינימום 0). מחזיר את הכמות החדשה.
export function moveStock(itemId: ID, location: string, delta: number): number {
  const s = app()
  const e = findStock(s.db.stock, itemId, location)
  if (e) {
    const qty = e.qty + delta
    s.patch('stock', e.id, { qty })
    return qty
  }
  s.upsert('stock', { id: uid('st'), itemId, location, qty: delta, min: 0 })
  return delta
}

export function setStock(itemId: ID, location: string, qty: number, min?: number) {
  const s = app()
  const e = findStock(s.db.stock, itemId, location)
  if (e) s.patch('stock', e.id, { qty, ...(min !== undefined ? { min } : {}) })
  else s.upsert('stock', { id: uid('st'), itemId, location, qty, min: min ?? 0 })
}

export function locationsOf(db: Pick<DB, 'stock' | 'users'>) {
  const vans = db.users.filter((u) => u.role === 'installer' && u.active).map((u) => vanOf(u))
  const extra = db.stock.map((x) => x.location).filter((l) => l !== MAIN_WAREHOUSE && !vans.includes(l))
  return [MAIN_WAREHOUSE, ...new Set([...vans, ...extra])]
}

// ---------- נתונים חיצוניים ----------
const emptyCal: Calendar = { days: [], candles: {} }
export function useHebcal(from: Date, to: Date): { cal: Calendar; ready: boolean } {
  const [state, setState] = useState<{ cal: Calendar; ready: boolean }>({ cal: emptyCal, ready: false })
  const fk = ymd(from)
  const tk = ymd(to)
  useEffect(() => {
    let on = true
    loadCalendar(dayStart(fk), dayStart(tk)).then((c) => on && setState({ cal: c, ready: true }))
    // רשת איטית או בלי קליטה: לא מחכים לנצח. שבת חסומה תמיד, והחגים יתעדכנו כשיגיעו
    const t = setTimeout(() => on && setState((s) => (s.ready ? s : { ...s, ready: true })), 4000)
    return () => {
      on = false
      clearTimeout(t)
    }
  }, [fk, tk])
  return state
}

// הימים הבאים שמותר לעבוד בהם (לשיבוץ של כמה ימים ברצף)
export function nextWorkDays(first: string, n: number, cal: Calendar, s: Settings): string[] {
  const out = [first]
  let d = dayStart(first)
  let guard = 0
  while (out.length < n && guard++ < 60) {
    d = addDays(d, 1)
    if (!s.workDays.includes(d.getDay()) || !dayStatus(d, cal).ok) continue
    out.push(ymd(d))
  }
  return out
}

export function useForecast(): DayForecast[] {
  const [f, setF] = useState<DayForecast[]>([])
  useEffect(() => {
    let on = true
    forecast().then((d) => on && setF(d))
    return () => {
      on = false
    }
  }, [])
  return f
}

export function useOnline() {
  const [on, setOn] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  useEffect(() => {
    const up = () => setOn(true)
    const down = () => setOn(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return on
}

// ---------- יומן ----------
export function icsEvent(db: DB, a: Appointment) {
  const ctx = jobContext(db, a)
  const details = [
    ctx.customer?.name,
    ctx.contact && `${ctx.contact.name} ${ctx.contact.phone}`,
    ctx.team.length ? `צוות: ${ctx.team.map((u) => u.name).join(', ')}` : '',
    a.notes,
  ].filter(Boolean).join('\n')
  return { id: a.id, title: a.title, start: a.start, end: a.end, details, location: a.location || addressText(ctx.address) }
}

export const dayKey = (d: Date) => ymd(d)
const dowS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳']
const dowL = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
export const dow = (d: Date | string) => dowS[dayStart(d).getDay()]
export const dowLong = (d: Date | string) => dowL[dayStart(d).getDay()]
export const dowNames = dowL
export const dowLetters = dowS

export function useMedia(q: string) {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const f = () => setM(mq.matches)
    f()
    mq.addEventListener('change', f)
    return () => mq.removeEventListener('change', f)
  }, [q])
  return m
}

export function readPref<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const v = localStorage.getItem(key) as T | null
    return v && allowed.includes(v) ? v : fallback
  } catch {
    return fallback
  }
}
export function writePref(key: string, v: string) {
  try {
    localStorage.setItem(key, v)
  } catch {
    /* אחסון חסום: ממשיכים בלי לזכור */
  }
}

// פריסת אירועים חופפים בעמודת יום: לכל אירוע נתיב ומספר נתיבים בקבוצה שלו
export function layoutLanes<T extends { start: string; end: string }>(evs: T[]): { ev: T; lane: number; lanes: number }[] {
  const sorted = [...evs].sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end))
  const out: { ev: T; lane: number; lanes: number }[] = []
  let cluster: { ev: T; lane: number; lanes: number }[] = []
  let laneEnds: number[] = []
  let clusterEnd = -Infinity
  const flush = () => {
    const n = laneEnds.length
    cluster.forEach((c) => (c.lanes = n))
    out.push(...cluster)
    cluster = []
    laneEnds = []
  }
  for (const ev of sorted) {
    const s = +new Date(ev.start)
    const e = +new Date(ev.end)
    if (s >= clusterEnd && cluster.length) flush()
    let lane = laneEnds.findIndex((end) => end <= s)
    if (lane < 0) {
      lane = laneEnds.length
      laneEnds.push(e)
    } else laneEnds[lane] = e
    cluster.push({ ev, lane, lanes: 1 })
    clusterEnd = Math.max(cluster.length === 1 ? -Infinity : clusterEnd, e)
  }
  if (cluster.length) flush()
  return out
}
