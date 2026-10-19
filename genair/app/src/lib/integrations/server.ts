// לקוח לשרת האינטגרציות (genair/server). בלי כתובת שרת המערכת עובדת במצב הדגמה.
import { app } from '../store'

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
  return Boolean(app().settings.serverUrl.trim())
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
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

export interface Health {
  ok: boolean
  version: string
  features: { priority: 'off' | 'demo' | 'live'; priorityWrite: boolean; ai: boolean; whatsapp: boolean; google: { calendar: boolean; drive: boolean } }
}

export const health = () => api<Health>('/api/health')
