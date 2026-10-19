// עזרים למודול הצעות המחיר והמסכים ללקוח
import type { AiMeta, Case, Contact, Customer, Quote, QuoteLine, Role } from '../../lib/types'
import { ymd } from '../../lib/format'
import type { Tone } from '../../lib/labels'

// עלות, רווח ומרווח: רק להנהלה ולמשרד
export const canSeeCost = (role: Role) => role === 'admin' || role === 'office'

export const MIN_MARGIN = 25

export const depositMethodLabel: Record<NonNullable<NonNullable<Quote['deposit']>['method']>, string> = {
  credit: 'כרטיס אשראי',
  bit: 'Bit',
  transfer: 'העברה בנקאית',
  check: "צ'ק",
}

// "באשראי", "ב-Bit" (לפני אות לועזית בא מקף)
export const viaMethod = (m: keyof typeof depositMethodLabel) => (m === 'bit' ? 'ב-Bit' : `ב${depositMethodLabel[m]}`)

export const confidenceLabel: Record<AiMeta['confidence'], string> = {
  low: 'ביטחון נמוך',
  medium: 'ביטחון בינוני',
  high: 'ביטחון גבוה',
}

export const confidenceTone: Record<AiMeta['confidence'], Tone> = {
  low: 'warning',
  medium: 'brand',
  high: 'success',
}

export const sunLabel = { low: 'נמוכה', medium: 'בינונית', high: 'גבוהה' } as const

export function firstName(name?: string) {
  if (!name) return ''
  const clean = name.trim()
  // "משפחת גולדברג" נשאר כמו שהוא
  if (/^משפחת\s/.test(clean)) return clean
  return clean.split(/\s+/)[0]
}

export function caseContact(k: Case | undefined, contacts: Contact[]): Contact | undefined {
  if (!k) return undefined
  const mine = contacts.filter((c) => k.contactIds.includes(c.id))
  return mine.find((c) => c.primary) ?? mine[0] ?? contacts.find((c) => c.customerId === k.customerId && c.primary)
}

export function greetName(contact?: Contact, customer?: Customer) {
  return firstName(contact?.name) || firstName(customer?.name) || ''
}

export interface LineGroup {
  key: string
  label: string
  lines: QuoteLine[]
}

// קיבוץ שורות לפי חדר; שורות בלי חדר (עבודה, צנרת וכו׳) בסוף
export function groupByRoom(lines: QuoteLine[], generalLabel = 'עבודה, חומרים ואביזרים'): LineGroup[] {
  const groups: LineGroup[] = []
  for (const l of lines) {
    const key = l.room?.trim() || ''
    let g = groups.find((x) => x.key === key)
    if (!g) {
      g = { key, label: key || generalLabel, lines: [] }
      groups.push(g)
    }
    g.lines.push(l)
  }
  return [...groups.filter((g) => g.key), ...groups.filter((g) => !g.key)]
}

// ההצעה שהלקוח רואה: המאושרת, ואם אין, הגרסה האחרונה שנשלחה
export function customerQuote(quotes: Quote[], caseId: string): Quote | undefined {
  const list = quotes.filter((q) => q.caseId === caseId && q.status !== 'draft')
  const approved = list.find((q) => q.status === 'approved')
  if (approved) return approved
  return [...list].sort((a, b) => b.version - a.version || b.createdAt.localeCompare(a.createdAt))[0]
}

export const isQuoteExpired = (q: Pick<Quote, 'validUntil' | 'status'>) =>
  q.status === 'expired' || (q.validUntil < ymd() && !['approved', 'rejected'].includes(q.status))

export const isQuoteLocked = (q: Pick<Quote, 'status'>) => q.status === 'approved' || q.status === 'rejected'

// כתובת יחסית לאפליקציה (עובד גם בתת-נתיב), לפתיחה בלשונית חדשה
export function appUrl(path: string) {
  const base = window.location.href.split('#')[0]
  return `${base}#${path.startsWith('/') ? path : '/' + path}`
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
