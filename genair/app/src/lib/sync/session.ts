// התחברות למסד הנתונים המשותף (Supabase Auth): כניסה, יציאה, החלפת סיסמה, הקמה ראשונה,
// קריאות למסד (RPC, db_*) וקריאות לפונקציית ה-Edge "api" עם הטוקן של המשתמש. ראו genair/supabase/CONTRACT.md.
import { create } from 'zustand'
import type { User } from '../types'
import { readSyncConfig, writeSyncConfig } from './bridge'
import { AUTH_STORAGE_KEY, SUPABASE_KEY, functionsBase, loginEmail, sb, serverMode, storedAccessToken, supabase } from './supabase'

export class SyncError extends Error {
  status: number
  code?: string
  reason?: string
  constructor(message: string, status: number, code?: string, reason?: string) {
    super(message)
    this.status = status
    this.code = code
    this.reason = reason
  }
}

interface SessionState {
  token?: string // טוקן הגישה הנוכחי של Supabase (קיים = מחובר)
  userId?: string
  mustChange?: boolean
  notice?: string // למה החיבור נגמר (מוצג במסך הכניסה)
}

/** למה החיבור נגמר: פג תוקף (אותו משתמש נכנס שוב והתור נשלח), או בוטל (משתמש הושבת או הוסר מהארגון) */
export type EndReason = 'expired' | 'revoked' | 'missing'

/** הסיבה מתשובת 401 של פונקציית ה-Edge: details.reason = 'revoked' → בוטל; אחרת פג תוקף */
export function endReason(err: { code?: string; message?: string; reason?: string } | null | undefined): EndReason {
  const r = err?.reason
  if (r === 'expired' || r === 'revoked' || r === 'missing') return r
  return 'expired'
}

export const noticeFor = (reason: EndReason) =>
  reason === 'expired'
    ? 'פג תוקף ההתחברות. נכנסים שוב, ומה שנשמר במכשיר יישלח.'
    : 'הגישה למערכת בוטלה (למשל המשתמש הושבת). הנתונים נמחקו מהמכשיר הזה.'

// מצב החיבור (מגיב לשינויים: כניסה, יציאה, פג תוקף). בפתיחה: ההתחברות השמורה, בלי לחכות לרשת
export const useSession = create<SessionState>(() => {
  const c = readSyncConfig()
  const token = storedAccessToken()
  return { token: token && c.userId ? token : undefined, userId: c.userId, mustChange: token ? Boolean(c.mustChange) : false }
})

/** בסיס הכתובות של פונקציית ה-Edge (משמש גם כמפתח לתור ולמספרים השמורים במכשיר) */
export const serverBase = () => functionsBase

let onSignedOut: ((reason: EndReason) => void) | null = null
export const setSignedOutHandler = (fn: (reason: EndReason) => void) => {
  onSignedOut = fn
}

let quiet = 0 // > 0 בזמן יציאה מכוונת: אין הודעת "פג תוקף"
let loggingIn = false // בזמן כניסה: המצב נקבע רק אחרי db_me
let ending = false

export function clearSession() {
  writeSyncConfig({ token: undefined, expiresAt: undefined, mustChange: undefined })
  useSession.setState({ token: undefined, mustChange: false })
}

/** מסיים את ההתחברות של המכשיר הזה ב-Supabase (רק הסשן הזה, לא מכשירים אחרים של המשתמש) */
async function dropAuth() {
  if (!supabase) return
  quiet++
  try {
    await supabase.auth.signOut({ scope: 'local' })
  } catch {
    /* בלי רשת */
  } finally {
    quiet--
  }
  // אם supabase-js לא הצליח לקרוא את הסשן (למשל בלי רשת), מוחקים אותו ידנית
  try {
    if (storedAccessToken()) localStorage.removeItem(AUTH_STORAGE_KEY)
  } catch {
    /* */
  }
}

/** החיבור נגמר בלי שהמשתמש ביקש: מנוע הסנכרון מטפל (שומר או מוחק את העותק המקומי), ואז יוצאים מ-Supabase */
function endSession(reason: EndReason) {
  if (ending) return
  ending = true
  void (async () => {
    try {
      if (onSignedOut) onSignedOut(reason)
      else {
        clearSession()
        useSession.setState({ notice: noticeFor(reason) })
      }
      await dropAuth()
    } finally {
      ending = false
    }
  })()
}

