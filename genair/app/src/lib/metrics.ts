// סדרות חודשיות לגרפים בדשבורד ובדוחות. הכל מחושב מהרשומות, בלי טבלאות סיכום נפרדות.
import { totals } from './quote'
import { ymd } from './format'
import type { DB, Quote } from './types'

export interface Month { key: string; date: Date; label: string; from: string; to: string }

const monthShort = new Intl.DateTimeFormat('he-IL', { month: 'short' })
const monthYear = new Intl.DateTimeFormat('he-IL', { month: 'short', year: '2-digit' })

// n חודשים שמסתיימים בחודש של end (כולל)
export function lastMonths(n: number, end: Date = new Date(), withYear = n > 12): Month[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(end.getFullYear(), end.getMonth() - (n - 1 - i), 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    return { key, date: d, label: (withYear ? monthYear : monthShort).format(d), from: `${key}-01`, to: ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0)) }
  })
}

export const dayOf = (iso?: string) => (!iso ? '' : iso.length > 10 ? ymd(iso) : iso)

// כמה פריטים נפלו בכל חודש לפי שדה תאריך
export function countByMonth<T>(items: T[], at: (x: T) => string | undefined, months: Month[]) {
  const idx = new Map(months.map((m, i) => [m.key, i]))
  const out = months.map(() => 0)
  for (const x of items) {
    const i = idx.get(dayOf(at(x)).slice(0, 7))
    if (i !== undefined) out[i]++
  }
  return out
}

export function sumByMonth<T>(items: T[], at: (x: T) => string | undefined, val: (x: T) => number, months: Month[]) {
  const idx = new Map(months.map((m, i) => [m.key, i]))
  const out = months.map(() => 0)
  for (const x of items) {
    const i = idx.get(dayOf(at(x)).slice(0, 7))
    if (i !== undefined) out[i] += val(x)
  }
  return out
}

// הכנסות ורווח גולמי מהצעות שאושרו, לפי חודש האישור
export function revenueByMonth(db: DB, months: Month[], keep: (q: Quote) => boolean = () => true) {
  const approved = db.quotes.filter((q) => q.status === 'approved' && keep(q))
  const t = new Map(approved.map((q) => [q.id, totals(q, db.catalog)]))
  return {
    revenue: sumByMonth(approved, (q) => q.decidedAt, (q) => t.get(q.id)!.net, months),
    profit: sumByMonth(approved, (q) => q.decidedAt, (q) => t.get(q.id)!.profit, months),
  }
}
