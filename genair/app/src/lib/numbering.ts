// מספור תיקים: רץ גלובלי (GN-260143) או לפי ראשי התיבות של הסוכן (DM-0073), לפי הגדרות ← רשימות
import { app } from './store'
import type { ID } from './types'

export function nextCaseNumber(agentId?: ID): string {
  void agentId
  const yy = String(new Date().getFullYear()).slice(2)
  return app().nextNumber('case', `GN-${yy}`, 4)
}