function applyMe(me: { user: User; mustChange?: boolean }, token: string) {
  writeSyncConfig({ userId: me.user.id, mustChange: me.mustChange ? true : undefined, token: undefined, expiresAt: undefined })
  useSession.setState({ token, userId: me.user.id, mustChange: Boolean(me.mustChange), notice: undefined })
}

/** התחברות שמורה בלי משתמש ידוע (למשל כניסה בלשונית אחרת): מבררים מי זה */
async function resume(token: string) {
  try {
    const { data, error } = await sb().rpc('db_me')
    const me = data as { user: User | null; mustChange: boolean } | null
    if (error || !me?.user) {
      if (error?.code === '42501' && error.details === 'revoked') endSession('revoked')
      return
    }
    applyMe({ user: me.user, mustChange: me.mustChange }, token)
  } catch {
    /* ננסה בפעם הבאה */
  }
}

// מקור האמת להתחברות: האירועים של supabase-js (כניסה, חידוש טוקן, יציאה, כישלון בחידוש)
if (supabase) {
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      if (quiet || loggingIn) return
      // הטוקן לא חודש (סשן בוטל או פג) או יציאה בלשונית אחרת: הנתונים במכשיר נשארים
      if (useSession.getState().token) setTimeout(() => endSession('expired'), 0)
      else clearSession()
      return
    }
    if (!session) {
      // פתיחה בלי התחברות שמורה. בלי רשת supabase-js עשוי לדווח "אין סשן" אף שהוא שמור: אז ממשיכים לעבוד מהעותק
      if (event === 'INITIAL_SESSION' && !storedAccessToken() && useSession.getState().token) clearSession()
      return
    }
    if (loggingIn) return
    const st = useSession.getState()
    if (st.token) {
      if (st.token !== session.access_token) useSession.setState({ token: session.access_token })
    } else if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
      // אסור לקרוא ל-supabase מתוך האירוע עצמו (נעילה): מבררים את המשתמש אחרי שהאירוע הסתיים
      const token = session.access_token
      setTimeout(() => void resume(token), 0)
    }
  })
}

// ---------------------------------------------------------------- קריאות למסד (RPC)

interface PgError {
  code?: string
  message?: string
  details?: string | null
}

function rpcError(error: PgError, status: number): SyncError {
  const code = error.code ?? ''
  if (code === '42501' && error.details === 'revoked') {
    endSession('revoked')
    return new SyncError(error.message || 'הגישה בוטלה', 401, 'revoked', 'revoked')
  }
  if (code === '22023') return new SyncError(error.message || 'בקשה לא תקינה', 400, 'invalid')
  if (code === '42501') return new SyncError(error.message || 'אין הרשאה', 403, 'denied')
  // טוקן שפג (שעון לא מדויק, למשל): מחדשים ומנסים שוב בסבב הבא. אם החידוש נכשל, supabase-js מודיע SIGNED_OUT
  if (status === 401 || code === 'PGRST301' || code === 'PGRST303') {
    void sb().auth.refreshSession().catch(() => {})
    return new SyncError('מחדשים את ההתחברות...', 0, 'jwt')
  }
  if (!status) return new SyncError('אין חיבור לשרת', 0, 'network')
  return new SyncError(error.message || `שגיאה ${status}`, status, code || undefined)
}

/** קריאה לפונקציה במסד בשם המשתמש המחובר. שגיאות: 400 = בקשה פסולה (22023), 401 = הגישה בוטלה, 0 = אין חיבור */
export async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const client = sb()
  let hasSession = false
  try {
    hasSession = Boolean((await client.auth.getSession()).data.session)
  } catch {
    throw new SyncError('אין חיבור לשרת', 0, 'network')
  }
  // בלי סשן (למשל חידוש שנכשל בגלל רשת) לא קוראים בכלל: הקריאה הייתה יוצאת כאנונימית ונענית "בוטל"
  if (!hasSession) throw new SyncError('אין חיבור לשרת', 0, 'no_session')
  let res: { data: unknown; error: PgError | null; status: number }
  try {
    res = await client.rpc(fn, args)
  } catch {
    throw new SyncError('אין חיבור לשרת', 0, 'network')
  }
  if (res.error) throw rpcError(res.error, res.status)
  return res.data as T
}

