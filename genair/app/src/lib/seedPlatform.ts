// נתוני הדגמה: משתמשים עם פונקציות, יומנים אישיים, קבצים. מקבל את מסד הנתונים אחרי הבנייה הבסיסית ומשלים אותו במקום.
// סיסמאות לא נשמרות כאן: הן נקבעות בשרת, בהקמה הראשונה ובעמוד המשתמשים.
import type { DB, UserFunction } from './types'

const functions: Record<string, UserFunction[]> = {
  'u-office': ['department_manager'],
  'u-eng': ['project_manager'],
}

export function applyPlatformSeed(db: DB): void {
  for (const u of db.users) if (functions[u.id]) u.functions = functions[u.id]
}
