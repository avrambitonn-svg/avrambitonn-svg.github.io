// רכיבי משימות משותפים: שורה, הוספה מהירה, בחירת תיק / שיתוף / תזכורת, וחלון עריכה
import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, FolderOpen, Plus, StickyNote, Trash2, Users, Workflow, X } from 'lucide-react'
import { useApp, useMe } from '../../lib/store'
import { Avatar, Avatars, Confirm, Field, Modal, toast } from '../../components/ui'
import { addDays, dateShortDay, dateTime, relative, sameDay, time, ymd } from '../../lib/format'
import type { ID, Task } from '../../lib/types'
import {
  createTask, deleteTask, dueGroup, fromLocalInput, reminderPresets, statusOf, toLocalInput, toggleDone, updateTask,
} from './tasks'
import '../ops/ops.css'
import './tasks.css'

export function ColorBadge({ color, children, title }: { color?: string; children: ReactNode; title?: string }) {
  return <span className="badge" title={title} style={color ? { background: `${color}1a`, color } : undefined}>{children}</span>
}

export function dueText(due?: string) {
  if (!due) return ''
  const today = ymd()
  if (due === today) return 'היום'
  if (due === ymd(addDays(new Date(), 1))) return 'מחר'
  return dateShortDay(due)
}

export const whenText = (iso: string) => (sameDay(iso, new Date()) ? `היום ${time(iso)}` : sameDay(iso, addDays(new Date(), 1)) ? `מחר ${time(iso)}` : `${dateShortDay(iso)} ${time(iso)}`)