// ---------------------------------------------------------------- פונקציית ה-Edge "api"

async function parse(res: Response) {
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!res.ok) {
    const err = (body as { error?: { message?: string; code?: string; reason?: string; details?: { reason?: string } } })?.error
    throw new SyncError(err?.message || `שגיאה ${res.status}`, res.status, err?.code, err?.reason ?? err?.details?.reason)
  }
  return body
}

/** הכותרות לקריאה לפונקציית ה-Edge: apikey תמיד, ו-Bearer עם הטוקן העדכני כשמחוברים */
export async function edgeHeaders(anonymous = false): Promise<Record<string, string>> {
  const h: Record<string, string> = { apikey: SUPABASE_KEY }
  if (!anonymous && supabase) {
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token
      if (token) h.authorization = `Bearer ${token}`
    } catch {
      /* בלי רשת: הקריאה תיכשל ממילא */
    }
  }
  return h
}

/** 401 מפונקציית ה-Edge כשהיינו מחוברים: details.reason = 'revoked' → בוטל, אחרת פג תוקף */
export function edgeUnauthorized(err: { reason?: string; code?: string; message?: string }) {
  endSession(endReason(err))
}

/** קריאה לפונקציית ה-Edge (`${functionsBase}${path}`) עם הטוקן. 401 מחזיר למסך הכניסה. */
export async function authFetch<T>(path: string, init: RequestInit & { json?: unknown; anonymous?: boolean } = {}): Promise<T> {
  if (!serverMode) throw new SyncError('המערכת לא מחוברת למסד משותף', 0, 'no_server')
  const { json, anonymous, ...rest } = init
  const headers: Record<string, string> = { ...(await edgeHeaders(anonymous)), ...(rest.headers as Record<string, string>) }
  if (json !== undefined) headers['content-type'] = 'application/json'
  let res: Response
  try {
    res = await fetch(functionsBase + path, { ...rest, headers, body: json !== undefined ? JSON.stringify(json) : rest.body })
  } catch {
    throw new SyncError('אין חיבור לשרת', 0, 'network')
  }
  if (res.status === 401 && headers.authorization) {
    const err = (await parse(res).catch((e: SyncError) => e)) as SyncError
    edgeUnauthorized(err)
    throw err
  }
  return (await parse(res)) as T
}

// בלי התחברות הפונקציה מחזירה רק { ok, db }: הגרסה והחיבורים רק למשתמש מחובר
export interface ServerHealth {
  ok: boolean
  version?: string
  features?: { priority: string; ai: boolean; whatsapp: boolean; google: { calendar: boolean; drive: boolean } }
  db?: { mode: 'supabase' | 'file' | 'memory' | 'off'; ready?: boolean; bootstrapped?: boolean; bootstrapToken?: boolean }
}

export const serverHealth = (anonymous = !useSession.getState().token) => authFetch<ServerHealth>('/api/health', { anonymous })

// ---------------------------------------------------------------- כניסה, יציאה, סיסמה

function authError(e: { message?: string; code?: string; status?: number; name?: string } | null | undefined): SyncError {
  const code = e?.code ?? ''
  const status = e?.status ?? 0
  if (status === 429 || code === 'over_request_rate_limit') return new SyncError('יותר מדי ניסיונות. נסו שוב בעוד כמה דקות.', 429, code)
  if (code === 'invalid_credentials' || code === 'email_not_confirmed' || code === 'user_not_found' || status === 400) return new SyncError('הפרטים לא נכונים', 400, code || 'invalid_credentials')
  if (code === 'user_banned') return new SyncError('המשתמש חסום. פנו למנהל המערכת.', 403, code)
  if (!status || e?.name === 'AuthRetryableFetchError') return new SyncError('אין חיבור לשרת', 0, 'network')
  return new SyncError(e?.message || `שגיאה ${status}`, status, code || undefined)
}

