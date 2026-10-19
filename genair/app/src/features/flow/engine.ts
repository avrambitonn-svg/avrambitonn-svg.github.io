// מנוע הפלואו: מתחיל פלואו בפתיחת תיק ומקדם שלבים כשהתיק מתקדם בצנרת
// החלק ה"טהור" (בלי store) משמש גם את נתוני ההדגמה, ולכן לא מייבאים כאן מודולים שנוגעים ב-store בזמן הטעינה.
import { app } from '../../lib/store'
import type { Case, CaseFlow, CaseStage, CaseTemplate, Config, DB, FlowRole, FlowStage, ID, Task } from '../../lib/types'
import { addDays, nowIso, uid, ymd } from '../../lib/format'

export const flowRoleLabel: Record<FlowRole, string> = {
  agent: 'סוכן התיק',
  engineer: 'מהנדס',
  manager: 'מנהל התיק',
  department_managers: 'מנהלי מחלקה',
  project_manager: 'מנהל פרויקט',
  installers: 'מתקינים',
  office: 'משרד',
  admin: 'הנהלה',
}
export const flowRoles = Object.keys(flowRoleLabel) as FlowRole[]

// סדר הצנרת (עותק מקומי, כדי שהמנוע לא יהיה תלוי בסדר טעינת המודולים)
const order: CaseStage[] = ['lead', 'survey', 'quote', 'approved', 'scheduled', 'installing', 'completed', 'closed']
const pIdx = (s?: CaseStage) => (s ? order.indexOf(s) : -1)

// ---------- חלק טהור ----------
// תבנית לתיק: זו שנבחרה בתיק, אחרת הראשונה הפעילה שמתאימה לסוג הפרויקט (ואחריה תבנית "לכל הסוגים")
export function templateFor(config: Config, k: Pick<Case, 'templateId' | 'projectType'>): CaseTemplate | undefined {
  if (k.templateId) {
    const t = config.caseTemplates.find((x) => x.id === k.templateId)
    if (t) return t
  }
  const active = config.caseTemplates.filter((t) => t.active)
  return active.find((t) => t.projectTypes.includes(k.projectType)) ?? active.find((t) => t.projectTypes.length === 0)
}

export const stagesOf = (config: Config, tpl?: CaseTemplate): FlowStage[] =>
  (tpl?.stageIds ?? []).map((id) => config.flowStages.find((s) => s.id === id)).filter((s): s is FlowStage => !!s)

// השלב האחרון (מ-fromIdx והלאה) שהתיק כבר עבר את שלב הצנרת שלו; -1 אם אין
export function reachedIdx(stages: FlowStage[], caseStage: CaseStage, fromIdx = 0): number {
  const pi = pIdx(caseStage)
  if (pi < 0) return -1
  let j = -1
  stages.forEach((st, i) => {
    const si = pIdx(st.caseStage)
    if (i >= fromIdx && si >= 0 && si <= pi) j = i
  })
  return j
}

// מי מקבל משימה לפי תפקיד. אם אין אף אחד בתפקיד: מנהל התיק, ואם אין, ההנהלה
export function assigneesFor(db: Pick<DB, 'users'>, k: Case, role: FlowRole): ID[] {
  const active = db.users.filter((u) => u.active)
  const admins = active.filter((u) => u.role === 'admin').map((u) => u.id)
  const pick: Record<FlowRole, (ID | undefined)[]> = {
    agent: [k.agentId],
    engineer: [k.engineerId],
    manager: [k.managerId],
    office: [active.find((u) => u.role === 'office')?.id],
    admin: admins,
    project_manager: [k.projectManagerId],
    department_managers: k.departmentManagerIds ?? [],
    installers: k.installerIds ?? [],
  }
  const ok = (id?: ID) => !!id && db.users.some((u) => u.id === id)
  const out = [...new Set(pick[role].filter(ok))] as ID[]
  if (out.length) return out
  // אין אף אחד בתפקיד: משימות הסוכן עוברות למנהל הפרויקט; כל השאר למנהל התיק; ואם אין, להנהלה
  const chain = [...(role === 'agent' ? [k.projectManagerId] : []), k.managerId, admins[0], active[0]?.id]
  const fallback = chain.find(ok)
  return fallback ? [fallback] : []
}

// תאריך יעד: היום + N ימי עבודה (בלי שישי ושבת)
export function dueIn(days = 0, from: Date = new Date()): string {
  const off = (x: Date) => x.getDay() === 5 || x.getDay() === 6
  let d = new Date(from.getTime())
  while (off(d)) d = addDays(d, 1)
  for (let n = days; n > 0; ) {
    d = addDays(d, 1)
    if (!off(d)) n--
  }
  return ymd(d)
}

export function stageTasks(db: Pick<DB, 'users'>, k: Case, stage: FlowStage, by: ID, now: Date = new Date()): Task[] {
  return stage.tasks.flatMap((def) =>
    assigneesFor(db, k, def.role).map((assigneeId): Task => ({
      id: uid('t'), title: def.title, caseId: k.id, assigneeId, createdBy: by, due: dueIn(def.dueDays ?? 0, now), done: false, priority: 'normal', status: 'new',
      createdAt: now.toISOString(), flowStageId: stage.id,
    })),
  )
}

