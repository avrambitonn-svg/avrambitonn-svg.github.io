// עמלות: לפי כללי העמלה בהגדרות (סוכן, סוג פרויקט, אחוז, בסיס החישוב)
import { app } from './store'
import type { Case } from './types'

export function commissionFor(k: Case, t: { net: number; profit: number }): { pct: number; amount: number; label: string } | null {
  if (!k.agentId) return null
  const pct = app().settings.commissionPct
  return { pct, amount: Math.round((t.net * pct) / 100), label: `${pct}%` }
}
