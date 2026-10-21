// מי נכנס לאיזה מסך. אותה רשימה משמשת את התפריט (Layout), את השמירה על הנתיבים (RequireRole) ואת הקישורים בתוך המסכים.
// זו לא אבטחה: השרת מסנן את הנתונים לפי תפקיד. כאן רק לא מציגים מסך שהתפקיד לא אמור לראות.
import type { Role } from './types'

export const MANAGERS: Role[] = ['admin', 'office']
export const STAFF: Role[] = ['admin', 'office', 'agent', 'engineer'] // כולם חוץ ממתקין

/** הנתיב הראשון בכתובת ← התפקידים שמורשים. נתיב שלא מופיע פתוח לכולם. */
export const routeRoles: Record<string, Role[]> = {
  cases: STAFF, // התיק עצמו (/cases/:id) פתוח גם למתקין: מגיעים אליו מהעבודה בשטח ומהלו״ז
  customers: STAFF, // כנ״ל כרטיס הלקוח (מקריאת שירות)
  quotes: STAFF,
  projects: STAFF,
  contracts: ['admin', 'office', 'agent'],
  inventory: ['admin', 'office', 'installer'],
  suppliers: ['admin', 'office', 'engineer'],
  users: MANAGERS,
  reports: MANAGERS,
  settings: MANAGERS,
}

/** האם התפקיד יכול לפתוח את הנתיב (למשל '/contracts' או '/suppliers?tab=orders') */
export function canOpen(path: string, role?: Role): boolean {
  const first = path.replace(/^[#/]+/, '').split(/[/?#]/)[0]
  const roles = routeRoles[first]
  return !roles || (!!role && roles.includes(role))
}
