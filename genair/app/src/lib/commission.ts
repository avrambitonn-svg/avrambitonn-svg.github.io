// עמלות: לפי כללי העמלה בהגדרות (סוכן, סוג פרויקט, אחוז, בסיס החישוב). הכלל המדויק ביותר קובע.
import { app } from './store'
import type { Case, CommissionRule } from './types'

// סוכן + סוג > סוכן > סוג > כללי
const specificity = (r: CommissionRule) => (r.agentId ? 2 : 0) + (r.projectType ? 1 : 0)

export function commissionRuleFor(k: Pick<Case, 'agentId' | 'projectType'>, rules: CommissionRule[] = app().db.config.commissionRules): CommissionRule | undefined {
  if (!k.agentId) return undefined
  return rules
    .filter((r) => r.active && (!r.agentId || r.agentId === k.agentId) && (!r.projectType || r.projectType === k.projectType))
    .sort((a, b) => specificity(b) - specificity(a))[0]
}

export const ruleText = (r: Pick<CommissionRule, 'pct' | 'base'>) => `${r.pct}%${r.base === 'profit' ? ' מהרווח' : ''}`

export function commissionFor(
  k: Pick<Case, 'agentId' | 'projectType'>,
  t: { net: number; profit: number },
  rules?: CommissionRule[],
): { pct: number; amount: number; label: string; base: CommissionRule['base']; ruleId: string; ruleName: string } | null {
  const r = commissionRuleFor(k, rules)
  if (!r) return null
  const base = r.base === 'profit' ? Math.max(0, t.profit) : t.net
  return { pct: r.pct, amount: Math.round((base * r.pct) / 100), label: ruleText(r), base: r.base, ruleId: r.id, ruleName: r.name }
}
