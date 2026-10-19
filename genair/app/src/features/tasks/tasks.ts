// עזרים למשימות: סטטוס (ובוצע/לא בוצע בהתאם), שיתוף, תזכורות וקיבוץ לפי מועד
import { app } from '../../lib/store'
import type { Config, ID, Task } from '../../lib/types'
import { addDays, atTime, nowIso, uid, ymd } from '../../lib/format'
import { onTaskDone } from '../flow/engine'

export const taskLink = (t: Pick<Task, 'id'>) => `/tasks?task=${t.id}`
const nameOf = (id?: ID) => app().db.users.find((u) => u.id === id)?.name ?? ''

// הסטטוס תמיד תואם ל-done: בוצע = 'done', ואם לא בוצע ואין סטטוס = 'new'
export const statusOf = (t: Pick<Task, 'done' | 'status'>) => (t.done ? 'done' : t.status && t.status !== 'done' ? t.status : 'new')

export function setTaskStatus(t: Task, status: string) {
  const s = app()
  const me = s.currentUserId
  const done = status === 'done'
  s.patch('tasks', t.id, { status, done, doneAt: done ? t.doneAt ?? nowIso() : undefined, doneBy: done ? t.doneBy ?? me : undefined })
  if (!done || t.done) return
  const to = new Set<ID>([...(t.flowStageId ? [] : [t.createdBy, t.assigneeId]), ...(t.sharedWith ?? [])])
  to.delete(me)
  to.forEach((u) => s.notify(u, `בוצעה: ${t.title} (${nameOf(me)})`, taskLink(t)))
  if (t.caseId) s.log({ kind: 'note', caseId: t.caseId, text: `משימה בוצעה: ${t.title}` })
  onTaskDone(t)
}

export const toggleDone = (t: Task) => setTaskStatus(t, t.done ? 'new' : 'done')

export type TaskInput = Pick<Task, 'title' | 'assigneeId'> & Partial<Pick<Task, 'caseId' | 'due' | 'priority' | 'sharedWith' | 'remindAt' | 'notes' | 'status'>>

export function createTask(p: TaskInput): Task {
  const s = app()
  const me = s.currentUserId
  const t: Task = { priority: 'normal', status: 'new', ...p, id: uid('t'), done: false, createdBy: me, createdAt: nowIso(), sharedWith: p.sharedWith?.length ? p.sharedWith : undefined }
  s.upsert('tasks', t)
  if (t.assigneeId !== me) s.notify(t.assigneeId, `משימה חדשה מ${nameOf(me)}: ${t.title}`, taskLink(t))
  ;(t.sharedWith ?? []).filter((id) => id !== me && id !== t.assigneeId).forEach((id) => s.notify(id, `משימה ששותפה איתך: ${t.title} (${nameOf(me)})`, taskLink(t)))
  if (t.caseId) s.log({ kind: 'note', caseId: t.caseId, text: `נוספה משימה: ${t.title} (אחראי: ${nameOf(t.assigneeId)})` })
  return t
}

// עדכון משימה: מי שנוסף (אחראי חדש או שיתוף חדש) מקבל התראה; תזכורת חדשה מתאפסת
export function updateTask(t: Task, changes: Partial<Task>) {
  const s = app()
  const me = s.currentUserId
  const { status, ...rest } = changes
  const next: Partial<Task> = { ...rest }
  if ('remindAt' in changes && changes.remindAt !== t.remindAt) next.remindedAt = undefined
  if (next.sharedWith && !next.sharedWith.length) next.sharedWith = undefined
  s.patch('tasks', t.id, next)
  const title = changes.title ?? t.title
  if (changes.assigneeId && changes.assigneeId !== t.assigneeId && changes.assigneeId !== me) s.notify(changes.assigneeId, `הועברה אליך משימה: ${title} (${nameOf(me)})`, taskLink(t))
  const added = (changes.sharedWith ?? []).filter((id) => !(t.sharedWith ?? []).includes(id) && id !== me)
  added.forEach((id) => s.notify(id, `משימה ששותפה איתך: ${title} (${nameOf(me)})`, taskLink(t)))
  if (status !== undefined && status !== statusOf(t)) setTaskStatus({ ...t, ...next } as Task, status)
}

export function deleteTask(t: Task) {
  const s = app()
  s.remove('tasks', t.id)
  if (t.caseId) s.log({ kind: 'note', caseId: t.caseId, text: `משימה נמחקה: ${t.title}` })
}

export const involves = (t: Task, me: ID) => t.assigneeId === me || t.createdBy === me || !!t.sharedWith?.includes(me)
export const isMine = (t: Task, me: ID) => t.assigneeId === me || !!t.sharedWith?.includes(me)

// ---------- תזכורות ----------
export interface ReminderPreset { key: string; label: string; at?: Date; disabled?: boolean }
export function reminderPresets(now: Date = new Date()): ReminderPreset[] {
  const four = atTime(now, '16:00')
  return [
    { key: 'hour', label: 'בעוד שעה', at: new Date(now.getTime() + 3600_000) },
    { key: 'today16', label: 'היום ב-16:00', at: four, disabled: four.getTime() <= now.getTime() },
    { key: 'morning', label: 'מחר בבוקר', at: atTime(addDays(now, 1), '08:00') },
  ]
}
// ל-input מסוג datetime-local (שעון מקומי)
export const toLocalInput = (iso?: string) => {
  if (!iso) return ''
  const d = new Date(iso)
  return `${ymd(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : undefined)

// ---------- מיון וקיבוץ ----------
export type DueGroup = 'overdue' | 'today' | 'upcoming' | 'none' | 'done'
export const dueGroups: DueGroup[] = ['overdue', 'today', 'upcoming', 'none', 'done']
export const dueGroupLabel: Record<DueGroup, string> = { overdue: 'באיחור', today: 'היום', upcoming: 'בהמשך', none: 'בלי תאריך', done: 'הושלמו' }
export function dueGroup(t: Task, today = ymd()): DueGroup {
  if (t.done) return 'done'
  if (!t.due) return 'none'
  return t.due < today ? 'overdue' : t.due === today ? 'today' : 'upcoming'
}

export const prioRank = (cfg: Config, p?: string) => Math.max(0, cfg.taskPriorities.findIndex((o) => o.key === p))
export function sortTasks(cfg: Config) {
  return (a: Task, b: Task) =>
    Number(a.done) - Number(b.done) ||
    (a.done ? (b.doneAt ?? '').localeCompare(a.doneAt ?? '') : 0) ||
    (a.due ?? '9999').localeCompare(b.due ?? '9999') ||
    prioRank(cfg, b.priority) - prioRank(cfg, a.priority) ||
    b.createdAt.localeCompare(a.createdAt)
}
