// הגשר בין מאגר הנתונים (store.ts) למנוע הסנכרון. בלי תלות ב-store, כדי שלא תהיה תלות מעגלית.
// כאן נשמרים גם מצב העבודה (הדגמה מקומית / מסד נתונים משותף), כתובת השרת והחיבור של המשתמש.

export type SyncMode = 'local' | 'server'

export interface SyncConfig {
  mode: SyncMode
  serverUrl: string
  token?: string
  userId?: string
  expiresAt?: string
  // נשמרו כאן בגרסאות קודמות; נמחקים בטעינה (store.ts)
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
// בבנייה לייצור: VITE_SERVER_URL קובע שרת ברירת מחדל, והמערכת נפתחת במצב משותף עם התחברות
export const ENV_SERVER = String(import.meta.env.VITE_SERVER_URL ?? '').trim().replace(/\/$/, '')

export function readSyncConfig(): SyncConfig {
  let c: Partial<SyncConfig> = {}
  try {
    c = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<SyncConfig>
  } catch {
    c = {}
  }
  const mode: SyncMode = c.mode ?? (ENV_SERVER ? 'server' : 'local')
  return { ...c, mode, serverUrl: (c.serverUrl || ENV_SERVER || '').replace(/\/$/, '') }
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
 * השרת שמשמש את הדפים הציבוריים (אזור אישי, טופס פנייה). ?server= בקישור מתקבל רק אם הוא השרת שהוגדר בבנייה,
 * השרת שכבר מוגדר בדפדפן הזה, או שרת מקומי לפיתוח — כדי שאי אפשר יהיה להפנות לקוח לשרת זר דרך הדומיין שלנו.
 */
export function publicServerUrl(param?: string | null): string {
  const c = readSyncConfig()
  const known = [ENV_SERVER, c.mode === 'server' ? c.serverUrl : ''].filter(Boolean)
  const q = (param ?? '').trim().replace(/\/$/, '')
  if (q && (known.includes(q) || isLocalhost(q))) return q
  return known[0] ?? ''
}

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
