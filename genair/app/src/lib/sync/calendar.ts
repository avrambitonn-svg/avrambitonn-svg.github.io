// מעקב אחרי שינויים במועדים שנעשו במכשיר הזה: מועד שזז, צוות שהשתנה או ביטול מתעדכנים ביומני גוגל.
// שינויים שמגיעים מהשרת לא מטופלים כאן (המכשיר שעשה אותם כבר עדכן את היומן).
import { useApp } from '../store'
import type { Appointment } from '../types'
import { bridge } from './bridge'
import { deleteAppointmentEvents, googleApiMode, updateAppointmentEvents } from '../integrations/google'

const timers = new Map<string, ReturnType<typeof setTimeout>>()
let started = false

const hasEvents = (a: Appointment) => Boolean(a.googleEventId || (a.googleEventIds && Object.keys(a.googleEventIds).length))
const changed = (a: Appointment, b: Appointment) =>
  a.start !== b.start || a.end !== b.end || a.allDay !== b.allDay || a.title !== b.title || a.notes !== b.notes || a.location !== b.location ||
  (a.status === 'cancelled') !== (b.status === 'cancelled') || a.userIds.join() !== b.userIds.join()

export function watchCalendar() {
  if (started) return
  started = true
  useApp.subscribe((state, prev) => {
    if (bridge.remote || state.db.appointments === prev.db.appointments || !googleApiMode()) return
    const before = new Map(prev.db.appointments.map((a) => [a.id, a]))
    for (const ap of state.db.appointments) {
      const old = before.get(ap.id)
      before.delete(ap.id)
      if (!old || old === ap || !hasEvents(old) || !changed(old, ap)) continue
      clearTimeout(timers.get(ap.id))
      timers.set(
        ap.id,
        setTimeout(() => {
          timers.delete(ap.id)
          const cur = useApp.getState().db.appointments.find((x) => x.id === ap.id)
          if (cur) void updateAppointmentEvents(cur)
        }, 1500),
      )
    }
    // מועדים שנמחקו
    for (const old of before.values()) if (hasEvents(old)) void deleteAppointmentEvents(old)
  })
}
