// בקשות חופשה, אישור מנהל ולוח היעדרויות
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CalendarX2, Check, ChevronLeft, ChevronRight, Palmtree, Plus, X } from 'lucide-react'
import { useApp, useMe } from '../../lib/store'
import { Avatar, Badge, Callout, Card, Empty, Field, Modal, PageHead, Tabs, toast } from '../../components/ui'
import type { Tone } from '../../lib/labels'
import { addDays, dateLong, dateShortDay, dateTime, monthTitle, nowIso, relative, uid, ymd } from '../../lib/format'
import type { ID, LeaveRequest } from '../../lib/types'
import { appointmentsInRange, dayStart, dowNames, leaveCovers, leaveWorkDays, leavesOn, useMedia } from '../../features/ops/ops'
import '../../features/ops/ops.css'
import './leave.css'

type TabId = 'mine' | 'pending' | 'board' | 'history'
const statusText: Record<LeaveRequest['status'], [string, Tone]> = {
  pending: ['ממתינה לאישור', 'warning'],
  approved: ['אושרה', 'success'],
  rejected: ['נדחתה', 'danger'],
  cancelled: ['בוטלה', 'muted'],
}
const approvers = (s: ReturnType<typeof useApp.getState>) => s.db.users.filter((u) => u.active && (u.role === 'admin' || u.role === 'office'))

export function leaveDates(l: Pick<LeaveRequest, 'from' | 'to' | 'hours'>) {
  if (l.from === l.to) return dateLong(l.from)
  return `${dateShortDay(l.from)} – ${dateShortDay(l.to)}`
}
function useTypeOf() {
  const types = useApp((s) => s.db.config.leaveTypes)
  return (key: string) => types.find((o) => o.key === key) ?? { key, label: key, color: '#64748b', active: true }
}

