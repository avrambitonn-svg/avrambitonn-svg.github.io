// יומן גוגל ו-Drive דרך שרת האינטגרציות (רק במצב "סנכרון מלא"). במצב קישורים לא קורה כלום ברקע.
// יומן: אירוע ביומן האישי של כל משתתף (User.googleCalendarId), ואם אין לאף אחד — ביומן של החברה.
// Drive: לכל תיק תיקייה עם תיקיות המשנה מההגדרות (משרד, לקוח, מתקין...), וכל קובץ עולה לתיקייה שלו.
import { app } from '../store'
import { api, serverConfigured, ServerError } from './server'
import { addressText } from './links'
import type { Appointment, Case, ID } from '../types'

const apiMode = () => app().settings.googleMode === 'api' && serverConfigured()
export const googleApiMode = apiMode

const DEFAULT = '_default' // מפתח האירוע ביומן של החברה

interface Target {
  key: string
  calendarId?: string
}

function targets(ap: Appointment): Target[] {
  const users = app().db.users
  const list = ap.userIds.map((id) => users.find((u) => u.id === id)).filter((u) => u?.googleCalendarId).map((u) => ({ key: u!.id, calendarId: u!.googleCalendarId }))
  return list.length ? list : [{ key: DEFAULT }]
}

const calendarOf = (key: string) => (key === DEFAULT ? undefined : app().db.users.find((u) => u.id === key)?.googleCalendarId)

function eventBody(ap: Appointment) {
  const s = app()
  const c = s.db.customers.find((x) => x.id === ap.customerId)
  const addr = c?.addresses.find((a) => a.id === ap.addressId) ?? c?.addresses[0]
  return {
    summary: ap.title,
    description: [c?.name, c?.phone, ap.notes, ap.userIds.map((u) => s.db.users.find((x) => x.id === u)?.name).join(', ')].filter(Boolean).join('\n'),
    location: ap.location || addressText(addr),
    start: ap.start,
    end: ap.end,
    allDay: ap.allDay,
  }
}

const existingIds = (ap: Appointment): Record<ID, string> => ({ ...(ap.googleEventIds ?? (ap.googleEventId ? { [DEFAULT]: ap.googleEventId } : {})) })

function saveIds(apId: ID, ids: Record<ID, string>) {
  if (!app().db.appointments.some((a) => a.id === apId)) return
  app().patch('appointments', apId, { googleEventIds: ids, googleEventId: ids[DEFAULT] ?? Object.values(ids)[0] })
}

async function createEvent(ap: Appointment, t: Target) {
  const res = await api<{ id: string; htmlLink: string }>('/api/google/calendar/events', { method: 'POST', json: { ...eventBody(ap), calendarId: t.calendarId } })
  return res.id
}

const calQuery = (calendarId?: string) => (calendarId ? `?calendarId=${encodeURIComponent(calendarId)}` : '')

/** אירוע חדש ביומן של כל משתתף (נקרא מ-scheduleAppointment) */
export async function pushAppointment(ap: Appointment) {
  if (!apiMode()) return
  const ids: Record<ID, string> = {}
  for (const t of targets(ap)) {
    try {
      ids[t.key] = await createEvent(ap, t)
    } catch {
      // היומן הוא תוספת: כישלון לא עוצר את השיבוץ
    }
  }
  if (Object.keys(ids).length) saveIds(ap.id, ids)
}

