// תזכורות: משימות ופגישות שהגיע זמנן מקבלות התראה (פעם אחת, לפי remindedAt)
import { useEffect } from 'react'
import { app } from '../../lib/store'
import type { ID } from '../../lib/types'
import { dateShortDay, nowIso, sameDay, time } from '../../lib/format'
import { toast } from '../../components/ui'
import { taskLink } from './tasks'

const EVERY = 30_000

export function checkReminders(now: number = Date.now()) {
  const s = app()
  const me = s.currentUserId
  let mine = 0
  s.db.tasks.forEach((t) => {
    if (t.done || !t.remindAt || t.remindedAt || +new Date(t.remindAt) > now) return
    const to = [...new Set<ID>([t.assigneeId, ...(t.sharedWith ?? [])])]
    to.forEach((u) => s.notify(u, `תזכורת: ${t.title}`, taskLink(t)))
    s.patch('tasks', t.id, { remindedAt: nowIso() })
    if (to.includes(me)) {
      mine++
      toast.info(`תזכורת: ${t.title}`)
    }
  })
  s.db.appointments.forEach((a) => {
    if (!a.reminderMin || a.remindedAt || a.status === 'cancelled' || a.status === 'done') return
    const start = +new Date(a.start)
    if (now < start - a.reminderMin * 60_000 || now > +new Date(a.end)) return
    const soon = sameDay(a.start, new Date(now)) ? `היום ב-${time(a.start)}` : `ב${dateShortDay(a.start)} ${time(a.start)}`
    a.userIds.forEach((u) => s.notify(u, `תזכורת: ${a.title} ${soon}`, a.caseId ? `/cases/${a.caseId}` : '/calendar'))
    s.patch('appointments', a.id, { remindedAt: nowIso() })
    if (a.userIds.includes(me)) {
      mine++
      toast.info(`תזכורת: ${a.title} ${soon}`)
    }
  })
  return mine
}

export function useReminders(): void {
  useEffect(() => {
    const first = setTimeout(() => checkReminders(), 2000)
    const t = setInterval(() => checkReminders(), EVERY)
    return () => {
      clearTimeout(first)
      clearInterval(t)
    }
  }, [])
}