/** כניסה עם טלפון נייד (או אימייל, למי שאין טלפון במערכת) וסיסמה */
export async function login(loginId: string, password: string): Promise<{ user: User; mustChange: boolean }> {
  const client = sb()
  const id = loginId.trim()
  if (!id.includes('@') && id.replace(/\D/g, '').length < 9) throw new SyncError('מספר הטלפון לא תקין', 400, 'invalid_phone')
  loggingIn = true
  try {
    let signed
    try {
      signed = await client.auth.signInWithPassword({ email: loginEmail(id), password })
    } catch (e) {
      throw authError(e as { message?: string })
    }
    if (signed.error || !signed.data.session) throw authError(signed.error)
    const { data, error } = await client.rpc('db_me')
    const me = data as { user: User | null; mustChange: boolean } | null
    if (error || !me?.user) {
      await dropAuth()
      if (error && error.code !== '42501') throw new SyncError(error.message || 'אין חיבור לשרת', 0, 'network')
      throw new SyncError('למשתמש הזה אין גישה למערכת (לא פעיל או לא שייך לארגון). פנו למנהל המערכת.', 403, 'revoked')
    }
    applyMe({ user: me.user, mustChange: me.mustChange }, signed.data.session.access_token)
    return { user: me.user, mustChange: Boolean(me.mustChange) }
  } finally {
    loggingIn = false
  }
}

/** יציאה מהמכשיר הזה (מכשירים אחרים של המשתמש נשארים מחוברים) */
export async function logout() {
  await dropAuth()
  clearSession()
}

/** סיסמה חדשה למשתמש המחובר (גם אחרי כניסה עם סיסמה זמנית). שאר המכשירים שלו מתנתקים. */
export async function changePassword(next: string) {
  const client = sb()
  const { error } = await client.auth.updateUser({ password: next })
  if (error) {
    const code = error.code ?? ''
    if (code === 'same_password') throw new SyncError('הסיסמה החדשה צריכה להיות שונה מהקודמת', 422, code)
    if (code === 'weak_password') throw new SyncError('הסיסמה חלשה מדי. בחרו סיסמה ארוכה יותר, עם אותיות ומספרים.', 422, code)
    if (code === 'reauthentication_needed') throw new SyncError('צריך להתחבר מחדש לפני החלפת הסיסמה', 401, code)
    throw authError(error)
  }
  await rpc('db_password_changed')
  await client.auth.signOut({ scope: 'others' }).catch(() => {})
  writeSyncConfig({ mustChange: undefined })
  useSession.setState({ mustChange: false })
}

/** הקמה ראשונה: הנתונים עולים למסד הריק, נוצר חשבון למנהל, ומתחברים איתו */
export async function bootstrapServer(payload: { snapshot: unknown; adminUserId: string; password: string; bootstrapToken: string }) {
  const r = await authFetch<{ session: { access_token: string; refresh_token: string; expires_in?: number }; user: User; seq: number }>('/api/auth/bootstrap', {
    anonymous: true,
    method: 'POST',
    json: payload,
  })
  loggingIn = true
  try {
    const { data, error } = await sb().auth.setSession({ access_token: r.session.access_token, refresh_token: r.session.refresh_token })
    if (error || !data.session) throw authError(error)
    applyMe({ user: r.user, mustChange: false }, data.session.access_token)
  } finally {
    loggingIn = false
  }
  return r
}

/** מנהל: קביעת סיסמה למשתמש. בלי סיסמה הפונקציה מחזירה סיסמה זמנית חד-פעמית, ואת הכניסה שנגזרה (טלפון או אימייל). */
export const setUserPassword = (userId: string, password?: string) =>
  authFetch<{ ok: true; temporaryPassword?: string; login?: string }>(`/api/auth/users/${encodeURIComponent(userId)}/password`, { method: 'POST', json: password ? { password } : {} })

export interface CredentialInfo {
  id: string
  hasPassword: boolean
  mustChange: boolean
  lastLoginAt: string | null
  passwordSetAt: string | null
  login?: string // האימייל של החשבון: <טלפון>@phone.genair.app או אימייל
}
export const listCredentials = () => authFetch<{ users: CredentialInfo[] }>('/api/auth/users')

/** הכניסה כפי שהעובד מקליד אותה: הטלפון (בלי הסיומת), או האימייל */
export const loginLabel = (login?: string) => (login ? login.replace(/@phone\.genair\.app$/i, '') : '')