// פלואו חדש לתיק: מתחיל מהשלב הראשון, או מהשלב שאחרי מה שהתיק כבר עבר בצנרת (תיקים קיימים)
export function buildFlow(db: Pick<DB, 'users' | 'config'>, k: Case, tpl: CaseTemplate, by: ID, now: Date = new Date()) {
  const stages = stagesOf(db.config, tpl)
  if (!stages.length) return null
  const t = now.toISOString()
  const idx = reachedIdx(stages, k.stage) + 1
  const done = idx >= stages.length
  const cur = Math.min(idx, stages.length - 1)
  const log: CaseFlow['log'] = stages.slice(0, cur + 1).map((st, i) => ({ stageId: st.id, startedAt: t, ...(i < idx ? { doneAt: t, doneBy: by } : {}) }))
  const flow: CaseFlow = { templateId: tpl.id, stageIdx: cur, startedAt: t, log, ...(done ? { doneAt: t } : {}) }
  const tasks = done ? [] : stageTasks(db, k, stages[cur], by, now)
  return { flow, tasks, stages, skipped: Math.min(idx, stages.length) }
}

// ---------- מצב הפלואו לתצוגה ----------
export function flowView(db: Pick<DB, 'config' | 'tasks'>, k: Case) {
  const tpl = k.flow ? db.config.caseTemplates.find((t) => t.id === k.flow!.templateId) : templateFor(db.config, k)
  const stages = stagesOf(db.config, tpl)
  const tasks = db.tasks.filter((t) => t.caseId === k.id && t.flowStageId)
  return { tpl, stages, tasks, flow: k.flow, current: k.flow && !k.flow.doneAt ? stages[k.flow.stageIdx] : undefined }
}

// ---------- פעולות (דרך ה-store, כך שהשינוי מגיע לכל המשתמשים) ----------
const caseOf = (id: ID) => app().db.cases.find((x) => x.id === id)
const stageName = (st: CaseStage) => app().db.config.caseStages.find((o) => o.key === st)?.label ?? st

function notifyNewTasks(k: Case, tasks: Task[], stage: FlowStage) {
  const s = app()
  const per = new Map<ID, number>()
  tasks.forEach((t) => per.set(t.assigneeId, (per.get(t.assigneeId) ?? 0) + 1))
  per.forEach((n, userId) => {
    if (userId === s.currentUserId) return
    s.notify(userId, `${k.title}: שלב "${stage.name}" — ${n === 1 ? 'משימה חדשה' : `${n} משימות חדשות`}`, `/cases/${k.id}`)
  })
}

// תגיות ברירת מחדל של התבנית (נשמרות כמפתח; מוסיפים רק מה שאין, לפי מפתח או תווית)
function withDefaultTags(k: Case, tpl: CaseTemplate): string[] | undefined {
  const opts = app().db.config.tags
  const has = (key: string) => k.tags.some((t) => t === key || t === opts.find((o) => o.key === key)?.label)
  const add = (tpl.defaultTags ?? []).filter((t) => !has(t))
  return add.length ? [...k.tags, ...add] : undefined
}

export function startFlow(caseId: ID, templateId?: ID, reason: 'created' | 'manual' | 'switch' = 'manual'): boolean {
  const s = app()
  const k = caseOf(caseId)
  if (!k) return false
  const tpl = templateId ? s.db.config.caseTemplates.find((t) => t.id === templateId) : templateFor(s.db.config, k)
  if (!tpl) return false
  const built = buildFlow(s.db, k, tpl, s.currentUserId)
  if (!built) return false
  const tags = reason === 'created' ? withDefaultTags(k, tpl) : undefined
  s.patch('cases', k.id, { flow: built.flow, templateId: tpl.id, ...(tags ? { tags } : {}) })
  built.tasks.forEach((t) => s.upsert('tasks', t))
  const cur = built.stages[built.flow.stageIdx]
  const text = built.flow.doneAt
    ? `פלואו הופעל: ${tpl.name} — התיק כבר עבר את כל השלבים`
    : built.skipped
      ? `פלואו הופעל: ${tpl.name} — שלב נוכחי: ${cur.name} (${built.skipped} שלבים קודמים סומנו כהושלמו)`
      : `פלואו התחיל: ${tpl.name} — שלב ראשון: ${cur.name}`
  s.log({ kind: 'note', caseId: k.id, text })
  if (!built.flow.doneAt) notifyNewTasks(k, built.tasks, cur)
  return true
}

type How = 'tasks' | 'manual' | 'skip' | 'pipeline'

