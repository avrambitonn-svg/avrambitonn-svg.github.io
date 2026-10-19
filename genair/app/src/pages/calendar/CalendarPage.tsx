import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Bell, CalendarPlus, ChevronLeft, ChevronRight, Download, FolderOpen, HardHat, MapPin, MessageCircle, Navigation, Palmtree, Phone, Plus, Wrench, XCircle } from 'lucide-react'
import { Avatars, Badge, Card, Confirm, Empty, Modal, PageHead, toast } from '../../components/ui'
import { useApp, useMe } from '../../lib/store'
import type { Appointment, AppointmentStatus, AppointmentType, ID, LeaveRequest, User } from '../../lib/types'
import { appointmentStatusLabel, appointmentTypeColor, appointmentTypeLabel } from '../../lib/labels'
import { addDays, dateLong, monthTitle, phone as fmtPhone, time as fmtTime, ymd } from '../../lib/format'
import { dayStatus } from '../../lib/integrations/hebcal'
import { outdoorRisk, weatherIcon } from '../../lib/integrations/weather'
import { download, googleCalendarLink, icsFile, telLink, wazeLink } from '../../lib/integrations/links'
import { fill } from '../../lib/messaging'
import { ScheduleDialog } from '../../features/schedule/ScheduleDialog'
import { MessageModal } from '../../features/ops/MessageBox'
import {
  addressLine, dayStart, dow, dowLetters, dowNames, hhmmOf, icsEvent, jobContext, layoutLanes, leavesOn, messageVars, readPref, toMin, useForecast, useHebcal, useMedia, writePref,
} from '../../features/ops/ops'
import '../../features/ops/ops.css'
import './calendar.css'

type View = 'month' | 'week' | 'day'
const allTypes: AppointmentType[] = ['installation', 'survey', 'service', 'maintenance', 'inspection', 'meeting']
const HOUR = 44
const statusTone: Record<AppointmentStatus, 'muted' | 'info' | 'brand' | 'warning' | 'success' | 'danger'> = {
  planned: 'muted', confirmed: 'info', on_the_way: 'brand', in_progress: 'warning', done: 'success', cancelled: 'danger',
}

