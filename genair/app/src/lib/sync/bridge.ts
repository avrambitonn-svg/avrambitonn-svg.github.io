// הגשר בין מאגר הנתונים (store.ts) למנוע הסנכרון. בלי תלות ב-store, כדי שלא תהיה תלות מעגלית.
// כאן נשמרים גם מצב העבודה (הדגמה מקומית / מסד נתונים משותף, לפי הבנייה) והמשתמש המחובר.
import { SUPABASE_KEY, functionsBase, serverMode } from './supabase'

export type SyncMode = 'local' | 'server'

export interface SyncConfig {
  mode: SyncMode
  serverUrl: string
  userId?: string // המשתמש (users) של ההתחברות השמורה
  mustChange?: boolean // נכנס עם סיסמה זמנית ועוד לא בחר סיסמה משלו
  // נשמרו כאן בגרסאות קודמות (השרת הקודם); נמחקים בטעינה
  token?: string
  expiresAt?: string
  appToken?: string
  anthropicKey?: string
}

export interface Op {
  op: 'upsert' | 'patch' | 'remove'
  collection: string
  id: string
  data?: Record<string, unknown>
  unset?: string[]
  at: number
  ifUnset?: string
}

const KEY = 'genair-sync-v1'

/**
 * הגדרות החיבור של המכשיר. המצב נקבע בבנייה: עם VITE_SUPABASE_URL המערכת תמיד במסד המשותף,
 * ובלעדיו תמיד הדגמה בדפדפן. serverUrl במצב משותף = בסיס פונקציית ה-Edge של Supabase.
 */
export function readSyncConfig(): SyncConfig {
  let c: Partial<SyncConfig> = {}
  try {
    c = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<SyncConfig>
  } catch {
    c = {}
  }
  const mode: SyncMode = serverMode ? 'server' : 'local'
  return { ...c, mode, serverUrl: serverMode ? functionsBase : '' }
}

export function writeSyncConfig(p: Partial<SyncConfig>): SyncConfig {
  const next = { ...readSyncConfig(), ...p }
  for (const k of Object.keys(next) as (keyof SyncConfig)[]) if (next[k] === undefined) delete next[k]
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* מצב גלישה פרטית */
  }
  return next
}

const isLocalhost = (u: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(u)

/**
 * השרת שמשמש את הדפים הציבוריים (אזור אישי, טופס פנייה): בבנייה מול Supabase — פונקציית ה-Edge (?server= לא משנה).
 * בהדגמה: ריק (הדפים עובדים מהנתונים שבדפדפן), או שרת מקומי לפיתוח דרך ?server=.
 */
export function publicServerUrl(param?: string | null): string {
  if (serverMode) return functionsBase
  const q = (param ?? '').trim().replace(/\/$/, '')
  return q && isLocalhost(q) ? q : ''
}

/** כותרות לקריאה ציבורית לפונקציית ה-Edge (בלי התחברות) */
export const publicHeaders = (): Record<string, string> => (serverMode ? { apikey: SUPABASE_KEY } : {})

type Listener = (ops: Op[]) => void

export const bridge = {
  mode: readSyncConfig().mode as SyncMode,
  /** > 0 בזמן החלת שינויים מהשרת: לא יוצאות פעולות */
  remote: 0,
  /** > 0 בתוך פעולה של ה-store, שכבר שלחה את הפעולות שלה */
  depth: 0,
  listener: null as Listener | null,
  /** פעולות שנוצרו לפני שהמנוע עלה */
  early: [] as Op[],
  /** מספרים שמורים מהשרת (nextNumber) */
  takeNumber: null as null | ((key: string) => number | null),
  /** "איפוס" במצב משותף: טעינה מחדש מהשרת */
  resync: null as null | (() => void),
  /** שעון מתוקן לפי השרת */
  clock: () => Date.now(),
  emit(ops: (Op | null | undefined)[]) {
    if (this.mode !== 'server' || this.remote) return
    const list = ops.filter(Boolean) as Op[]
    if (!list.length) return
    if (this.listener) this.listener(list)
    else this.early.push(...list)
  },
}

/** מריץ עדכון שמגיע מהשרת בלי ליצור פעולות חדשות */
export function asRemote<T>(fn: () => T): T {
  bridge.remote++
  try {
    return fn()
  } finally {
    bridge.remote--
  }
}
