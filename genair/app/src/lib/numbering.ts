// מספור תיקים: רץ גלובלי (GN-260143) או לפי ראשי התיבות של הסוכן (DM-0073), לפי הגדרות ← רשימות ← מספור תיקים
import { app } from './store'
import type { Config, DB, ID, User } from './types'

// אות עברית ← אות לטינית (לראשי תיבות של סוכן: דוד מזרחי ← DM)
const heToLatin: Record<string, string> = {
  א: 'A', ב: 'B', ג: 'G', ד: 'D', ה: 'H', ו: 'V', ז: 'Z', ח: 'H', ט: 'T', י: 'Y', כ: 'K', ך: 'K', ל: 'L', מ: 'M', ם: 'M', נ: 'N', ן: 'N',
  ס: 'S', ע: 'A', פ: 'P', ף: 'P', צ: 'T', ץ: 'T', ק: 'K', ר: 'R', ש: 'S', ת: 'T',
}
const titles = new Set(['ד״ר', 'ד"ר', 'דר׳', 'הרב', 'רב', 'מר', 'גב׳', 'עו״ד', 'אינג׳'])

// ראשי התיבות של משתמש: מה שהוגדר לו, ואם לא, משתי המילים הראשונות של השם
export function userInitials(u: Pick<User, 'name' | 'initials'>): string {
  const set = u.initials?.replace(/[^A-Za-z]/g, '').toUpperCase()
  if (set) return set.slice(0, 4)
  const words = u.name.trim().split(/\s+/).filter((w) => !titles.has(w))
  const out = words.slice(0, 2).map((w) => {
    const ch = w.replace(/["'׳״]/g, '')[0] ?? ''
    return /[A-Za-z]/.test(ch) ? ch.toUpperCase() : heToLatin[ch] ?? ''
  }).join('')
  return out || 'XX'
}

const yy = () => String(new Date().getFullYear()).slice(2)
type Numbering = Config['caseNumbering']

// המפתח של המונה והקידומת למספר הבא
function scheme(n: Numbering, users: User[], agentId?: ID): { key: string; prefix: string; pad: number } {
  const pad = Math.max(2, Math.min(8, n.pad || 4))
  const agent = agentId ? users.find((u) => u.id === agentId) : undefined
  if (n.mode === 'agent' && agent) {
    const ini = userInitials(agent)
    return { key: `case:${ini}`, prefix: `${ini}-`, pad }
  }
  return { key: 'case', prefix: `${n.prefix ?? ''}${yy()}`, pad }
}

export function formatCaseNumber(n: Numbering, users: User[], counters: DB['counters'], agentId?: ID): string {
  const s = scheme(n, users, agentId)
  return `${s.prefix}${String((counters[s.key] ?? 0) + 1).padStart(s.pad, '0')}`
}

// המספר הבא בלי להקצות אותו (לתצוגה באשף)
export function peekCaseNumber(agentId?: ID): string {
  const { db } = app()
  return formatCaseNumber(db.config.caseNumbering, db.users, db.counters, agentId)
}

// הקצאת המספר הבא (מקדם את המונה)
export function nextCaseNumber(agentId?: ID): string {
  const s = app()
  const sc = scheme(s.db.config.caseNumbering, s.db.users, agentId)
  // דילוג על מספר שכבר נלקח ידנית
  let num = s.nextNumber(sc.key, sc.prefix, sc.pad)
  for (let guard = 0; guard < 50 && app().db.cases.some((k) => k.number === num); guard++) num = app().nextNumber(sc.key, sc.prefix, sc.pad)
  return num
}

export const caseNumberTaken = (num: string, exceptId?: ID) => app().db.cases.some((k) => k.number.trim() === num.trim() && k.id !== exceptId)
