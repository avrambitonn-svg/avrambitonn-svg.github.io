// החיבור ל-Supabase: התחברות (Auth), מסד הנתונים (RPC), עדכונים בזמן אמת (Realtime), ופונקציית ה-Edge "api".
// הבנייה קובעת את המצב: עם VITE_SUPABASE_URL ו-VITE_SUPABASE_KEY המערכת עובדת מול המסד המשותף (כניסה עם סיסמה);
// בלעדיהם היא גרסת ההדגמה, והנתונים נשמרים בדפדפן בלבד. ראו genair/supabase/CONTRACT.md.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL ?? '').trim().replace(/\/$/, '')
export const SUPABASE_KEY = String(import.meta.env.VITE_SUPABASE_KEY ?? '').trim()

/** המערכת נבנתה מול Supabase (מסד משותף, התחברות) */
export const serverMode = Boolean(SUPABASE_URL && SUPABASE_KEY)

/** בסיס הכתובות של פונקציית ה-Edge: `${functionsBase}/api/...` (אותם נתיבים כמו בשרת הקודם) */
export const functionsBase = serverMode ? `${SUPABASE_URL}/functions/v1` : ''

/** המפתח שבו supabase-js שומר את ההתחברות ב-localStorage */
export const AUTH_STORAGE_KEY = 'genair-auth'

/**
 * האימייל של חשבון ההתחברות, נגזר ממה שהעובד מקליד: עם @ = האימייל באותיות קטנות;
 * אחרת טלפון (ספרות בלבד, 972 בהתחלה הופך ל-0) → `<טלפון>@phone.genair.app`.
 */
export function loginEmail(input: string): string {
  const v = String(input ?? '').trim()
  if (v.includes('@')) return v.toLowerCase()
  const phone = v.replace(/\D/g, '').replace(/^972/, '0')
  return `${phone}@phone.genair.app`
}

/** הלקוח של Supabase (רק בבנייה מול Supabase; בהדגמה null) */
export const supabase: SupabaseClient | null = serverMode
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: AUTH_STORAGE_KEY },
    })
  : null

/** הלקוח, כשבטוח שהמערכת במצב משותף */
export function sb(): SupabaseClient {
  if (!supabase) throw new Error('המערכת לא חוברה ל-Supabase')
  return supabase
}

/** האם שמורה במכשיר התחברות (קריאה מיידית, לפני ש-supabase-js סיים לטעון) */
export function storedAccessToken(): string | undefined {
  if (!serverMode) return undefined
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY)
    if (!raw) return undefined
    const s = JSON.parse(raw) as { access_token?: string; refresh_token?: string }
    return s?.refresh_token ? s.access_token : undefined
  } catch {
    return undefined
  }
}
