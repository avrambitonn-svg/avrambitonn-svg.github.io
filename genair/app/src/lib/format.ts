// עיצוב מספרים, תאריכים וטלפונים לעברית

const ils = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 })
const ils2 = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = new Intl.NumberFormat('he-IL')

export const money = (n: number, cents = false) => (cents ? ils2 : ils).format(Number.isFinite(n) ? n : 0)
export const number = (n: number) => num.format(n)
export const pct = (n: number) => `${Math.round(n)}%`

export function uid(prefix = ''): string {
  const r = crypto.getRandomValues(new Uint32Array(2))
  return `${prefix}${r[0].toString(36)}${r[1].toString(36)}`.slice(0, 16)
}

export function token(len = 18): string {
  const abc = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const r = crypto.getRandomValues(new Uint8Array(len))
  return Array.from(r, (b) => abc[b % abc.length]).join('')
}

export const nowIso = () => new Date().toISOString()

// YYYY-MM-DD בשעון מקומי
export function ymd(d: Date | string = new Date()): string {
  const x = typeof d === 'string' ? new Date(d) : d
  const m = String(x.getMonth() + 1).padStart(2, '0')
  const day = String(x.getDate()).padStart(2, '0')
  return `${x.getFullYear()}-${m}-${day}`
}

export function addDays(d: Date | string, days: number): Date {
  const x = typeof d === 'string' ? new Date(d) : new Date(d.getTime())
  x.setDate(x.getDate() + days)
  return x
}

export function atTime(day: Date | string, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number)
  const x = typeof day === 'string' ? new Date(day + (day.length === 10 ? 'T00:00:00' : '')) : new Date(day.getTime())
  x.setHours(h, m, 0, 0)
  return x
}

const dFmt = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'numeric', year: '2-digit' })
const dLong = new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })
const dShortDay = new Intl.DateTimeFormat('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric' })
const tFmt = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit' })
const monthFmt = new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric' })

const asDate = (d: Date | string) => (typeof d === 'string' ? new Date(d.length === 10 ? d + 'T00:00:00' : d) : d)

export const date = (d?: Date | string) => (d ? dFmt.format(asDate(d)) : '—')
export const dateLong = (d: Date | string) => dLong.format(asDate(d))
export const dateShortDay = (d: Date | string) => dShortDay.format(asDate(d))
export const time = (d: Date | string) => tFmt.format(asDate(d))
export const monthTitle = (d: Date | string) => monthFmt.format(asDate(d))
export const dateTime = (d?: Date | string) => (d ? `${date(d)} ${time(d)}` : '—')

export function sameDay(a: Date | string, b: Date | string) {
  return ymd(asDate(a)) === ymd(asDate(b))
}

export function relative(d: Date | string): string {
  const diff = (asDate(d).getTime() - Date.now()) / 1000
  const abs = Math.abs(diff)
  const rtf = new Intl.RelativeTimeFormat('he', { numeric: 'auto' })
  if (abs < 60) return 'עכשיו'
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour')
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day')
  return date(d)
}

export function daysBetween(a: Date | string, b: Date | string) {
  return Math.round((asDate(b).getTime() - asDate(a).getTime()) / 86400000)
}

// טלפון ישראלי: 054-1234567
export function phone(p?: string): string {
  if (!p) return '—'
  const d = p.replace(/\D/g, '').replace(/^972/, '0')
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3)}`
  if (d.length === 9) return `${d.slice(0, 2)}-${d.slice(2)}`
  return p
}

// 05X... -> 9725X... (לוואטסאפ)
export function intlPhone(p: string): string {
  const d = p.replace(/\D/g, '')
  if (d.startsWith('972')) return d
  if (d.startsWith('0')) return '972' + d.slice(1)
  return d
}

export function initials(name: string): string {
  const parts = name.replace(/["'׳״]/g, '').trim().split(/\s+/)
  return (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')
}

export function clamp(n: number, a: number, b: number) {
  return Math.min(b, Math.max(a, n))
}

export function sum<T>(arr: T[], f: (x: T) => number) {
  return arr.reduce((s, x) => s + f(x), 0)
}
