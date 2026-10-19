// היסטוריה של כשנתיים (מינואר שנה שעברה) לנתוני ההדגמה: תיקים שנסגרו או הופסדו, הצעות, כספים, התקנות, קריאות שירות ומשימות.
// בלי זה הדשבורד והדוחות נראים ריקים. הכל דטרמיניסטי (אותו פלט בכל טעינה), בעבר בלבד, ובלי שום דבר פתוח
// שיופיע ב"דורש טיפול עכשיו".
import { addDays, atTime, ymd } from './format'
import { totals } from './quote'
import { commissionFor } from './commission'
import type { Address, Appointment, Case, Contract, Customer, CustomerType, DB, LeadSource, MoneyLine, ProjectType, Quote, QuoteLine, ServiceCall, Task } from './types'

// מחולל מספרים קבוע (mulberry32)
function rng(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const surnames = ['כהן', 'לוי', 'מזרחי', 'פרידמן', 'שפירא', 'אברהם', 'דוד', 'ביטון', 'אזולאי', 'רבינוביץ', 'קליין', 'וייס', 'גבאי', 'חדד', 'אלמוג', 'ברק', 'נחום', 'טל', 'שטרן', 'הורוביץ', 'עמר', 'סלומון', 'גרינברג', 'פישר', 'מלכה', 'בן חיים', 'אוחנה', 'זילברמן', 'קפלן', 'רוזן', 'יוסף', 'שרעבי', 'דהן', 'ליברמן', 'בירנבאום', 'אדלר']
const businesses = ['משרדי עו״ד כרמל', 'מאפיית השוק', 'מרפאת שיניים הר חוצבים', 'סטודיו לאדריכלות נוף', 'חנות אופטיקה בעיר', 'מסעדת הגפן', 'משרד רואי חשבון ארז', 'מכון כושר תלפיות', 'גלריה ברחוב יפו', 'מוסך שמעון', 'בית קפה הגבעה', 'מעבדת שיניים דנטל', 'אולם אירועים הגן', 'מלון בוטיק מרכז העיר']
const institutions = ['בית כנסת אוהל משה', 'ישיבת תורת חיים', 'מתנ״ס גבעת שאול', 'בית ספר נועם', 'מרכז יום לקשיש', 'ספרייה עירונית', 'גן ילדים רימון', 'תלמוד תורה בית יעקב', 'מכון מחקר הר הצופים']
const developers = ['אחים לוינסון בנייה', 'י.ד. יזמות ונדל״ן', 'חברת הבונים', 'ש.א. קבלנות']
const places: [string, string[]][] = [
  ['ירושלים', ['הרצל', 'עזה', 'בית לחם', 'הנביאים', 'יפו', 'קרן היסוד', 'גולדה מאיר', 'שמואל הנביא', 'הפלמ״ח', 'רמת אשכול', 'פייר קניג', 'דרך חברון']],
  ['בית שמש', ['נחל שורק', 'הרב קוק', 'נחל דולב', 'יצחק רבין']],
  ['מבשרת ציון', ['החוצבים', 'הראל', 'מעלה החמישה']],
  ['מעלה אדומים', ['דרך קדם', 'מצפה נבו', 'המעיין']],
  ['גבעת זאב', ['הבשור', 'האלה']],
]
const lostReasons = ['בחרו הצעה זולה יותר של מתחרה', 'המחיר מעל התקציב', 'דחו את הפרויקט לשנה הבאה', 'לא חזרו אלינו אחרי הסקר', 'היזם עבד עם קבלן משלו', 'זמני האספקה לא התאימו']
const taskTitles = ['לחזור ללקוח עם תשובה', 'לשלוח הצעת מחיר מעודכנת', 'לתאם סקר בשטח', 'להזמין ציוד מהספק', 'לתאם מועד התקנה', 'לגבות יתרה', 'להציע חוזה תחזוקה', 'לבדוק מלאי ברכב', 'לעדכן לקוח ב-Priority', 'לשלוח אישור בדיקה שנתית', 'להעלות תמונות מההתקנה לתיק', 'לבקש חוות דעת מהלקוח']
const serviceIssues: [ServiceCall['symptom'], string][] = [
  ['not_cooling', 'המזגן לא מקרר'], ['leak', 'נזילת מים מהיחידה הפנימית'], ['noise', 'רעש חזק מהמדחס'], ['error_code', 'קוד תקלה על הצג'],
  ['no_power', 'המזגן לא נדלק'], ['smell', 'ריח לא נעים מהמזגן'], ['remote', 'השלט לא עובד'], ['not_cooling', 'מזגן מחמם חלש'],
]


export function applyHistorySeed(db: DB): void {
  if (db.cases.some((k) => k.id.startsWith('h-'))) return
  const r = rng(20260519)
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]
  const int = (a: number, b: number) => a + Math.floor(r() * (b - a + 1))
  const chance = (p: number) => r() < p
  const now = new Date()
  const cutoff = addDays(now, -7) // קריאות שירות ומשימות: עד לפני שבוע
  const dealCut = addDays(now, -3) // החלטות על הצעות: עד לפני שלושה ימים
  const yesterday = addDays(now, -1)
  const iso = (d: Date) => d.toISOString()
  const at = (d: Date, hhmm: string) => atTime(d, hhmm)
  // יום עבודה: לא שבת. אם נופל אחרי סף העבר, מוחזר null
  const workday = (d: Date) => (d.getDay() === 6 ? addDays(d, -1) : d)
  const synced = (pid: string, when: Date) => ({ status: 'synced' as const, priorityId: pid, lastSync: iso(when) })
  const line = (id: string, qty: number, room?: string): QuoteLine => {
    const it = db.catalog.find((c) => c.id === id)!
    return { id: `hl-${id}-${Math.floor(r() * 1e9).toString(36)}`, itemId: id, description: it.name, qty, unit: it.unit, unitPrice: it.price, room }
  }

  // ---------- לקוחות ----------
  const newCustomers: Customer[] = []
  let custSeq = 0
  const makeCustomer = (type: CustomerType, created: Date): Customer => {
    custSeq++
    const [city, streets] = chance(0.62) ? places[0] : pick(places.slice(1))
    const address: Address = { id: `h-ad${custSeq}`, city, street: pick(streets), number: String(int(2, 88)), ...(type === 'private' && chance(0.7) ? { floor: String(int(0, 9)) } : {}) }
    const name = type === 'private' ? `משפחת ${pick(surnames)}` : type === 'business' ? pick(businesses) : type === 'institution' ? pick(institutions) : pick(developers)
    const c: Customer = {
      id: `h-c${custSeq}`, name, type, phone: `05${int(0, 8)}${String(int(1000000, 9999999))}`, addresses: [address],
      sync: synced(`C${11000 + custSeq}`, created), createdAt: iso(created),
    }
    newCustomers.push(c)
    return c
  }
  const custType = (t: ProjectType): CustomerType => (t === 'commercial' ? 'business' : t === 'institution' || t === 'smoke_ventilation' ? (chance(0.5) ? 'institution' : 'business') : t === 'residential_building' ? 'developer' : 'private')

  // ---------- הצעה לפי סוג פרויקט ----------
  const buildLines = (t: ProjectType, big: boolean): QuoteLine[] => {
    const L: QuoteLine[] = []
    const walls = ['i-w1', 'i-w15', 'i-w2', 'i-w25']
    if (t === 'replacement') {
      const n = int(1, 2)
      for (let i = 0; i < n; i++) L.push(line(pick(walls.slice(1)), 1, i ? 'חדר שינה' : 'סלון'))
      L.push(line('l-inst', n), line('l-remove', n))
      if (chance(0.4)) L.push(line('l-wifi', 1))
    } else if (t === 'apartment') {
      const rooms = ['סלון', 'חדר שינה', 'חדר ילדים', 'חדר עבודה', 'ממ״ד']
      const n = int(3, 5)
      if (chance(0.35)) { L.push(line(pick(['i-m3', 'i-m4']), 1, 'מיני מרכזי'), line('l-instm', 1)) }
      for (let i = 0; i < n; i++) L.push(line(pick(walls), 1, rooms[i]))
      L.push(line('l-inst', n), line('l-pipe', int(6, 22)), line('l-elec', int(1, 3)))
      if (chance(0.5)) L.push(line('l-prep', int(1, 3)))
    } else if (t === 'luxury') {
      if (big) {
        const n = int(6, 10)
        L.push(line('i-vrf-o', 1), line('i-vrf-i', n), line('l-instm', Math.ceil(n / 2)), line('l-pipe', int(40, 80)), line('l-crane', 1), line('l-wifi', 1))
      } else {
        const n = int(2, 4)
        for (let i = 0; i < n; i++) L.push(line(pick(['i-m3', 'i-m4', 'i-m5']), 1, ['קומת כניסה', 'קומה עליונה', 'מרתף', 'יחידת הורים'][i]))
        L.push(line('l-instm', n), line('l-pipe', int(20, 45)), line('l-height', 1), line('l-wifi', n))
      }
    } else if (t === 'commercial' || t === 'institution') {
      const large = big && chance(0.3)
      const n = large ? int(14, 22) : int(6, 12)
      L.push(line('i-vrf-o', large ? 2 : 1), line('i-vrf-i', n), line('l-instm', Math.ceil(n / 2)), line('l-pipe', int(60, 160)), line('l-crane', big ? 2 : 1), line('l-elec', int(2, 6)))
    } else if (t === 'residential_building') {
      const apts = int(14, 30)
      L.push(line('i-w15', apts * 2), line('l-inst', apts * 2), line('l-prep', apts * 2), line('l-crane', int(2, 4)))
    } else if (t === 'underfloor_heating') {
      L.push(line('i-hp', 1), line('i-ufh', int(90, 220)), line('l-instm', 1), line('l-elec', 1))
    } else if (t === 'smoke_ventilation') {
      const n = int(3, 9)
      L.push(line('i-fan', n), line('l-elec', n), line('l-crane', 1), line('s-smoke', 1))
    }
    return L
  }

  // ---------- התיקים ----------
  // פרויקט גדול (מסחר, מוסדות, בנייה רוויה, VRF בבית פרטי) אחד לחודש לכל היותר, כדי שההכנסות יזרמו כמו בעסק אמיתי
  const smallTypes: [ProjectType, number][] = [['apartment', 44], ['replacement', 34], ['luxury', 10], ['underfloor_heating', 6], ['smoke_ventilation', 6]]
  const bigTypes: [ProjectType, number][] = [['commercial', 4], ['institution', 4], ['luxury', 3], ['residential_building', 1]]
  const sources: [LeadSource, number][] = [['phone', 25], ['whatsapp', 20], ['website', 18], ['referral', 17], ['facebook', 10], ['portal', 5], ['other', 5]]
  const weighted = <T,>(xs: [T, number][]) => {
    const tot = xs.reduce((s, [, w]) => s + w, 0)
    let x = r() * tot
    for (const [v, w] of xs) if ((x -= w) < 0) return v
    return xs[0][0]
  }
  const days = new Map<string, number>([['apartment', 1], ['replacement', 1], ['luxury', 2], ['commercial', 3], ['institution', 3], ['underfloor_heating', 2], ['smoke_ventilation', 2], ['residential_building', 4]])
  const netOf = (lines: QuoteLine[]) => totals({ lines, discountPct: 0, vatPct: 18 }).net
  const titleBy: Record<string, string> = {
    apartment: 'מיזוג דירה', replacement: 'החלפת מזגנים', luxury: 'מיזוג בית פרטי', commercial: 'מיזוג עסק', institution: 'מיזוג מבנה ציבור',
    underfloor_heating: 'חימום תת-רצפתי', smoke_ventilation: 'מערכת שחרור עשן', residential_building: 'בנייה רוויה — מזגנים לדירות',
  }

  // תוכנית לפי חודש ההחלטה: יעד הכנסות לפי עונה (שיא בקיץ) ו-15% צמיחה השנה, ועסקאות עד שמגיעים אליו.
  // ככה ההכנסות זורמות כמו בעסק אמיתי, ולא קופצות מחודש לחודש
  const season = [0.55, 0.55, 0.75, 0.95, 1.15, 1.25, 1.3, 1.2, 1.0, 0.85, 0.65, 0.55]
  interface Plan { decided: Date; won: boolean; noQuote: boolean; t: ProjectType; big: boolean; lines: QuoteLine[] }
  const plans: Plan[] = []
  for (let mi = 0; ; mi++) {
    const mStart = new Date(now.getFullYear() - 1, mi, 1)
    if (mStart >= dealCut) break
    const mEnd = new Date(mStart.getFullYear(), mStart.getMonth() + 1, 0)
    const current = mEnd >= dealCut
    const lastDay = current ? dealCut.getDate() - 1 : mEnd.getDate()
    if (lastDay < 1) break
    const growth = mStart.getFullYear() === now.getFullYear() ? 1.16 : 1
    // החודש הנוכחי: בקצב של החודש הקודם, עד היום
    const pace = current ? Math.max(season[mStart.getMonth()], season[(mStart.getMonth() + 11) % 12]) * 1.12 * (now.getDate() / mEnd.getDate()) : season[mStart.getMonth()]
    const target = 235000 * pace * growth * (0.93 + r() * 0.14)
    const dayIn = () => workday(at(new Date(mStart.getFullYear(), mStart.getMonth(), int(1, lastDay)), `${int(9, 20)}:${pick(['05', '20', '40'])}`))
    let sum = 0
    let won = 0
    if (target > 110000 && chance(0.6)) {
      const t = weighted(bigTypes)
      const lines = buildLines(t, true)
      if (netOf(lines) < target * 0.7) { plans.push({ decided: dayIn(), won: true, noQuote: false, t, big: true, lines }); sum += netOf(lines); won++ }
    }
    for (let guard = 0; sum < target * 0.96 && guard < 40; guard++) {
      const t = weighted(smallTypes)
      const lines = buildLines(t, false)
      plans.push({ decided: dayIn(), won: true, noQuote: false, t, big: false, lines })
      sum += netOf(lines)
      won++
    }
    const lost = Math.round(won * (0.42 + r() * 0.16))
    for (let i = 0; i < lost; i++) {
      const big = chance(0.15)
      const t = weighted(big ? bigTypes : smallTypes)
      plans.push({ decided: dayIn(), won: false, noQuote: chance(0.22), t, big, lines: buildLines(t, big) })
    }
  }
  plans.sort((a, b) => a.decided.getTime() - b.decided.getTime())

  const out = { cases: [] as Case[], quotes: [] as Quote[], money: [] as MoneyLine[], appointments: [] as Appointment[] }
  for (const [pi, pl] of plans.entries()) {
    const hId = pi + 1
    const { t, big, won, noQuote, decided } = pl
    const sent = workday(at(addDays(decided, -int(2, 12)), `${int(9, 17)}:00`))
    const survey = workday(at(addDays(sent, -int(1, 4)), pick(['09:00', '11:00', '14:00'])))
    const c0 = workday(at(noQuote ? addDays(decided, -int(10, 25)) : addDays(survey, -int(1, 4)), `${int(8, 18)}:${pick(['00', '15', '30', '45'])}`))
    const reuse = chance(0.15) && newCustomers.length > 5
    const cust = (reuse ? pick(newCustomers.filter((c) => c.createdAt < iso(c0))) : undefined) ?? makeCustomer(custType(t), c0)
    const source: LeadSource = reuse ? 'returning' : weighted(sources)
    const projectish = big || t === 'smoke_ventilation'
    const agentId = chance(0.05) ? undefined : projectish ? (chance(0.85) ? 'u-agent2' : 'u-agent1') : chance(0.72) ? 'u-agent1' : 'u-agent2'
    const id = `h-k${hId}`
    const addr = cust.addresses[0]
    const k: Case = {
      id, number: '', title: `${titleBy[t] ?? 'פרויקט'} — ${cust.name.replace('משפחת ', '')}, ${addr.city}`, customerId: cust.id, contactIds: [], addressId: addr.id,
      projectType: t, stage: won ? 'closed' : 'lost', source, agentId, installerIds: [], priority: 'normal', tags: [], survey: { rooms: [], photos: [] },
      portal: { token: `pt-${id}`, enabled: false }, createdAt: iso(c0), updatedAt: iso(decided),
    }
    out.cases.push(k)
    if (noQuote) {
      k.lostReason = 'לא חזרו אלינו אחרי הסקר'
      continue
    }
    const surveyEnd = new Date(survey.getTime() + 3600_000)
    out.appointments.push({ id: `h-ap${hId}s`, type: 'survey', title: `סקר בשטח — ${cust.name}`, caseId: id, customerId: cust.id, addressId: addr.id, start: iso(survey), end: iso(surveyEnd), userIds: [agentId ?? 'u-eng'], status: 'done', checklist: [], photosBefore: [], photosAfter: [], completedAt: iso(surveyEnd) })
    const q: Quote = {
      id: `h-q${hId}`, caseId: id, number: '', version: 1, status: won ? 'approved' : 'rejected', lines: pl.lines,
      discountPct: chance(0.25) ? pick([3, 5, 7]) : 0, vatPct: 18, validUntil: ymd(addDays(sent, 14)), terms: '',
      sentAt: iso(sent), viewedAt: iso(at(addDays(sent, int(0, 1)), '20:30')), decidedAt: iso(decided), createdBy: agentId, createdAt: iso(addDays(sent, -1)),
      sync: synced(`Q${40000 + hId}`, decided),
    }
    out.quotes.push(q)
    if (!won) {
      k.lostReason = pick(lostReasons)
      continue
    }
    // עסקה: תקציב, התקנה, הוצאות, עמלה וסגירה
    const tt = totals(q, db.catalog)
    if (chance(0.7)) q.deposit = { amount: Math.round(tt.total * 0.3), paidAt: iso(decided), method: pick(['credit', 'bit', 'transfer'] as const) }
    out.money.push({ id: `h-mb${hId}`, caseId: id, kind: 'budget', category: 'ציוד', budgetType: 'equipment', description: 'ציוד לפי ההצעה', amount: Math.round(tt.net * 0.82), at: ymd(decided) })
    out.money.push({ id: `h-mb${hId}l`, caseId: id, kind: 'budget', category: 'עבודה', budgetType: 'labor', description: 'צוות התקנה', amount: Math.round(tt.net * 0.18), at: ymd(decided) })
    const nDays = days.get(t) ?? 1
    let day = workday(addDays(decided, int(4, 16)))
    if (day > addDays(yesterday, -nDays)) day = workday(addDays(decided, 1))
    const crew = t === 'replacement' || t === 'apartment' ? [pick(['u-inst1', 'u-inst2'])] : ['u-inst1', 'u-inst2']
    let last = day
    for (let d = 0; d < nDays && day <= yesterday; d++) {
      const s0 = at(day, '08:00')
      const e = at(day, nDays > 1 && d < nDays - 1 ? '16:00' : pick(['13:00', '14:30', '15:30']))
      out.appointments.push({ id: `h-ap${hId}i${d}`, type: 'installation', title: `התקנה — ${k.title}`, caseId: id, customerId: cust.id, addressId: addr.id, start: iso(s0), end: iso(e), userIds: crew, status: 'done', checklist: [], photosBefore: [], photosAfter: [], completedAt: iso(e) })
      last = day
      day = workday(addDays(day, 1))
    }
    k.installerIds = crew
    out.money.push({ id: `h-me${hId}`, caseId: id, kind: 'expense', category: 'equipment', description: 'חשבונית ספק — ציוד', amount: Math.round(tt.cost * (0.94 + r() * 0.1)), at: ymd(addDays(decided, int(1, 4))), method: 'transfer', status: 'paid' })
    out.money.push({ id: `h-ml${hId}`, caseId: id, kind: 'expense', category: 'subcontractor', description: 'עבודה וחומרים בשטח', amount: Math.round(tt.net * (0.06 + r() * 0.05)), at: ymd(last), method: 'transfer', status: 'paid' })
    const com = commissionFor(k, tt, db.config.commissionRules)
    if (com && agentId) out.money.push({ id: `h-mc${hId}`, caseId: id, kind: 'commission', category: 'עמלת סוכן', description: `${com.ruleName} — ${com.pct}%`, amount: com.amount, at: ymd(decided), userId: agentId, agentId, status: 'paid' })
    const closed = at(addDays(last, int(1, 6)), '12:00')
    k.closedAt = iso(closed < yesterday ? closed : yesterday)
    k.updatedAt = k.closedAt
  }

  // מספרים לפי סדר כרונולוגי, בלי להתנגש במספרים שכבר קיימים. בשנה שעברה המספור רץ מ-300
  const caseNums = new Set(db.cases.map((k) => k.number))
  const seq: Record<string, number> = {}
  for (const k of [...out.cases].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const yy = k.createdAt.slice(2, 4)
    const thisYear = Number(yy) === now.getFullYear() % 100
    seq[yy] = (seq[yy] ?? (thisYear ? 0 : 300)) + (thisYear ? 1 : int(1, 2))
    while (caseNums.has(`GN-${yy}${String(seq[yy]).padStart(4, '0')}`)) seq[yy]++
    k.number = `GN-${yy}${String(seq[yy]).padStart(4, '0')}`
    caseNums.add(k.number)
  }
  const taken = new Set(db.quotes.map((q) => q.number))
  const qseq: Record<string, number> = {}
  for (const q of [...out.quotes].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const yy = q.createdAt.slice(2, 4)
    qseq[yy] = (qseq[yy] ?? (Number(yy) === now.getFullYear() % 100 ? 0 : 120)) + 1
    while (taken.has(`Q-${yy}-${String(qseq[yy]).padStart(4, '0')}`)) qseq[yy]++
    q.number = `Q-${yy}-${String(qseq[yy]).padStart(4, '0')}`
    taken.add(q.number)
  }
  const yNow = String(now.getFullYear() % 100)

  // ---------- קריאות שירות ----------
  const allCustomers = [...db.customers.filter((c) => c.type === 'private' || c.type === 'business'), ...newCustomers]
  const calls: ServiceCall[] = []
  for (let mBack = 21; mBack >= 0; mBack--) {
    const mDate = new Date(now.getFullYear(), now.getMonth() - mBack, 1)
    const hot = [5, 6, 7].includes(mDate.getMonth())
    const n = hot ? int(11, 15) : int(5, 9)
    for (let i = 0; i < n; i++) {
      const created = workday(at(new Date(mDate.getFullYear(), mDate.getMonth(), int(1, 28)), `${int(8, 19)}:${pick(['00', '10', '35', '50'])}`))
      const closedAt = new Date(created.getTime() + int(3, 72) * 3600_000)
      if (closedAt > cutoff) continue
      const [symptom, description] = pick(serviceIssues)
      const warranty = chance(0.4)
      const c = pick(allCustomers)
      calls.push({
        id: `h-sc${calls.length + 1}`, number: '', customerId: c.id, addressId: c.addresses[0]?.id, description, symptom, urgency: pick(['low', 'normal', 'normal', 'high'] as const), status: 'done',
        assigneeId: chance(0.7) ? 'u-tech' : pick(['u-inst1', 'u-inst2']), underWarranty: warranty, charge: warranty ? 0 : pick([290, 290, 450, 650, 890]),
        resolution: pick(['ניקוי מסננים ובדיקה', 'מילוי גז קירור', 'החלפת כרטיס אלקטרוני', 'פתיחת סתימה בניקוז', 'החלפת קבל במדחס', 'הוחלף שלט']),
        source: pick(['phone', 'whatsapp', 'portal'] as const), createdAt: iso(created), closedAt: iso(closedAt),
      })
    }
  }
  calls.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const firstSc = Math.min(...db.serviceCalls.map((s) => Number(s.number.replace(/\D/g, '')) || 9999))
  calls.forEach((s, i) => (s.number = `SC-${String(firstSc - calls.length + i).padStart(4, '0')}`))

  // ---------- משימות שהושלמו ----------
  const tasks: Task[] = []
  const people = ['u-office', 'u-office', 'u-agent1', 'u-agent2', 'u-eng', 'u-admin', 'u-inst1']
  for (let mBack = 21; mBack >= 0; mBack--) {
    const n = int(18, 28)
    for (let i = 0; i < n; i++) {
      const created = at(new Date(now.getFullYear(), now.getMonth() - mBack, int(1, 28)), `${int(8, 17)}:00`)
      const doneAt = addDays(created, int(0, 6))
      if (doneAt > cutoff) continue
      const who = pick(people)
      const k = chance(0.6) ? out.cases.find((x) => x.createdAt <= iso(created) && (x.closedAt ?? x.updatedAt) >= iso(created)) : undefined
      tasks.push({ id: `h-t${tasks.length + 1}`, title: pick(taskTitles), caseId: k?.id, assigneeId: who, createdBy: pick(['u-admin', 'u-office', who]), due: ymd(addDays(created, int(1, 5))), done: true, status: 'done', priority: pick(['low', 'normal', 'normal', 'high'] as const), createdAt: iso(created), doneAt: iso(doneAt), doneBy: who })
    }
  }

  // ---------- חוזי תחזוקה פעילים ----------
  const usedCt = new Set(db.contracts.map((c) => c.number))
  const ctNums = Array.from({ length: 40 }, (_, i) => `CT-${String(i + 1).padStart(4, '0')}`).filter((x) => !usedCt.has(x))
  const contracts: Contract[] = []
  const wonCustomers = [...new Set(out.cases.filter((k) => k.stage === 'closed').map((k) => k.customerId))]
  for (let i = 0; i < 12 && i < wonCustomers.length; i++) {
    const c = newCustomers.find((x) => x.id === wonCustomers[i * 3 % wonCustomers.length])
    if (!c) continue
    const start = addDays(now, -int(30, 300))
    const type: Contract['type'] = c.type === 'institution' ? pick(['smoke_annual', 'vrf_service'] as const) : c.type === 'business' ? 'vrf_service' : 'maintenance'
    contracts.push({
      id: `h-ct${i + 1}`, number: ctNums[i], customerId: c.id, title: type === 'maintenance' ? `תחזוקה שנתית — ${c.name}` : type === 'smoke_annual' ? `בדיקה שנתית לשחרור עשן — ${c.name}` : `שירות למערכת VRF — ${c.name}`,
      type, unitIds: [], frequencyMonths: type === 'maintenance' ? 12 : 6, pricePerYear: type === 'maintenance' ? pick([900, 1200, 1500]) : pick([2800, 3600, 4800, 6000]),
      startDate: ymd(start), endDate: ymd(addDays(start, 365)), nextVisit: ymd(addDays(now, int(40, 160))), autoRenew: true, status: 'active',
    })
  }

  db.customers.push(...newCustomers)
  db.cases.push(...out.cases)
  db.quotes.push(...out.quotes)
  db.money.push(...out.money)
  db.appointments.push(...out.appointments)
  db.serviceCalls.push(...calls)
  db.tasks.push(...tasks)
  db.contracts.push(...contracts)
  // המונים ממשיכים אחרי המספרים שההיסטוריה תפסה
  db.counters = { ...db.counters, quote: Math.max(db.counters.quote, qseq[yNow] ?? 0), case: Math.max(db.counters.case, seq[yNow] ?? 0) }
}