export default function Page() {
  const me = useMe()
  const leaves = useApp((s) => s.db.leaves)
  const users = useApp((s) => s.db.users)
  const canApprove = me.role === 'admin' || me.role === 'office'
  const [params, setParams] = useSearchParams()
  const pending = useMemo(() => leaves.filter((l) => l.status === 'pending').sort((a, b) => a.from.localeCompare(b.from)), [leaves])
  const t0 = params.get('tab') as TabId | null
  const [tab, setTab] = useState<TabId>(t0 && (t0 !== 'pending' || canApprove) ? t0 : canApprove && pending.length ? 'pending' : 'mine')
  const [newOpen, setNewOpen] = useState(false)
  const [decide, setDecide] = useState<{ l: LeaveRequest; approve: boolean } | null>(null)
  useEffect(() => { if (tab === 'pending' && !canApprove) setTab('mine') }, [canApprove, tab])
  // קישור מהתראה כשכבר נמצאים בעמוד: ?tab=pending / board
  useEffect(() => { if (t0 && ['mine', 'pending', 'board', 'history'].includes(t0)) setTab(t0) }, [t0])

  const mine = useMemo(() => leaves.filter((l) => l.userId === me.id).sort((a, b) => b.from.localeCompare(a.from)), [leaves, me.id])
  const history = useMemo(() => leaves.filter((l) => l.status !== 'pending' && (canApprove || l.userId === me.id)).sort((a, b) => (b.decidedAt ?? b.createdAt).localeCompare(a.decidedAt ?? a.createdAt)), [leaves, canApprove, me.id])
  const today = ymd()
  const outToday = useMemo(() => leavesOn(leaves, today), [leaves, today])

  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: 'mine', label: 'הבקשות שלי', count: mine.filter((l) => l.status === 'pending').length },
    ...(canApprove ? [{ id: 'pending' as TabId, label: 'ממתינות לאישור', count: pending.length }] : []),
    { id: 'board', label: 'לוח היעדרויות' },
    { id: 'history', label: 'היסטוריה' },
  ]

  return (
    <div className="col" style={{ gap: 16 }}>
      <PageHead
        title="אישורי חופשה"
        sub={canApprove ? `${pending.length} בקשות ממתינות · ${outToday.length ? `היום לא בעבודה: ${outToday.map((l) => users.find((u) => u.id === l.userId)?.name).join(', ')}` : 'היום כל הצוות בעבודה'}` : 'בקשה לחופשה, מחלה או מילואים. ההנהלה מאשרת, והשיבוץ מתעדכן לבד.'}
        actions={<button className="btn primary" onClick={() => setNewOpen(true)}><Plus size={16} /> בקשה חדשה</button>}
      />
      <Tabs value={tab} onChange={(v) => { setTab(v); setParams(v === 'mine' ? {} : { tab: v }, { replace: true }) }} items={tabs} />

      {tab === 'mine' && (
        <Card>
          {mine.length === 0 ? (
            <Empty icon={<Palmtree size={36} />} title="עוד לא הגשת בקשות">
              <button className="btn sm primary mt8" onClick={() => setNewOpen(true)}><Plus size={15} /> בקשה חדשה</button>
            </Empty>
          ) : (
            <div className="list">{mine.map((l) => <LeaveItem key={l.id} l={l} mineView />)}</div>
          )}
        </Card>
      )}

      {tab === 'pending' && canApprove && (
        <Card>
          {pending.length === 0 ? (
            <Empty icon={<Check size={36} />} title="אין בקשות שממתינות לאישור" />
          ) : (
            <div className="list">
              {pending.map((l) => (
                <LeaveItem key={l.id} l={l} showConflicts actions={
                  <>
                    <button className="btn sm success" onClick={() => setDecide({ l, approve: true })}><Check size={15} /> אישור</button>
                    <button className="btn sm ghost danger" onClick={() => setDecide({ l, approve: false })}><X size={15} /> דחייה</button>
                  </>
                } />
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === 'board' && <Board />}

      {tab === 'history' && (
        <Card>
          {history.length === 0 ? <Empty title="אין עדיין היסטוריה" /> : <div className="list">{history.map((l) => <LeaveItem key={l.id} l={l} />)}</div>}
        </Card>
      )}

      {newOpen && <NewRequest onClose={() => setNewOpen(false)} />}
      {decide && <Decide l={decide.l} approve={decide.approve} onClose={() => setDecide(null)} />}
    </div>
  )
}

function LeaveItem({ l, actions, mineView, showConflicts }: { l: LeaveRequest; actions?: ReactNode; mineView?: boolean; showConflicts?: boolean }) {
  const users = useApp((s) => s.db.users)
  const appts = useApp((s) => s.db.appointments)
  const workDays = useApp((s) => s.settings.workDays)
  const typeOf = useTypeOf()
  const [ask, setAsk] = useState(false)
  const u = users.find((x) => x.id === l.userId)
  const t = typeOf(l.type)
  const [st, tone] = statusText[l.status]
  const n = leaveWorkDays(l, { workDays })
  const conflicts = showConflicts ? appointmentsInRange(appts, l.userId, l.from, l.to, l.hours) : []
  const canCancel = mineView && (l.status === 'pending' || (l.status === 'approved' && l.to >= ymd()))
  return (
    <div className="lv-item">
      <Avatar user={u} />
      <div className="grow">
        <div className="row wrap" style={{ gap: 8 }}>
          {!mineView && <b>{u?.name}</b>}
          <span className="badge" style={{ background: `${t.color}1f`, color: t.color }}>{t.label}</span>
          <Badge tone={tone}>{st}</Badge>
        </div>
        <div className="lv-when">
          {leaveDates(l)}
          {l.hours && <> · <span className="ltr">{l.hours.start}–{l.hours.end}</span></>}
        </div>
        <div className="lv-sub">
          {l.hours ? <span>חלק מיום</span> : <span>{n === 1 ? 'יום עבודה אחד' : `${n} ימי עבודה`}</span>}
          <span>הוגשה {relative(l.createdAt)}</span>
          {l.decidedAt && <span>{l.status === 'cancelled' ? 'בוטלה' : l.status === 'approved' ? 'אושרה' : 'נדחתה'} ע״י {users.find((x) => x.id === l.decidedBy)?.name ?? '—'} · {dateTime(l.decidedAt)}</span>}
        </div>
        {l.reason && <div className="lv-reason">{l.reason}</div>}
        {l.decisionNote && <div className="lv-note">הערת המאשר: {l.decisionNote}</div>}
        {conflicts.length > 0 && (
          <Callout tone="warning">
            <div className="lv-conf">
              <b>{conflicts.length === 1 ? 'משובץ למשימה אחת בימים האלה' : `משובץ ל-${conflicts.length} משימות בימים האלה`}</b>
              {conflicts.slice(0, 4).map((a) => <Link key={a.id} to={`/calendar?open=${a.id}`}>{dateShortDay(a.start)} · {a.title}</Link>)}
            </div>
          </Callout>
        )}
      </div>
      {(actions || canCancel) && (
        <div className="lv-acts">
          {actions}
          {canCancel && <button className="btn sm ghost danger" onClick={() => setAsk(true)}>ביטול הבקשה</button>}
        </div>
      )}
      {ask && (
        <Modal title="לבטל את הבקשה?" size="narrow" onClose={() => setAsk(false)} footer={<><button className="btn" onClick={() => setAsk(false)}>חזרה</button><button className="btn danger" onClick={() => { cancelLeave(l); setAsk(false) }}>ביטול הבקשה</button></>}>
          <p>{t.label} · {leaveDates(l)}{l.status === 'approved' ? '. ההנהלה תקבל עדכון שהחופשה בוטלה.' : ''}</p>
        </Modal>
      )}
    </div>
  )
}

function cancelLeave(l: LeaveRequest) {
  const s = useApp.getState()
  s.patch('leaves', l.id, { status: 'cancelled', decidedAt: nowIso(), decidedBy: s.currentUserId })
  if (l.status === 'approved') {
    const who = s.db.users.find((u) => u.id === l.userId)?.name ?? ''
    approvers(s).filter((u) => u.id !== s.currentUserId).forEach((u) => s.notify(u.id, `${who}: חופשה שאושרה בוטלה (${leaveDates(l)})`, '/leave?tab=board'))
  }
  toast.success('הבקשה בוטלה')
}

function NewRequest({ onClose }: { onClose: () => void }) {
  const me = useMe()
  const users = useApp((s) => s.db.users)
  const leaves = useApp((s) => s.db.leaves)
  const appts = useApp((s) => s.db.appointments)
  const types = useApp((s) => s.db.config.leaveTypes)
  const canApprove = me.role === 'admin' || me.role === 'office'
  const active = useMemo(() => types.filter((o) => o.active), [types])
  const [userId, setUserId] = useState<ID>(me.id)
  const [type, setType] = useState(active[0]?.key ?? '')
  const [from, setFrom] = useState(ymd(addDays(new Date(), 1)))
  const [to, setTo] = useState(ymd(addDays(new Date(), 1)))
  const [partial, setPartial] = useState(false)
  const [start, setStart] = useState('08:00')
  const [end, setEnd] = useState('12:00')
  const [reason, setReason] = useState('')
  const oneDay = from === to
  const hours = partial && oneDay ? { start, end } : undefined
  const bad = !type || !from || !to || to < from || (hours && hours.end <= hours.start)
  const conflicts = useMemo(() => (from && to && to >= from ? appointmentsInRange(appts, userId, from, to, hours) : []), [appts, userId, from, to, hours?.start, hours?.end])
  const overlap = leaves.find((l) => l.userId === userId && (l.status === 'pending' || l.status === 'approved') && l.from <= to && from <= l.to)

  const submit = () => {
    if (bad) return
    const s = useApp.getState()
    const l: LeaveRequest = { id: uid('lv'), userId, type, from, to, hours, reason: reason.trim() || undefined, status: 'pending', createdAt: nowIso() }
    s.upsert('leaves', l)
    const who = s.db.users.find((u) => u.id === userId)?.name ?? ''
    const tl = types.find((o) => o.key === type)?.label ?? type
    approvers(s).filter((u) => u.id !== s.currentUserId).forEach((u) => s.notify(u.id, `בקשת ${tl} מ${who}: ${leaveDates(l)}`, '/leave?tab=pending'))
    if (userId !== s.currentUserId) s.notify(userId, `נרשמה עבורך בקשת ${tl}: ${leaveDates(l)}`, '/leave')
    toast.success('הבקשה נשלחה לאישור')
    onClose()
  }

  return (
    <Modal title="בקשת חופשה" onClose={onClose} footer={<><button className="btn" onClick={onClose}>ביטול</button><button className="btn primary" disabled={bad} onClick={submit}>שליחה לאישור</button></>}>
      <div className="col" style={{ gap: 14 }}>
        <div className="grid g2">
          {canApprove && (
            <Field label="עבור">
              <select className="select" value={userId} onChange={(e) => setUserId(e.target.value)}>
                {users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}{u.id === me.id ? ' (אני)' : ''}</option>)}
              </select>
            </Field>
          )}
          <Field label="סוג">
            <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
              {active.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid g2">
          <Field label="מתאריך"><input type="date" className="input" value={from} onChange={(e) => { setFrom(e.target.value); if (!to || to < e.target.value) setTo(e.target.value) }} /></Field>
          <Field label="עד תאריך (כולל)"><input type="date" className="input" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        {oneDay && (
          <div className="col" style={{ gap: 8 }}>
            <label className="check"><input type="checkbox" checked={partial} onChange={(e) => setPartial(e.target.checked)} /> רק חלק מהיום</label>
            {partial && (
              <div className="grid g2">
                <Field label="משעה"><input type="time" className="input" step={900} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
                <Field label="עד שעה"><input type="time" className="input" step={900} value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
              </div>
            )}
          </div>
        )}
        <Field label="סיבה / הערה (לא חובה)"><textarea className="textarea" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="למשל: חתונה של אח, צו 8, טיפול רפואי" /></Field>
        {to < from && <Callout tone="danger">תאריך הסיום לפני תאריך ההתחלה.</Callout>}
        {overlap && <Callout tone="warning">כבר יש בקשה ({statusText[overlap.status][0]}) לימים {leaveDates(overlap)}.</Callout>}
        {conflicts.length > 0 && (
          <Callout tone="warning">
            <div className="lv-conf">
              <b>{userId === me.id ? 'יש לך' : 'לעובד יש'} {conflicts.length === 1 ? 'משימה אחת' : `${conflicts.length} משימות`} בימים האלה. המשרד יצטרך לשבץ מחליף:</b>
              {conflicts.slice(0, 4).map((a) => <span key={a.id}>{dateShortDay(a.start)} · {a.title}</span>)}
            </div>
          </Callout>
        )}
      </div>
    </Modal>
  )
}

function Decide({ l, approve, onClose }: { l: LeaveRequest; approve: boolean; onClose: () => void }) {
  const users = useApp((s) => s.db.users)
  const appts = useApp((s) => s.db.appointments)
  const leaves = useApp((s) => s.db.leaves)
  const typeOf = useTypeOf()
  const [note, setNote] = useState('')
  const u = users.find((x) => x.id === l.userId)
  const conflicts = useMemo(() => appointmentsInRange(appts, l.userId, l.from, l.to, l.hours), [appts, l])
  const others = useMemo(() => leaves.filter((x) => x.id !== l.id && x.userId !== l.userId && x.status === 'approved' && x.from <= l.to && l.from <= x.to), [leaves, l])
  const save = () => {
    const s = useApp.getState()
    s.patch('leaves', l.id, { status: approve ? 'approved' : 'rejected', decidedBy: s.currentUserId, decidedAt: nowIso(), decisionNote: note.trim() || undefined })
    const tl = typeOf(l.type).label
    s.notify(l.userId, `${approve ? 'אושרה' : 'נדחתה'} בקשת ה${tl} שלך (${leaveDates(l)})${note.trim() ? `: ${note.trim()}` : ''}`, '/leave')
    toast.success(approve ? `החופשה של ${u?.name ?? ''} אושרה` : 'הבקשה נדחתה')
    onClose()
  }
  return (
    <Modal
      title={approve ? 'אישור חופשה' : 'דחיית בקשה'}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>ביטול</button><button className={`btn ${approve ? 'success' : 'danger'}`} onClick={save}>{approve ? (conflicts.length ? 'לאשר בכל זאת' : 'אישור החופשה') : 'דחיית הבקשה'}</button></>}
    >
      <div className="col" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 10 }}>
          <Avatar user={u} size="lg" />
          <div>
            <div className="strong">{u?.name} · {typeOf(l.type).label}</div>
            <div className="small muted">{leaveDates(l)}{l.hours ? ` · ${l.hours.start}–${l.hours.end}` : ''}</div>
          </div>
        </div>
        {l.reason && <div className="lv-reason">{l.reason}</div>}
        {approve && conflicts.length > 0 && (
          <Callout tone="danger">
            <div className="lv-conf">
              <b>{u?.name} משובץ {conflicts.length === 1 ? 'למשימה אחת' : `ל-${conflicts.length} משימות`} בימים האלה. אחרי האישור צריך לשבץ מחליף:</b>
              {conflicts.map((a) => <Link key={a.id} to={`/calendar?open=${a.id}`} onClick={onClose}>{dateShortDay(a.start)} · {a.title}</Link>)}
            </div>
          </Callout>
        )}
        {approve && others.length > 0 && (
          <Callout tone="warning">באותם ימים כבר בחופשה: {others.map((x) => `${users.find((y) => y.id === x.userId)?.name} (${leaveDates(x)})`).join(', ')}</Callout>
        )}
        <Field label={approve ? 'הערה לעובד (לא חובה)' : 'סיבת הדחייה'}>
          <textarea className="textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={approve ? 'חופשה נעימה!' : 'למשל: עומס התקנות באותו שבוע, אפשר להזיז בשבוע?'} />
        </Field>
      </div>
    </Modal>
  )
}

// ---------- לוח היעדרויות ----------
function Board() {
  const leaves = useApp((s) => s.db.leaves)
  const users = useApp((s) => s.db.users)
  const typeOf = useTypeOf()
  const mobile = useMedia('(max-width: 700px)')
  const [anchor, setAnchor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [withPending, setWithPending] = useState(true)
  const statuses: LeaveRequest['status'][] = withPending ? ['approved', 'pending'] : ['approved']
  const days = useMemo(() => {
    const s = addDays(anchor, -anchor.getDay())
    const dim = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate()
    const weeks = Math.ceil((anchor.getDay() + dim) / 7)
    return Array.from({ length: weeks * 7 }, (_, i) => addDays(s, i))
  }, [anchor])
  const today = ymd()
  const on = (k: string) => leavesOn(leaves, k, undefined, statuses)
  const chip = (l: LeaveRequest) => {
    const t = typeOf(l.type)
    const u = users.find((x) => x.id === l.userId)
    return (
      <span key={l.id} className={`lv-chip ${l.status === 'pending' ? 'pending' : ''}`} style={{ background: `${t.color}1f`, color: t.color, borderColor: t.color }} title={`${u?.name} · ${t.label}${l.status === 'pending' ? ' (ממתין)' : ''}${l.hours ? ` ${l.hours.start}–${l.hours.end}` : ''}`}>
        {u?.name.split(' ')[0]}{l.hours ? ` ${l.hours.start}` : ''}
      </span>
    )
  }
  const monthDays = days.filter((d) => d.getMonth() === anchor.getMonth() && on(ymd(d)).length)
  const usedTypes = [...new Set(leaves.map((l) => l.type))]

  return (
    <Card>
      <div className="cal-toolbar">
        <div className="row">
          <button className="icon-btn" onClick={() => setAnchor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))} aria-label="החודש הקודם"><ChevronRight size={18} /></button>
          <button className="btn sm" onClick={() => setAnchor(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>החודש</button>
          <button className="icon-btn" onClick={() => setAnchor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))} aria-label="החודש הבא"><ChevronLeft size={18} /></button>
          <h2 className="cal-title">{monthTitle(anchor)}</h2>
        </div>
        <label className="check small"><input type="checkbox" checked={withPending} onChange={(e) => setWithPending(e.target.checked)} /> גם בקשות שממתינות</label>
      </div>
      {mobile ? (
        monthDays.length === 0 ? <Empty icon={<CalendarX2 size={34} />} title="אין היעדרויות בחודש הזה" /> : (
          <div className="lv-days">
            {monthDays.map((d) => (
              <div key={ymd(d)} className="lv-day">
                <b className="small">{dateLong(d)}{ymd(d) === today ? ' · היום' : ''}</b>
                <div className="row">{on(ymd(d)).map(chip)}</div>
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="cal-grid lv-board">
          {dowNames.map((n) => <div key={n} className="cal-dow">{n}</div>)}
          {days.map((d) => {
            const k = ymd(d)
            const list = on(k)
            return (
              <div key={k} className={`cal-cell ${d.getMonth() !== anchor.getMonth() ? 'out' : ''} ${k === today ? 'today' : ''} ${dayStart(d).getDay() === 6 ? 'blocked' : ''}`}>
                <div className="cal-top"><span className="cal-num">{d.getDate()}</span>{list.length > 0 && <span className="tiny muted">{list.length}</span>}</div>
                {list.slice(0, 4).map(chip)}
                {list.length > 4 && <span className="cal-more">+{list.length - 4}</span>}
              </div>
            )
          })}
        </div>
      )}
      <div className="lv-legend">
        {usedTypes.map((k) => { const t = typeOf(k); return <span key={k}><i className="dotc" style={{ background: t.color }} />{t.label}</span> })}
        <span><i className="lv-chip pending" style={{ width: 18, height: 12, padding: 0, borderColor: 'var(--text-3)' }} /> ממתין לאישור</span>
      </div>
      {leaves.some((l) => l.status === 'approved' && leaveCovers(l, today)) && <div className="tiny muted" style={{ padding: '0 14px 12px' }}>חופשות שאושרו חוסמות שיבוץ של העובד בלוח הזמנים.</div>}
    </Card>
  )
}