/** מועד, כותרת או צוות השתנו: מעדכן את האירועים, פותח למי שנוסף ומוחק למי שירד. בוטל = מחיקה. */
export async function updateAppointmentEvents(ap: Appointment) {
  if (!apiMode()) return
  if (ap.status === 'cancelled') return deleteAppointmentEvents(ap)
  const ids = existingIds(ap)
  const wanted = targets(ap)
  for (const [key, id] of Object.entries(ids)) {
    if (wanted.some((t) => t.key === key)) continue
    await api(`/api/google/calendar/events/${encodeURIComponent(id)}${calQuery(calendarOf(key))}`, { method: 'DELETE' }).catch(() => {})
    delete ids[key]
  }
  for (const t of wanted) {
    try {
      if (ids[t.key]) {
        try {
          await api(`/api/google/calendar/events/${encodeURIComponent(ids[t.key])}`, { method: 'PATCH', json: { ...eventBody(ap), calendarId: t.calendarId } })
        } catch (e) {
          // האירוע נמחק ביומן: פותחים חדש
          if (e instanceof ServerError && e.code === 'google_error') ids[t.key] = await createEvent(ap, t)
          else throw e
        }
      } else ids[t.key] = await createEvent(ap, t)
    } catch {
      /* ננסה בשינוי הבא */
    }
  }
  saveIds(ap.id, ids)
}

/** מחיקת כל האירועים של מועד (בוטל או נמחק) */
export async function deleteAppointmentEvents(ap: Appointment) {
  if (!apiMode()) return
  const ids = existingIds(ap)
  if (!Object.keys(ids).length) return
  for (const [key, id] of Object.entries(ids)) {
    await api(`/api/google/calendar/events/${encodeURIComponent(id)}${calQuery(calendarOf(key))}`, { method: 'DELETE' }).catch(() => {})
  }
  if (app().db.appointments.some((a) => a.id === ap.id)) app().patch('appointments', ap.id, { googleEventIds: {}, googleEventId: undefined })
}

// ---------------------------------------------------------------- Drive

const subfolders = () => app().db.config.driveFolders.filter((f) => f.active).map((f) => ({ key: f.key, name: f.label }))

export async function createDriveFolder(k: Case) {
  if (!apiMode()) return
  try {
    const res = await api<{ id: string; webViewLink: string; subfolders?: Record<string, string> }>('/api/google/drive/folders', {
      method: 'POST',
      json: { name: `${k.number} — ${k.title}`, subfolders: subfolders() },
    })
    app().patch('cases', k.id, { driveFolderUrl: res.webViewLink, driveFolderId: res.id, driveFolders: res.subfolders ?? {} })
    app().log({ kind: 'document', caseId: k.id, text: 'נפתחה תיקייה ב-Google Drive' })
  } catch {
    /* אפשר לפתוח ידנית */
  }
}

/** מזהה תיקיית המשנה של התיק ב-Drive; פותח את התיקייה (או את תיקיית המשנה) אם עוד אין */
export async function ensureCaseFolder(caseId: ID, folderKey: string): Promise<string | undefined> {
  if (!apiMode()) return undefined
  const get = () => app().db.cases.find((x) => x.id === caseId)
  let k = get()
  if (!k) return undefined
  if (k.driveFolders?.[folderKey]) return k.driveFolders[folderKey]
  if (!k.driveFolderId) {
    await createDriveFolder(k)
    k = get()
    if (k?.driveFolders?.[folderKey]) return k.driveFolders[folderKey]
    if (!k?.driveFolderId) return undefined
  }
  const label = app().db.config.driveFolders.find((f) => f.key === folderKey)?.label ?? folderKey
  try {
    const res = await api<{ id: string }>('/api/google/drive/folders', { method: 'POST', json: { name: label, parentId: k.driveFolderId } })
    app().patch('cases', caseId, { driveFolders: { ...(get()?.driveFolders ?? {}), [folderKey]: res.id } })
    return res.id
  } catch {
    return undefined
  }
}

export async function moveDriveFile(fileId: string, from: string | undefined, to: string) {
  if (!apiMode()) return
  await api(`/api/google/drive/files/${encodeURIComponent(fileId)}/move`, { method: 'POST', json: { from, to } })
}

export async function trashDriveFile(fileId: string) {
  if (!apiMode()) return
  await api(`/api/google/drive/files/${encodeURIComponent(fileId)}/trash`, { method: 'POST', json: {} })
}
