// יומן גוגל ו-Drive דרך שרת האינטגרציות (רק במצב "סנכרון מלא"). במצב קישורים לא קורה כלום ברקע.
import { app } from '../store'
import { api, serverConfigured } from './server'
import { addressText } from './links'
import type { Appointment, Case } from '../types'

const apiMode = () => app().settings.googleMode === 'api' && serverConfigured()

export async function pushAppointment(ap: Appointment) {
  if (!apiMode()) return
  const s = app()
  const c = s.db.customers.find((x) => x.id === ap.customerId)
  const addr = c?.addresses.find((a) => a.id === ap.addressId) ?? c?.addresses[0]
  try {
    const res = await api<{ id: string; htmlLink: string }>('/api/google/calendar/events', {
      method: 'POST',
      json: {
        summary: ap.title,
        description: [c?.name, c?.phone, ap.notes, ap.userIds.map((u) => s.db.users.find((x) => x.id === u)?.name).join(', ')].filter(Boolean).join('\n'),
        location: addressText(addr),
        start: ap.start,
        end: ap.end,
        allDay: ap.allDay,
      },
    })
    s.patch('appointments', ap.id, { googleEventId: res.id })
  } catch {
    // היומן הוא תוספת: כישלון לא עוצר את השיבוץ
  }
}

export async function createDriveFolder(k: Case) {
  if (!apiMode()) return
  try {
    const res = await api<{ id: string; webViewLink: string }>('/api/google/drive/folders', { method: 'POST', json: { name: `${k.number} — ${k.title}` } })
    app().patch('cases', k.id, { driveFolderUrl: res.webViewLink })
    app().log({ kind: 'document', caseId: k.id, text: 'נפתחה תיקייה ב-Google Drive' })
  } catch {
    /* אפשר לפתוח ידנית */
  }
}