export default function CalendarPage() {
  const appts = useApp((s) => s.db.appointments)
  const users = useApp((s) => s.db.users)
  const customers = useApp((s) => s.db.customers)
  const leaves = useApp((s) => s.db.leaves)
  const leaveTypes = useApp((s) => s.db.config.leaveTypes)
  const me = useMe()
  const mobile = useMedia('(max-width: 700px)')
  const [view, setViewState] = useState<View>(() => readPref('genair-cal-view', 'month', ['month', 'week', 'day'] as const))
  const setView = (v: View) => { setViewState(v); writePref('genair-cal-view', v) }
  const [anchor, setAnchor] = useState(() => dayStart(new Date()))
  const [userF, setUserF] = useState<ID | ''>(me.role === 'installer' ? me.id : '')
  const [types, setTypes] = useState<AppointmentType[]>(allTypes)
  const [selDay, setSelDay] = useState(ymd(new Date()))
  const [openId, setOpenId] = useState<ID | null>(null)
  const [msgFor, setMsgFor] = useState<Appointment | null>(null)
  const [newOn, setNewOn] = useState<string | null>(null)
  const todayKey = ymd(new Date())
  // קישור ישיר לשיבוץ: /calendar?new=installation&case=k2 (גם call / contract / customer / date)
  const [params, setParams] = useSearchParams()
  const deep = params.get('new') as AppointmentType | null
  const closeDeep = () => setParams({}, { replace: true })
  // קישור למשימה מסוימת: /calendar?open=<id> (למשל מאישור חופשה)
  const openParam = params.get('open')
  useEffect(() => {
    if (!openParam) return
    const a = appts.find((x) => x.id === openParam)
    if (a) {
      setAnchor(dayStart(a.start))
      setSelDay(ymd(a.start))
      setOpenId(a.id)
    }
    params.delete('open')
    setParams(params, { replace: true })
  }, [openParam])

  // טווח התצוגה
  const range = useMemo(() => {
    if (view === 'day') return { start: anchor, days: [anchor] }
    if (view === 'week') {
      const s = addDays(anchor, -anchor.getDay())
      return { start: s, days: Array.from({ length: 7 }, (_, i) => addDays(s, i)) }
    }
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
    const s = addDays(first, -first.getDay())
    const dim = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate()
    const weeks = Math.ceil((first.getDay() + dim) / 7)
    return { start: s, days: Array.from({ length: weeks * 7 }, (_, i) => addDays(s, i)) }
  }, [view, anchor])
  const rangeEnd = range.days[range.days.length - 1]
  const { cal } = useHebcal(range.start, rangeEnd)
  const weather = useForecast()

  const visible = useMemo(() => {
    const from = ymd(range.start)
    const to = ymd(rangeEnd)
    return appts
      .filter((a) => a.status !== 'cancelled' && types.includes(a.type) && (!userF || a.userIds.includes(userF)))
      .filter((a) => ymd(a.start) >= from && ymd(a.start) <= to)
      .sort((a, b) => a.start.localeCompare(b.start))
  }, [appts, types, userF, range.start, rangeEnd])

  const byDay = useMemo(() => {
    const m: Record<string, Appointment[]> = {}
    visible.forEach((a) => (m[ymd(a.start)] ??= []).push(a))
    return m
  }, [visible])

  const custName = (a: Appointment) => customers.find((c) => c.id === a.customerId)?.name
  const team = (a: Appointment) => a.userIds.map((id) => users.find((u) => u.id === id))
  const opened = openId ? appts.find((a) => a.id === openId) : undefined

  const step = (n: number) => {
    if (view === 'day') {
      const next = addDays(anchor, n)
      setAnchor(next)
      setSelDay(ymd(next))
    } else if (view === 'week') setAnchor((d) => addDays(d, 7 * n))
    else setAnchor((d) => new Date(d.getFullYear(), d.getMonth() + n, 1))
  }
  const goToday = () => { setAnchor(dayStart(new Date())); setSelDay(todayKey) }

  const title = view === 'month'
    ? monthTitle(anchor)
    : view === 'day'
      ? dateLong(anchor)
      : (() => {
        const a = range.days[0]
        const b = range.days[6]
        return a.getMonth() === b.getMonth() ? `${a.getDate()}–${b.getDate()} ${monthTitle(a)}` : `${a.getDate()}.${a.getMonth() + 1} – ${b.getDate()}.${b.getMonth() + 1}.${String(b.getFullYear()).slice(2)}`
      })()

  const exportIcs = () => {
    if (!visible.length) return toast.info('אין משימות בתצוגה לייצוא')
    const db = useApp.getState().db
    download(icsFile(visible.map((a) => icsEvent(db, a))), `genair-${view}-${ymd(range.start)}.ics`)
    toast.success(`יוצאו ${visible.length} משימות לקובץ יומן`)
  }

  const counts = useMemo(() => {
    const inst = visible.filter((a) => a.type === 'installation').length
    const svc = visible.filter((a) => a.type === 'service' || a.type === 'maintenance' || a.type === 'inspection').length
    return { all: visible.length, inst, svc }
  }, [visible])

  // חופשות שאושרו (לפי סינון העובד)
  const leavesFor = (k: string) => leavesOn(leaves, k).filter((l) => !userF || l.userId === userF)
  const leaveType = (key: string) => leaveTypes.find((o) => o.key === key)
  const outInRange = useMemo(() => new Set(range.days.flatMap((d) => leavesOn(leaves, ymd(d)).filter((l) => !userF || l.userId === userF).map((l) => l.userId))).size, [leaves, range.days, userF])
  const userOf = (id: ID) => users.find((u) => u.id === id)
  const selStatus = dayStatus(dayStart(selDay), cal)
  const selEvents = byDay[selDay] ?? []
  const canAddOn = (k: string) => k >= todayKey && dayStatus(dayStart(k), cal).ok

  return (
    <div className="col" style={{ gap: 16 }}>
      <PageHead
        title="לוח זמנים"
        sub={`${counts.all} משימות ב${view === 'week' ? 'שבוע' : view === 'day' ? 'יום' : 'חודש'} הזה · ${counts.inst} התקנות · ${counts.svc} שירות ותחזוקה${outInRange ? ` · ${outInRange} בחופשה` : ''}`}
        actions={
          <>
            <button className="btn" onClick={exportIcs}><Download size={16} /> ייצוא ליומן</button>
            <button className="btn primary" onClick={() => setNewOn(canAddOn(selDay) ? selDay : '')}><Plus size={16} /> פגישה חדשה</button>
          </>
        }
      />

      {weather.length > 0 && (
        <div className="wx-strip" aria-label="תחזית לימים הקרובים">
          {weather.slice(0, 7).map((f, i) => {
            const risk = outdoorRisk(f)
            return (
              <div key={f.date} className={`wx-day ${risk ? 'risk' : ''}`} title={risk ?? `${f.tMin}°–${f.tMax}°`}>
                <span className="tiny muted">{i === 0 ? 'היום' : i === 1 ? 'מחר' : `יום ${dow(f.date)}`}</span>
                <span className="wx-ic">{weatherIcon(f.code)}</span>
                <span><b>{f.tMax}°</b> <span className="muted small">{f.tMin}°</span></span>
                <span className={`tiny ${f.rainProb >= 50 ? 'txt-brand strong' : 'muted'}`}>גשם {f.rainProb}%</span>
              </div>
            )
          })}
        </div>
      )}

      <Card>
        <div className="cal-toolbar">
          <div className="row">
            <button className="icon-btn" onClick={() => step(-1)} aria-label="הקודם"><ChevronRight size={18} /></button>
            <button className="btn sm" onClick={goToday}>היום</button>
            <button className="icon-btn" onClick={() => step(1)} aria-label="הבא"><ChevronLeft size={18} /></button>
            <h2 className="cal-title">{title}</h2>
          </div>
          <div className="row wrap" style={{ gap: 8 }}>
            <select className="select sm" style={{ width: 'auto' }} value={userF} onChange={(e) => setUserF(e.target.value)} aria-label="סינון לפי עובד">
              <option value="">כל הצוות</option>
              {users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <div className="seg">
              <button className={view === 'month' ? 'on' : ''} onClick={() => setView('month')}>חודש</button>
              <button className={view === 'week' ? 'on' : ''} onClick={() => setView('week')}>שבוע</button>
              <button className={view === 'day' ? 'on' : ''} onClick={() => { setView('day'); setAnchor(dayStart(selDay)) }}>יום</button>
            </div>
          </div>
        </div>
        <div className="cal-types">
          {allTypes.map((t) => {
            const on = types.includes(t)
            return (
              <button key={t} className={`chip ${on ? 'on' : ''}`} onClick={() => setTypes((l) => (on ? l.filter((x) => x !== t) : [...l, t]))} aria-pressed={on}>
                <span className="dotc" style={{ background: on ? appointmentTypeColor[t] : '#c5cdd5' }} /> {appointmentTypeLabel[t]}
              </button>
            )
          })}
        </div>

        {view === 'month' ? (
          <div className={`cal-grid cal-month ${mobile ? 'compact' : ''}`}>
            {dowNames.map((n, i) => <div key={n} className="cal-dow">{mobile ? dowLetters[i] : n}</div>)}
            {range.days.map((d) => {
              const k = ymd(d)
              const ds = dayStatus(d, cal)
              const evs = byDay[k] ?? []
              const out = d.getMonth() !== anchor.getMonth()
              const candles = cal.candles[k]
              const lbl = !ds.ok ? ds.label : candles ? `נרות ${candles}` : ds.label
              return (
                <div
                  key={k}
                  className={`cal-cell ${out ? 'out' : ''} ${k === todayKey ? 'today' : ''} ${!ds.ok ? 'blocked' : ''} ${k === selDay ? 'sel' : ''}`}
                  onClick={() => setSelDay(k)}
                  onDoubleClick={() => canAddOn(k) && setNewOn(k)}
                >
                  <div className="cal-top">
                    <span className="cal-num">{d.getDate()}</span>
                    {lbl && !mobile && <span className={`cal-lbl ${!ds.ok ? 'blk' : ds.short ? 'short' : ''}`} title={lbl}>{lbl}</span>}
                  </div>
                  {mobile ? (
                    <div className="cal-dots">
                      {evs.slice(0, 4).map((a) => <i key={a.id} style={{ background: appointmentTypeColor[a.type] }} />)}
                      {evs.length > 4 && <span className="tiny muted">+</span>}
                      {ds.ok && leavesFor(k).length > 0 && <Palmtree size={10} className="cal-out-ic" aria-label="יש עובדים בחופשה" />}
                    </div>
                  ) : (
                    <>
                      {ds.ok && <LeaveLine list={leavesFor(k)} userOf={userOf} typeOf={leaveType} />}
                      {evs.slice(0, 3).map((a) => (
                        <div
                          key={a.id}
                          className={`cal-ev ${a.status === 'done' ? 'done' : ''}`}
                          style={{ background: appointmentTypeColor[a.type] }}
                          title={`${fmtTime(a.start)} ${a.title}`}
                          onClick={(e) => { e.stopPropagation(); setOpenId(a.id) }}
                        >
                          <span className="num">{fmtTime(a.start)}</span> {a.title}
                        </div>
                      ))}
                      {evs.length > 3 && <span className="cal-more">+{evs.length - 3} נוספות</span>}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        ) : mobile ? (
          <div className="agenda">
            {range.days.map((d) => {
              const k = ymd(d)
              const ds = dayStatus(d, cal)
              const evs = byDay[k] ?? []
              return (
                <div key={k} className={`ag-day ${!ds.ok ? 'blocked' : ''} ${k === todayKey ? 'today' : ''}`}>
                  <div className="ag-head">
                    <b>יום {dowNames[d.getDay()]}</b>
                    <span className="muted">{d.getDate()}.{d.getMonth() + 1}</span>
                    {ds.label && <Badge tone={!ds.ok ? 'muted' : ds.short ? 'warning' : 'info'}>{ds.label}{ds.short && ds.endBy ? ` · עד ${ds.endBy}` : ''}</Badge>}
                    {k === todayKey && <Badge tone="brand">היום</Badge>}
                  </div>
                  {ds.ok && leavesFor(k).length > 0 && <OutToday list={leavesFor(k)} userOf={userOf} typeOf={leaveType} />}
                  {evs.length ? evs.map((a) => <EventRow key={a.id} a={a} customer={custName(a)} team={team(a)} onClick={() => setOpenId(a.id)} />) : <div className="tiny muted" style={{ padding: '4px 2px' }}>{ds.ok ? 'אין משימות' : 'לא עובדים'}</div>}
                </div>
              )
            })}
          </div>
        ) : (
          <WeekGrid days={range.days} byDay={byDay} cal={cal} todayKey={todayKey} onOpen={setOpenId} onNew={(k) => canAddOn(k) && setNewOn(k)} customerName={custName} leavesFor={leavesFor} userOf={userOf} typeOf={leaveType}
            onDay={view === 'week' ? (k) => { setSelDay(k); setAnchor(dayStart(k)); setView('day') } : undefined} />
        )}
      </Card>

      {view === 'month' && (
        <Card
          title={
            <div className="row wrap" style={{ gap: 8 }}>
              <h2>{dateLong(selDay)}</h2>
              {selStatus.label && <Badge tone={!selStatus.ok ? 'muted' : selStatus.short ? 'warning' : 'info'}>{selStatus.label}{selStatus.short && selStatus.endBy ? ` · לסיים עד ${selStatus.endBy}` : ''}</Badge>}
            </div>
          }
          actions={canAddOn(selDay) ? <button className="btn sm" onClick={() => setNewOn(selDay)}><Plus size={15} /> שיבוץ ביום הזה</button> : undefined}
        >
          {selStatus.ok && leavesFor(selDay).length > 0 && <OutToday list={leavesFor(selDay)} userOf={userOf} typeOf={leaveType} />}
          {selEvents.length ? (
            <div className="list">{selEvents.map((a) => <EventRow key={a.id} a={a} customer={custName(a)} team={team(a)} onClick={() => setOpenId(a.id)} />)}</div>
          ) : (
            <Empty title={selStatus.ok ? 'אין משימות ביום הזה' : `${selStatus.label}: לא עובדים`}>{selStatus.ok && canAddOn(selDay) ? 'אפשר לשבץ משימה חדשה מהכפתור למעלה' : undefined}</Empty>
          )}
        </Card>
      )}

      {opened && <EventModal ap={opened} onClose={() => setOpenId(null)} onMessage={() => { setMsgFor(opened); setOpenId(null) }} />}
      {msgFor && <ReminderModal ap={msgFor} onClose={() => setMsgFor(null)} />}
      {newOn !== null && <ScheduleDialog type="meeting" date={newOn || undefined} onClose={() => setNewOn(null)} />}
      {deep && allTypes.includes(deep) && (
        <ScheduleDialog
          type={deep}
          caseId={params.get('case') ?? undefined}
          serviceCallId={params.get('call') ?? undefined}
          contractId={params.get('contract') ?? undefined}
          customerId={params.get('customer') ?? undefined}
          date={params.get('date') ?? undefined}
          onClose={closeDeep}
        />
      )}
    </div>
  )
}

function EventRow({ a, customer, team, onClick }: { a: Appointment; customer?: string; team: Parameters<typeof Avatars>[0]['users']; onClick: () => void }) {
  return (
    <button className="list-item click ev-row" onClick={onClick}>
      <span className="ev-bar" style={{ background: appointmentTypeColor[a.type] }} />
      <span className="num ev-time">{fmtTime(a.start)}<span className="muted">–{fmtTime(a.end)}</span></span>
      <span className="grow" style={{ textAlign: 'start' }}>
        <span className="strong truncate" style={{ display: 'block' }}>{a.title}</span>
        <span className="tiny muted">{appointmentTypeLabel[a.type]}{customer ? ` · ${customer}` : ''}</span>
      </span>
      {a.status !== 'planned' && <Badge tone={statusTone[a.status]}>{appointmentStatusLabel[a.status]}</Badge>}
      <Avatars users={team} />
    </button>
  )
}

type LeaveTypeOf = (key: string) => { label: string; color?: string } | undefined
type UserOf = (id: ID) => User | undefined

// מי בחופשה ביום: שורה קצרה בתא של החודש
function LeaveLine({ list, userOf, typeOf }: { list: LeaveRequest[]; userOf: UserOf; typeOf: LeaveTypeOf }) {
  if (!list.length) return null
  const names = list.map((l) => userOf(l.userId)?.name.split(' ')[0]).filter(Boolean)
  const color = typeOf(list[0].type)?.color ?? '#16a34a'
  const title = list.map((l) => `${userOf(l.userId)?.name ?? ''} · ${typeOf(l.type)?.label ?? 'חופשה'}${l.hours ? ` ${l.hours.start}–${l.hours.end}` : ''}`).join('\n')
  return (
    <div className="cal-out" style={{ color, background: `${color}14`, borderColor: `${color}55` }} title={title}>
      <Palmtree size={11} /> <span className="truncate">{names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ')}</span>
    </div>
  )
}

function OutToday({ list, userOf, typeOf }: { list: LeaveRequest[]; userOf: UserOf; typeOf: LeaveTypeOf }) {
  return (
    <div className="cal-out-list">
      <Palmtree size={14} />
      <span className="small">לא בעבודה:</span>
      {list.map((l) => {
        const t = typeOf(l.type)
        return (
          <span key={l.id} className="cal-out" style={{ color: t?.color, background: `${t?.color ?? '#16a34a'}14`, borderColor: `${t?.color ?? '#16a34a'}55` }}>
            {userOf(l.userId)?.name} · {t?.label ?? 'חופשה'}{l.hours ? <> <span className="ltr">{l.hours.start}–{l.hours.end}</span></> : null}
          </span>
        )
      })}
    </div>
  )
}

function WeekGrid({ days, byDay, cal, todayKey, onOpen, onNew, customerName, leavesFor, userOf, typeOf, onDay }: {
  days: Date[]; byDay: Record<string, Appointment[]>; cal: Parameters<typeof dayStatus>[1]; todayKey: string; onOpen: (id: ID) => void; onNew: (k: string) => void; customerName: (a: Appointment) => string | undefined
  leavesFor: (k: string) => LeaveRequest[]; userOf: UserOf; typeOf: LeaveTypeOf; onDay?: (k: string) => void
}) {
  const one = days.length === 1
  const all = days.flatMap((d) => byDay[ymd(d)] ?? [])
  const minH = Math.min(7, ...all.map((a) => new Date(a.start).getHours()))
  const maxH = Math.max(19, ...all.map((a) => Math.ceil(toMin(hhmmOf(a.end)) / 60)))
  const hours = Array.from({ length: maxH - minH }, (_, i) => minH + i)
  const y = (hhmm: string) => ((toMin(hhmm) - minH * 60) / 60) * HOUR
  const now = new Date()
  return (
    <div className="wk-wrap">
      <div className={`wk ${one ? 'one' : ''}`} style={{ ['--h' as string]: `${hours.length * HOUR}px` }}>
        <div className="wk-corner" />
        {days.map((d) => {
          const k = ymd(d)
          const ds = dayStatus(d, cal)
          return (
            <div key={k} className={`wk-dh ${k === todayKey ? 'today' : ''} ${!ds.ok ? 'blocked' : ''} ${onDay ? 'click' : ''}`} onClick={onDay ? () => onDay(k) : undefined} title={onDay ? 'תצוגת יום' : undefined}>
              <span className="tiny muted">{dowNames[d.getDay()]}</span>
              <b className={k === todayKey ? 'today-num' : ''}>{d.getDate()}</b>
              <span className={`tiny truncate ${ds.short ? 'txt-warning' : 'muted'}`} title={ds.label}>{ds.label && ds.label !== dowNames[d.getDay()] ? (ds.short && ds.endBy ? `עד ${ds.endBy}` : ds.label) :' '}</span>
              {ds.ok && leavesFor(k).length > 0 && (one ? <OutToday list={leavesFor(k)} userOf={userOf} typeOf={typeOf} /> : <LeaveLine list={leavesFor(k)} userOf={userOf} typeOf={typeOf} />)}
            </div>
          )
        })}
        <div className="wk-gutter">
          {hours.map((h) => <div key={h} className="wk-hour" style={{ height: HOUR }}>{String(h).padStart(2, '0')}:00</div>)}
        </div>
        {days.map((d) => {
          const k = ymd(d)
          const ds = dayStatus(d, cal)
          const lanes = layoutLanes(byDay[k] ?? [])
          const candles = cal.candles[k]
          return (
            <div key={k} className={`wk-col ${!ds.ok ? 'blocked' : ''} ${k === todayKey ? 'today' : ''}`} onDoubleClick={() => onNew(k)}>
              {!ds.ok && <div className="wk-blk">{ds.label}</div>}
              {ds.ok && leavesFor(k).filter((l) => l.hours).map((l) => (
                <div key={l.id} className="wk-leave" style={{ top: Math.max(0, y(l.hours!.start)), height: Math.max(18, y(l.hours!.end) - y(l.hours!.start)) }} title={`${userOf(l.userId)?.name} · ${typeOf(l.type)?.label ?? 'חופשה'}`}>
                  <span><Palmtree size={11} /> {userOf(l.userId)?.name.split(' ')[0]}</span>
                </div>
              ))}
              {ds.ok && ds.short && ds.endBy && (
                <div className="wk-after" style={{ top: Math.max(0, y(ds.endBy)) }}>
                  <span>{candles ? `נרות ${candles}` : `לסיים עד ${ds.endBy}`}</span>
                </div>
              )}
              {lanes.map(({ ev: a, lane, lanes: n }) => {
                const top = y(hhmmOf(a.start))
                const h = Math.max(24, y(hhmmOf(a.end)) - top - 2)
                return (
                  <button
                    key={a.id}
                    className={`wk-ev ${a.status === 'done' ? 'done' : ''}`}
                    style={{ top, height: h, background: appointmentTypeColor[a.type], insetInlineStart: `calc(${(lane / n) * 100}% + 2px)`, width: `calc(${100 / n}% - 4px)` }}
                    onClick={() => onOpen(a.id)}
                    title={a.title}
                  >
                    <span className="num tiny nowrap">{n > 1 ? fmtTime(a.start) : `${fmtTime(a.start)}–${fmtTime(a.end)}`}</span>
                    <span className="wk-ev-t">{a.title}</span>
                    {h > 60 && customerName(a) && <span className="tiny" style={{ opacity: 0.85 }}>{customerName(a)}</span>}
                  </button>
                )
              })}
              {k === todayKey && now.getHours() >= minH && now.getHours() < maxH && <div className="wk-now" style={{ top: y(hhmmOf(now)) }} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function EventModal({ ap, onClose, onMessage }: { ap: Appointment; onClose: () => void; onMessage: () => void }) {
  const db = useApp((s) => s.db)
  const patch = useApp((s) => s.patch)
  const [confirm, setConfirm] = useState(false)
  const ctx = jobContext(db, ap)
  const ev0 = icsEvent(db, ap)
  const ev = ap.location ? { ...ev0, location: ap.location } : ev0
  const setStatus = (status: AppointmentStatus) => {
    patch('appointments', ap.id, { status })
    toast.success(`סטטוס: ${appointmentStatusLabel[status]}`)
  }
  return (
    <Modal title={ap.title} onClose={onClose}>
      <div className="col">
        <div className="row wrap" style={{ gap: 6 }}>
          <span className="badge" style={{ background: appointmentTypeColor[ap.type], color: '#fff' }}>{appointmentTypeLabel[ap.type]}</span>
          <Badge tone={statusTone[ap.status]}>{appointmentStatusLabel[ap.status]}</Badge>
        </div>
        <dl className="kv">
          <dt>מועד</dt>
          <dd>{dateLong(ap.start)} · <span className="num">{fmtTime(ap.start)}–{fmtTime(ap.end)}</span></dd>
          {ctx.customer && (<><dt>לקוח</dt><dd>{ctx.customer.name}{ctx.contact && ctx.contact.name !== ctx.customer.name ? ` · ${ctx.contact.name}` : ''}{ctx.phone ? <> · <a href={telLink(ctx.phone)} className="ltr">{fmtPhone(ctx.phone)}</a></> : null}</dd></>)}
          {ctx.address && (<><dt>כתובת</dt><dd>{addressLine(ctx.address)}{ctx.address.entryNotes ? <div className="tiny muted">{ctx.address.entryNotes}</div> : null}</dd></>)}
          {ctx.team.length > 0 && (<><dt>צוות</dt><dd className="row" style={{ gap: 8 }}><Avatars users={ctx.team} /> {ctx.team.map((u) => u.name).join(', ')}</dd></>)}
          {ap.location && (<><dt>מיקום</dt><dd><MapPin size={13} style={{ verticalAlign: -2 }} /> {ap.location}</dd></>)}
          {ap.reminderMin ? (<><dt>תזכורת</dt><dd><Bell size={13} style={{ verticalAlign: -2 }} /> {ap.reminderMin >= 1440 ? 'יום לפני' : ap.reminderMin === 60 ? 'שעה לפני' : ap.reminderMin === 30 ? 'חצי שעה לפני' : `${ap.reminderMin} דקות לפני`}{ap.remindedAt ? ' · נשלחה' : ''}</dd></>) : null}
          {ap.notes && (<><dt>הערות</dt><dd>{ap.notes}</dd></>)}
          {ap.checklist.length > 0 && (<><dt>צ׳קליסט</dt><dd>{ap.checklist.filter((c) => c.done).length} מתוך {ap.checklist.length} הושלמו</dd></>)}
        </dl>

        <div className="act-grid">
          {ap.caseId && <Link className="btn" to={`/cases/${ap.caseId}`}><FolderOpen size={16} /> פתיחת התיק</Link>}
          {ap.serviceCallId && <Link className="btn" to={`/service/${ap.serviceCallId}`}><Wrench size={16} /> קריאת השירות</Link>}
          <Link className="btn" to={`/field/${ap.id}`}><HardHat size={16} /> מסך עבודה בשטח</Link>
          {ctx.address && <a className="btn" href={wazeLink(ctx.address)} target="_blank" rel="noreferrer"><Navigation size={16} /> ניווט</a>}
          {ctx.phone && <a className="btn" href={telLink(ctx.phone)}><Phone size={16} /> חיוג</a>}
          {ctx.phone && <button className="btn wa" onClick={onMessage}><MessageCircle size={16} /> וואטסאפ ללקוח</button>}
          <a className="btn" href={googleCalendarLink(ev)} target="_blank" rel="noreferrer"><CalendarPlus size={16} /> יומן גוגל</a>
          <button className="btn" onClick={() => download(icsFile([ev]), `genair-${ymd(ap.start)}.ics`)}><Download size={16} /> קובץ ‎.ics</button>
        </div>

        {ap.status !== 'done' && ap.status !== 'cancelled' && (
          <div className="row between wrap" style={{ borderTop: '1px solid var(--line-2)', paddingTop: 12 }}>
            <div className="row wrap" style={{ gap: 6 }}>
              {ap.status === 'planned' && <button className="btn sm" onClick={() => setStatus('confirmed')}>הלקוח אישר את המועד</button>}
              {ap.status === 'confirmed' && <button className="btn sm" onClick={() => setStatus('planned')}>החזרה ל״מתוכנן״</button>}
            </div>
            <button className="btn sm ghost danger" onClick={() => setConfirm(true)}><XCircle size={15} /> ביטול המשימה</button>
          </div>
        )}
      </div>
      {confirm && (
        <Confirm
          title="לבטל את המשימה?"
          text={`${ap.title} — ${dateLong(ap.start)}. הצוות יקבל התראה.`}
          confirmLabel="ביטול המשימה"
          danger
          onClose={() => setConfirm(false)}
          onConfirm={() => {
            const s = useApp.getState()
            s.patch('appointments', ap.id, { status: 'cancelled' })
            ap.userIds.filter((u) => u !== s.currentUserId).forEach((u) => s.notify(u, `בוטל: ${ap.title}`, '/calendar'))
            if (ap.caseId) s.log({ kind: 'appointment', caseId: ap.caseId, text: `בוטל: ${ap.title}` })
            toast.success('המשימה בוטלה')
            onClose()
          }}
        />
      )}
    </Modal>
  )
}

function ReminderModal({ ap, onClose }: { ap: Appointment; onClose: () => void }) {
  const db = useApp((s) => s.db)
  const ctx = jobContext(db, ap)
  const text = fill(`שלום {name}, תזכורת: ${appointmentTypeLabel[ap.type]} נקבע ל-{date} בשעה {time}${ctx.address ? ' בכתובת {address}' : ''}. לשינוי המועד אפשר לענות להודעה הזו. {brand}`, messageVars(ctx, ap))
  return (
    <MessageModal
      title="תזכורת ללקוח"
      to={ctx.phone}
      text={text}
      caseId={ap.caseId}
      serviceCallId={ap.serviceCallId}
      customerId={ctx.customer?.id}
      onSent={() => useApp.getState().patch('appointments', ap.id, { reminderSentAt: new Date().toISOString() })}
      onClose={onClose}
    />
  )
}