// סוגר את השלבים מהנוכחי ועד through (כולל) ומתחיל את השלב שאחריו
function advance(k: Case, through: number, how: How) {
  const s = app()
  const flow = k.flow
  if (!flow || flow.doneAt) return
  const tpl = s.db.config.caseTemplates.find((t) => t.id === flow.templateId)
  const stages = stagesOf(s.db.config, tpl)
  if (!stages.length) return
  const now = nowIso()
  const me = s.currentUserId
  const log = flow.log.map((e) => ({ ...e }))
  const close = (i: number, why: How) => {
    const st = stages[i]
    const open = s.db.tasks.filter((t) => t.caseId === k.id && t.flowStageId === st.id && !t.done)
    if (why === 'skip') open.forEach((t) => s.remove('tasks', t.id))
    else open.forEach((t) => s.patch('tasks', t.id, { done: true, status: 'done', doneAt: now, doneBy: me }))
    const e = [...log].reverse().find((x) => x.stageId === st.id && !x.doneAt)
    if (e) Object.assign(e, { doneAt: now, doneBy: me })
    else log.push({ stageId: st.id, startedAt: now, doneAt: now, doneBy: me })
    const note = why === 'pipeline' ? ` (התיק עבר ל"${stageName(k.stage)}")` : why === 'tasks' ? ' (כל המשימות בוצעו)' : why === 'manual' ? ' (סומן ידנית)' : open.length ? ` (${open.length} משימות פתוחות הוסרו)` : ''
    s.log({ kind: 'note', caseId: k.id, text: `${why === 'skip' ? 'שלב דולג' : 'שלב הושלם'}: ${st.name}${note}` })
  }
  let last = Math.min(through, stages.length - 1)
  for (let i = flow.stageIdx; i <= last; i++) close(i, how)
  // אם התיק כבר עבר בצנרת גם את השלבים הבאים, הם נסגרים מיד
  const reached = reachedIdx(stages, k.stage, last + 1)
  for (let i = last + 1; i <= reached; i++) close(i, 'pipeline')
  last = Math.max(last, reached)
  const next = last + 1
  if (next < stages.length) {
    const st = stages[next]
    log.push({ stageId: st.id, startedAt: now })
    const fresh = caseOf(k.id) ?? k
    const tasks = stageTasks(s.db, fresh, st, me)
    s.patch('cases', k.id, { flow: { ...flow, stageIdx: next, log } })
    tasks.forEach((t) => s.upsert('tasks', t))
    s.log({ kind: 'note', caseId: k.id, text: `שלב חדש בפלואו: ${st.name}${tasks.length ? ` — ${tasks.length} משימות` : ''}` })
    notifyNewTasks(fresh, tasks, st)
  } else {
    s.patch('cases', k.id, { flow: { ...flow, stageIdx: stages.length - 1, log, doneAt: now } })
    s.log({ kind: 'note', caseId: k.id, text: `הפלואו הושלם: ${tpl?.name ?? ''}` })
  }
}

export function finishStage(caseId: ID) {
  const k = caseOf(caseId)
  if (k?.flow) advance(k, k.flow.stageIdx, 'manual')
}

export function skipStage(caseId: ID) {
  const k = caseOf(caseId)
  if (k?.flow) advance(k, k.flow.stageIdx, 'skip')
}

// החלפת תבנית: המשימות הפתוחות של הפלואו הקודם יורדות, והפלואו מתחיל מחדש
export function restartFlow(caseId: ID, templateId: ID) {
  const s = app()
  const k = caseOf(caseId)
  if (!k) return
  const old = k.flow && s.db.config.caseTemplates.find((t) => t.id === k.flow!.templateId)
  s.db.tasks.filter((t) => t.caseId === caseId && t.flowStageId && !t.done).forEach((t) => s.remove('tasks', t.id))
  s.patch('cases', caseId, { flow: undefined })
  const tpl = s.db.config.caseTemplates.find((t) => t.id === templateId)
  if (old) s.log({ kind: 'note', caseId, text: `הפלואו הוחלף: ${old.name} ← ${tpl?.name ?? ''}` })
  startFlow(caseId, templateId, 'switch')
}

// משימה של שלב סומנה כבוצעה: אם כל משימות השלב הנוכחי בוצעו, עוברים לשלב הבא
export function onTaskDone(task: Pick<Task, 'caseId' | 'flowStageId'>) {
  if (!task.caseId || !task.flowStageId) return
  const s = app()
  const k = caseOf(task.caseId)
  if (!k?.flow || k.flow.doneAt) return
  const stages = stagesOf(s.db.config, s.db.config.caseTemplates.find((t) => t.id === k.flow!.templateId))
  const cur = stages[k.flow.stageIdx]
  if (!cur || cur.id !== task.flowStageId) return
  const list = s.db.tasks.filter((t) => t.caseId === k.id && t.flowStageId === cur.id)
  if (list.length && list.every((t) => t.done)) advance(k, k.flow.stageIdx, 'tasks')
}

export function onCaseCreated(k: Case): void {
  startFlow(k.id, undefined, 'created')
}

export function onStageChanged(k: Case, from: CaseStage, to: CaseStage): void {
  void from
  const fresh = caseOf(k.id) ?? k
  const flow = fresh.flow
  if (!flow || flow.doneAt) return
  const s = app()
  const stages = stagesOf(s.db.config, s.db.config.caseTemplates.find((t) => t.id === flow.templateId))
  const j = reachedIdx(stages, to, flow.stageIdx)
  if (j >= flow.stageIdx) advance({ ...fresh, stage: to }, j, 'pipeline')
}
