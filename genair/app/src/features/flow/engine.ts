// מנוע הפלואו: מתחיל פלואו בפתיחת תיק ומקדם שלבים כשהתיק מתקדם בצנרת
import type { Case, CaseStage } from '../../lib/types'

export function onCaseCreated(k: Case): void {
  void k
}

export function onStageChanged(k: Case, from: CaseStage, to: CaseStage): void {
  void k
  void from
  void to
}