// ---------- שורת משימה ----------
export function TaskRow({ t, onOpen, showCase = true }: { t: Task; onOpen?: (t: Task) => void; showCase?: boolean }) {
  const users = useApp((s) => s.db.users)
  const cases = useApp((s) => s.db.cases)
  const cfg = useApp((s) => s.db.config)
  const nav = useNavigate()
  const k = showCase && t.caseId ? cases.find((x) => x.id === t.caseId) : undefined
  const g = dueGroup(t)
  const prio = cfg.taskPriorities.find((o) => o.key === t.priority)
  const st = statusOf(t)
  const stOpt = cfg.taskStatuses.find((o) => o.key === st)
  const stage = t.flowStageId ? cfg.flowStages.find((x) => x.id === t.flowStageId) : undefined
  const people = [t.assigneeId, ...(t.sharedWith ?? [])].map((id) => users.find((u) => u.id === id))
  return (
    <div className={`list-item tk-row ${t.done ? 'done' : ''}`}>
      <input type="checkbox" className="tk-check" checked={t.done} onChange={() => toggleDone(t)} aria-label={t.done ? 'סימון כלא בוצע' : 'סימון כבוצע'} />
      <div className="tk-main" role="button" tabIndex={0} onClick={() => onOpen?.(t)} onKeyDown={(e) => e.key === 'Enter' && onOpen?.(t)}>
        <span className={`tk-title ${t.priority === 'high' && !t.done ? 'high' : ''}`}>{t.title}</span>
        <span className="tk-meta">
          {t.priority !== 'normal' && prio && !t.done && <ColorBadge color={prio.color}>{prio.label}</ColorBadge>}
          {st !== 'new' && st !== 'done' && <ColorBadge color={stOpt?.color}>{stOpt?.label ?? st}</ColorBadge>}
          {t.due && !t.done && <span className={g === 'overdue' ? 'txt-danger strong' : g === 'today' ? 'txt-brand strong' : ''}>{g === 'overdue' ? `באיחור · ${dateShortDay(t.due)}` : dueText(t.due)}</span>}
          {t.done && t.doneAt && <span>בוצעה {relative(t.doneAt)}</span>}
          {k && (
            <span>
              <FolderOpen size={12} />
              <a href={`#/cases/${k.id}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); nav(`/cases/${k.id}`) }}>{k.number}</a>
            </span>
          )}
          {stage && <span title="נוצרה מהפלואו"><Workflow size={12} />{stage.name}</span>}
          {t.remindAt && !t.done && !t.remindedAt && <span title="תזכורת"><Bell size={12} /><span className="ltr">{whenText(t.remindAt)}</span></span>}
          {t.notes && <span title={t.notes}><StickyNote size={12} /></span>}
        </span>
      </div>
      <div className="tk-side">{people.length > 1 ? <Avatars users={people} /> : <Avatar user={people[0]} />}</div>
    </div>
  )
}

// ---------- חלון קטן ----------
function Pop({ label, icon, on, children }: { label: ReactNode; icon?: ReactNode; on?: boolean; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="tk-pop">
      <button type="button" className={`chip ${on ? 'on' : ''}`} onClick={() => setOpen((v) => !v)} aria-expanded={open}>{icon}{label}</button>
      {open && (
        <>
          <div className="tk-pop-scrim" onClick={() => setOpen(false)} />
          <div className="tk-pop-box card">{children(() => setOpen(false))}</div>
        </>
      )}
    </div>
  )
}

export function ReminderPicker({ value, onChange }: { value?: string; onChange: (iso?: string) => void }) {
  const [custom, setCustom] = useState(toLocalInput(value))
  return (
    <Pop label={value ? <span className="ltr">{whenText(value)}</span> : 'תזכורת'} icon={<Bell size={14} />} on={!!value}>
      {(close) => (
        <>
          {reminderPresets().map((p) => (
            <button key={p.key} type="button" className="opt" disabled={p.disabled} onClick={() => { onChange(p.at!.toISOString()); close() }}>
              <span className="grow">{p.label}</span>
              <span className="tiny muted ltr">{p.at && whenText(p.at.toISOString())}</span>
            </button>
          ))}
          <div className="label mt8">אחר...</div>
          <div className="row">
            <input type="datetime-local" className="input sm" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="מועד תזכורת" />
            <button type="button" className="btn sm" disabled={!custom} onClick={() => { onChange(fromLocalInput(custom)); close() }}>קביעה</button>
          </div>
          {value && <button type="button" className="opt txt-danger" onClick={() => { onChange(undefined); setCustom(''); close() }}><X size={14} /> בלי תזכורת</button>}
        </>
      )}
    </Pop>
  )
}

export function SharePicker({ value, onChange, exclude = [] }: { value: ID[]; onChange: (ids: ID[]) => void; exclude?: ID[] }) {
  const users = useApp((s) => s.db.users)
  const me = useMe()
  const list = useMemo(() => users.filter((u) => u.active && u.id !== me.id && !exclude.includes(u.id)), [users, me.id, exclude])
  return (
    <Pop label={value.length ? `שיתוף (${value.length})` : 'שיתוף'} icon={<Users size={14} />} on={value.length > 0}>
      {() => (
        <>
          <div className="tiny muted">מי שמשתפים רואה את המשימה ומקבל עדכונים</div>
          {list.map((u) => {
            const on = value.includes(u.id)
            return (
              <label key={u.id} className="opt">
                <input type="checkbox" checked={on} onChange={() => onChange(on ? value.filter((x) => x !== u.id) : [...value, u.id])} />
                <Avatar user={u} />
                <span className="grow small">{u.name}</span>
              </label>
            )
          })}
        </>
      )}
    </Pop>
  )
}

export function CasePicker({ value, onChange }: { value?: ID; onChange: (id: ID) => void }) {
  const cases = useApp((s) => s.db.cases)
  const customers = useApp((s) => s.db.customers)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const results = useMemo(() => {
    const t = q.trim().toLowerCase()
    const name = (cid: ID) => customers.find((c) => c.id === cid)?.name ?? ''
    return cases
      .filter((k) => !t || k.number.toLowerCase().includes(t) || k.title.toLowerCase().includes(t) || name(k.customerId).toLowerCase().includes(t))
      .sort((a, b) => Number(['closed', 'lost'].includes(a.stage)) - Number(['closed', 'lost'].includes(b.stage)) || b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 7)
  }, [cases, customers, q])
  const k = value ? cases.find((x) => x.id === value) : undefined
  if (k) {
    return (
      <span className="chip on tk-chip-case" title={k.title}>
        <FolderOpen size={14} /> <span className="num">{k.number}</span> <span className="truncate">{k.title}</span>
        <button type="button" className="tk-chip-x" onClick={() => onChange('')} aria-label="הסרת התיק"><X size={13} /></button>
      </span>
    )
  }
  return (
    <div className="tk-case" onBlur={() => setTimeout(() => setOpen(false), 160)}>
      <input className="input sm" placeholder="קישור לתיק..." value={q} onChange={(e) => { setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)} aria-label="חיפוש תיק" />
      {open && results.length > 0 && (
        <div className="tk-drop card">
          {results.map((x) => (
            <button key={x.id} type="button" className="list-item" onMouseDown={(e) => { e.preventDefault(); onChange(x.id); setQ(''); setOpen(false) }}>
              <div className="grow">
                <div className="small strong truncate">{x.title}</div>
                <div className="tiny muted"><span className="num">{x.number}</span> · {customers.find((c) => c.id === x.customerId)?.name}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------- הוספה מהירה ----------
export function QuickAdd({ caseId, placeholder = 'משימה חדשה...', onAdded }: { caseId?: ID; placeholder?: string; onAdded?: (t: Task) => void }) {
  const me = useMe()
  const users = useApp((s) => s.db.users)
  const cfg = useApp((s) => s.db.config)
  const [title, setTitle] = useState('')
  const [open, setOpen] = useState(false)
  const [priority, setPriority] = useState<string>('normal')
  const [due, setDue] = useState(ymd())
  const [assigneeId, setAssigneeId] = useState(me.id)
  const [kId, setKId] = useState<ID>(caseId ?? '')
  const [shared, setShared] = useState<ID[]>([])
  const [remindAt, setRemindAt] = useState<string>()
  const active = useMemo(() => users.filter((u) => u.active), [users])
  const submit = () => {
    if (!title.trim()) return
    const t = createTask({ title: title.trim(), caseId: kId || undefined, assigneeId, due: due || undefined, priority: priority as Task['priority'], sharedWith: shared, remindAt })
    toast.success(assigneeId === me.id ? 'המשימה נוספה' : `המשימה נשלחה ל${users.find((u) => u.id === assigneeId)?.name ?? ''}`)
    setTitle('')
    setShared([])
    setRemindAt(undefined)
    onAdded?.(t)
  }
  return (
    <form className="tk-add" onSubmit={(e) => { e.preventDefault(); submit() }}>
      <div className="row">
        <input className="input sm" placeholder={placeholder} value={title} onChange={(e) => setTitle(e.target.value)} onFocus={() => setOpen(true)} aria-label="משימה חדשה" />
        <button className="btn sm primary" type="submit" disabled={!title.trim()} aria-label="הוספת משימה"><Plus size={15} /></button>
      </div>
      {(open || title) && (
        <div className="tk-opts">
          <select className="select sm" value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="עדיפות">
            {cfg.taskPriorities.filter((o) => o.active).map((o) => <option key={o.key} value={o.key}>עדיפות {o.label}</option>)}
          </select>
          <input type="date" className="input sm" value={due} onChange={(e) => setDue(e.target.value)} aria-label="תאריך יעד" />
          <select className="select sm" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} aria-label="אחראי">
            {active.map((u) => <option key={u.id} value={u.id}>{u.id === me.id ? 'אני' : u.name}</option>)}
          </select>
          {!caseId && <CasePicker value={kId} onChange={setKId} />}
          <SharePicker value={shared} onChange={setShared} exclude={[assigneeId]} />
          <ReminderPicker value={remindAt} onChange={setRemindAt} />
        </div>
      )}
    </form>
  )
}

// ---------- חלון עריכה / משימה חדשה ----------
export function TaskDialog({ task, caseId, onClose }: { task?: Task; caseId?: ID; onClose: () => void }) {
  const me = useMe()
  const users = useApp((s) => s.db.users)
  const cfg = useApp((s) => s.db.config)
  const active = useMemo(() => users.filter((u) => u.active || u.id === task?.assigneeId), [users, task?.assigneeId])
  const [title, setTitle] = useState(task?.title ?? '')
  const [notes, setNotes] = useState(task?.notes ?? '')
  const [status, setStatus] = useState(task ? statusOf(task) : 'new')
  const [priority, setPriority] = useState<string>(task?.priority ?? 'normal')
  const [due, setDue] = useState(task ? task.due ?? '' : ymd())
  const [assigneeId, setAssigneeId] = useState<ID>(task?.assigneeId ?? me.id)
  const [kId, setKId] = useState<ID>(task?.caseId ?? caseId ?? '')
  const [shared, setShared] = useState<ID[]>(task?.sharedWith ?? [])
  const [remindAt, setRemindAt] = useState<string | undefined>(task?.remindAt)
  const [custom, setCustom] = useState(toLocalInput(task?.remindAt))
  const [confirm, setConfirm] = useState(false)
  const stage = task?.flowStageId ? cfg.flowStages.find((x) => x.id === task.flowStageId) : undefined
  const canDelete = !task || task.createdBy === me.id || me.role === 'admin' || me.role === 'office'
  const name = (id?: ID) => users.find((u) => u.id === id)?.name ?? ''

  const save = () => {
    if (!title.trim()) return
    const data = { title: title.trim(), notes: notes.trim() || undefined, priority: priority as Task['priority'], due: due || undefined, assigneeId, caseId: kId || undefined, sharedWith: shared.filter((x) => x !== assigneeId), remindAt }
    if (task) {
      updateTask(task, { ...data, status })
      toast.success('המשימה עודכנה')
    } else {
      createTask({ ...data, status })
      toast.success('המשימה נוספה')
    }
    onClose()
  }

  return (
    <Modal
      title={task ? 'עריכת משימה' : 'משימה חדשה'}
      onClose={onClose}
      footer={
        <>
          {task && canDelete && <button className="btn ghost danger" style={{ marginInlineEnd: 'auto' }} onClick={() => setConfirm(true)}><Trash2 size={15} /> מחיקה</button>}
          <button className="btn" onClick={onClose}>ביטול</button>
          <button className="btn primary" disabled={!title.trim()} onClick={save}>{task ? 'שמירה' : 'הוספה'}</button>
        </>
      }
    >
      <div className="col" style={{ gap: 14 }}>
        <Field label="משימה"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus={!task} /></Field>
        <div className="grid g3">
          <Field label="סטטוס">
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
              {cfg.taskStatuses.filter((o) => o.active || o.key === status).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="עדיפות">
            <select className="select" value={priority} onChange={(e) => setPriority(e.target.value)}>
              {cfg.taskPriorities.filter((o) => o.active || o.key === priority).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="תאריך יעד"><input type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        </div>
        <div className="grid g2">
          <Field label="אחראי">
            <select className="select" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              {active.map((u) => <option key={u.id} value={u.id}>{u.name}{u.id === me.id ? ' (אני)' : ''}</option>)}
            </select>
          </Field>
          <div className="field">
            <span>תיק</span>
            <div style={{ minHeight: 40, display: 'flex', alignItems: 'center' }}><CasePicker value={kId} onChange={setKId} /></div>
          </div>
        </div>
        <div className="field">
          <span>שיתוף עם</span>
          <div className="tk-share">
            {active.filter((u) => u.id !== assigneeId).map((u) => {
              const on = shared.includes(u.id)
              return (
                <button key={u.id} type="button" className={`chip ${on ? 'on' : ''}`} onClick={() => setShared(on ? shared.filter((x) => x !== u.id) : [...shared, u.id])} aria-pressed={on}>
                  <Avatar user={u} /> {u.name}
                </button>
              )
            })}
          </div>
        </div>
        <div className="field">
          <span>תזכורת</span>
          <div className="row wrap" style={{ gap: 6 }}>
            {reminderPresets().map((p) => (
              <button key={p.key} type="button" className={`chip ${remindAt && p.at && Math.abs(+new Date(remindAt) - +p.at) < 60_000 ? 'on' : ''}`} disabled={p.disabled} onClick={() => { setRemindAt(p.at!.toISOString()); setCustom(toLocalInput(p.at!.toISOString())) }}>
                {p.label}
              </button>
            ))}
            <input type="datetime-local" className="input sm" style={{ width: 210 }} value={custom} onChange={(e) => { setCustom(e.target.value); setRemindAt(fromLocalInput(e.target.value)) }} aria-label="מועד תזכורת אחר" />
            {remindAt && <button type="button" className="btn sm ghost" onClick={() => { setRemindAt(undefined); setCustom('') }}>בלי תזכורת</button>}
          </div>
          {task?.remindedAt && task.remindAt === remindAt && <span className="hint">התזכורת נשלחה {relative(task.remindedAt)}</span>}
        </div>
        <Field label="הערות"><textarea className="textarea" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="פרטים, טלפונים, מה כבר נעשה..." /></Field>
        {task && (
          <div className="tk-info">
            <span>נוצרה ע״י {name(task.createdBy)} · {dateTime(task.createdAt)}</span>
            {stage && <span><Workflow size={12} /> משלב בפלואו: {stage.name}</span>}
            {task.done && task.doneAt && <span>בוצעה ע״י {name(task.doneBy)} · {dateTime(task.doneAt)}</span>}
          </div>
        )}
      </div>
      {confirm && task && <Confirm title="למחוק את המשימה?" text={task.title} confirmLabel="מחיקה" danger onClose={() => setConfirm(false)} onConfirm={() => { deleteTask(task); toast.success('המשימה נמחקה'); onClose() }} />}
    </Modal>
  )
}
