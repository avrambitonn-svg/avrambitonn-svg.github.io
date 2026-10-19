import type { CatalogItem, Quote, QuoteLine } from './types'
import { brand } from '../brand'

export interface QuoteTotals {
  subtotal: number
  discount: number
  net: number
  vat: number
  total: number
  cost: number
  profit: number
  marginPct: number
}

export function lineTotal(l: QuoteLine) {
  return round2(l.qty * l.unitPrice)
}

export function totals(q: Pick<Quote, 'lines' | 'discountPct' | 'vatPct'>, catalog: CatalogItem[] = []): QuoteTotals {
  const subtotal = round2(q.lines.reduce((s, l) => s + lineTotal(l), 0))
  const discount = round2((subtotal * (q.discountPct || 0)) / 100)
  const net = round2(subtotal - discount)
  const vat = round2((net * q.vatPct) / 100)
  const cost = round2(
    q.lines.reduce((s, l) => {
      const item = catalog.find((c) => c.id === l.itemId)
      // שורה בלי פריט מקטלוג: מניחים עלות של 60% מהמחיר
      return s + l.qty * (item ? item.cost : l.unitPrice * 0.6)
    }, 0),
  )
  const profit = round2(net - cost)
  return { subtotal, discount, net, vat, total: round2(net + vat), cost, profit, marginPct: net ? (profit / net) * 100 : 0 }
}

export const round2 = (n: number) => Math.round(n * 100) / 100

export const defaultTerms = [
  'המחירים אינם כוללים מע"מ, אלא אם צוין אחרת.',
  'תוקף ההצעה 14 יום ממועד הוצאתה.',
  `אחריות יצרן על היחידות לפי תעודת האחריות, ואחריות ${brand.name} על ההתקנה ל-12 חודשים.`,
  'עבודות חשמל ובנייה שאינן מפורטות בהצעה יחויבו בנפרד, באישור הלקוח מראש.',
  'מקדמה בגובה 20% עם אישור ההצעה, והיתרה עם סיום ההתקנה.',
].join('\n')
