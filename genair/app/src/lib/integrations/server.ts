// לקוח לאינטגרציות. במסד המשותף: פונקציית ה-Edge של Supabase (`${functionsBase}/api/...`) עם הטוקן של המשתמש.
// בהדגמה: שרת אינטגרציות אופציונלי (genair/server) לפי כתובת והאסימון APP_TOKEN; בלי כתובת — מצב הדגמה.
import { app } from '../store'
import { authFetch, type SyncError } from '../sync/session'
import { serverMode } from '../sync/supabase'

export class ServerError extends Error {
  status: number
  code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export function serverConfigured() {
  return serverMode || Boolean(app().settings.serverUrl.trim())
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  if (serverMode) {
    try {
      return await authFetch<T>(path, init)
    } catch (e) {
      const err = e as SyncError
      throw new ServerError(err.message, err.status ?? 0, err.code)
    }
  }
  const { serverUrl, appToken } = app().settings
  if (!serverUrl.trim()) throw new ServerError('לא הוגדר שרת אינטגרציות (הגדרות ← חיבורים)', 0, 'no_server')
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) }
  if (init.json !== undefined) headers['content-type'] = 'application/json'
  if (appToken) headers['x-app-token'] = appToken
  let res: Response
  try {
    res = await fetch(serverUrl.replace(/\/$/, '') + path, {
      ...init,
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    })
  } catch {
    throw new ServerError('אין חיבור לשרת האינטגרציות', 0, 'network')
  }
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!res.ok) {
    const err = (body as { error?: { message?: string; code?: string } })?.error
    throw new ServerError(err?.message || `שגיאה ${res.status}`, res.status, err?.code)
  }
  return body as T
}

// בלי התחברות (או בלי אסימון) השרת מחזיר רק { ok, db }: הגרסה והחיבורים רק למי שמחובר
export interface Health {
  ok: boolean
  version?: string
  features?: { priority: 'off' | 'demo' | 'live'; priorityWrite: boolean; ai: boolean; whatsapp: boolean; google: { calendar: boolean; drive: boolean } }
  db?: { mode: 'supabase' | 'file' | 'memory' | 'off'; ready?: boolean; bootstrapped?: boolean; bootstrapToken?: boolean }
}

export const health = () => api<Health>('/api/health')
