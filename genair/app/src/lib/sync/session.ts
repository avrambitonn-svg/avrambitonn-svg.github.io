// התחברות למסד הנתונים המשותף: כניסה, יציאה, החלפת סיסמה, הקמה ראשונה, וקריאות לשרת עם הטוקן של המשתמש
import { create } from 'zustand'
import type { User } from '../types'
import { readSyncConfig, writeSyncConfig } from './bridge'

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
  token?: string
  userId?: string
  mustChange?: boolean
  notice?: string // למה החיבור נגמר (מוצג במסך הכניסה)
}

/** למה השרת סיים את החיבור: פג תוקף (אותו משתמש נכנס שוב והתור נשלח), או בוטל (משתמש הושבת, סיסמה הוחלפה, יציאה ממכשיר אחר) */
export type EndReason = 'expired' | 'revoked' | 'missing'

/** הסיבה מתשובת 401 של השרת. בלי סיבה מפורשת: לפי ההודעה ("פג תוקף") */
export function endReason(err: { code?: string; message?: string; reason?: string } | null | undefined): EndReason {
  const r = err?.reason
  if (r === 'expired' || r === 'revoked' || r === 'missing') return r
  if (err?.code === 'session_expired' || /פג תוקף|expired/i.test(err?.message ?? '')) return 'expired'
  return 'revoked'
}

// מצב החיבור (מגיב לשינויים: כניסה, יציאה, פג תוקף)
export const useSession = create<SessionState>(() => {
  const c = readSyncConfig()
  return { token: c.token, userId: c.userId }
})

export const serverBase = () => readSyncConfig().serverUrl

function saveToken(token: string) {
  writeSyncConfig({ token })
  useSession.setState({ token })
}

let onSignedOut: ((reason: EndReason) => void) | null = null
export const setSignedOutHandler = (fn: (reason: EndReason) => void) => {
  onSignedOut = fn
}

export function clearSession() {
  writeSyncConfig({ token: undefined, expiresAt: undefined })
  useSession.setState({ token: undefined, mustChange: false })
}

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

/** קריאה לשרת עם הטוקן. טוקן מחודש (x-auth-token) נשמר; 401 מחזיר למסך הכניסה. */
export async function authFetch<T>(path: string, init: RequestInit & { json?: unknown; base?: string; anonymous?: boolean } = {}): Promise<T> {
  const base = (init.base ?? serverBase()).replace(/\/$/, '')
  if (!base) throw new SyncError('לא הוגדרה כתובת שרת', 0, 'no_server')
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) }
  const token = useSession.getState().token
  if (token && !init.anonymous) headers.authorization = `Bearer ${token}`
  if (init.json !== undefined) headers['content-type'] = 'application/json'
  let res: Response
  try {
    res = await fetch(base + path, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body })
  } catch {
    throw new SyncError('אין חיבור לשרת', 0, 'network')
  }
  const fresh = res.headers.get('x-auth-token')
  if (fresh && token && !init.anonymous) saveToken(fresh)
  if (res.status === 401 && token && !init.anonymous) {
    const err = (await parse(res).catch((e: SyncError) => e)) as SyncError
    clearSession()
    onSignedOut?.(endReason(err))
    throw err
  }
  return (await parse(res)) as T
}

// בלי התחברות השרת מחזיר רק { ok, db }: הגרסה והחיבורים רק למשתמש מחובר
export interface ServerHealth {
  ok: boolean
  version?: string
  features?: { priority: string; ai: boolean; whatsapp: boolean; google: { calendar: boolean; drive: boolean } }
  db?: { mode: 'file' | 'memory' | 'off'; ready?: boolean; bootstrapped?: boolean; bootstrapToken?: boolean }
}

export const serverHealth = (base: string) => authFetch<ServerHealth>('/api/health', { base, anonymous: true })

export async function login(base: string, loginId: string, password: string) {
  const r = await authFetch<{ token: string; expiresAt: string; user: User; mustChange: boolean }>('/api/auth/login', {
    base,
    anonymous: true,
    method: 'POST',
    json: { login: loginId, password },
  })
  writeSyncConfig({ serverUrl: base, token: r.token, userId: r.user.id, expiresAt: r.expiresAt })
  useSession.setState({ token: r.token, userId: r.user.id, mustChange: r.mustChange, notice: undefined })
  return r
}

export async function logout() {
  try {
    await authFetch('/api/auth/logout', { method: 'POST', json: {} })
  } catch {
    /* יוצאים גם בלי שרת */
  }
  clearSession()
}

export async function changePassword(current: string, next: string) {
  const r = await authFetch<{ token: string; expiresAt: string }>('/api/auth/password', { method: 'POST', json: { current, next } })
  saveToken(r.token)
  writeSyncConfig({ expiresAt: r.expiresAt })
  useSession.setState({ mustChange: false })
}

export async function bootstrapServer(base: string, payload: { snapshot: unknown; adminUserId: string; password: string; bootstrapToken?: string }) {
  const r = await authFetch<{ token: string; expiresAt: string; user: User; seq: number }>('/api/auth/bootstrap', { base, anonymous: true, method: 'POST', json: payload })
  writeSyncConfig({ serverUrl: base, token: r.token, userId: r.user.id, expiresAt: r.expiresAt })
  useSession.setState({ token: r.token, userId: r.user.id, mustChange: false })
  return r
}

/** מנהל: קביעת סיסמה למשתמש. בלי סיסמה השרת מחזיר סיסמה זמנית חד-פעמית. */
export const setUserPassword = (userId: string, password?: string) =>
  authFetch<{ ok: true; temporaryPassword?: string }>(`/api/auth/users/${encodeURIComponent(userId)}/password`, { method: 'POST', json: password ? { password } : {} })

export interface CredentialInfo {
  id: string
  hasPassword: boolean
  mustChange: boolean
  lastLoginAt: string | null
  passwordSetAt: string | null
}
export const listCredentials = () => authFetch<{ users: CredentialInfo[] }>('/api/auth/users')
