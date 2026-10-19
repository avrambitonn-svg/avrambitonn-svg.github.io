import { useEffect, useMemo, useState } from 'react'
import { Bell, CalendarCheck, CalendarPlus, CheckCircle2, Clock, Download, MapPin, Palmtree, Sparkles, Users } from 'lucide-react'
import type { Appointment, AppointmentType, ID, User } from '../../lib/types'
import { Avatar, Badge, Callout, Field, Modal, toast } from '../../components/ui'
import { useApp, useSettings } from '../../lib/store'
import { scheduleAppointment, touchCase } from '../../lib/actions'
import { appointmentTypeColor, appointmentTypeLabel, roleLabel } from '../../lib/labels'
import { addDays, dateLong, dateShortDay, time as fmtTime, ymd } from '../../lib/format'
import { dayStatus } from '../../lib/integrations/hebcal'
import { outdoorRisk, weatherIcon } from '../../lib/integrations/weather'
import { addressText, download, googleCalendarLink, icsFile } from '../../lib/integrations/links'
import { fill, templates, type TemplateKey } from '../../lib/messaging'
import {
  at, busyOn, certIssue, dow, checklistFor, conflictsFor, dayEndMin, dayStart, defaultDuration, durationLabel, fieldRoles, fromMin, hhmmOf, icsEvent, jobContext,
  leaveConflicts, leavesOn, messageVars, needsHeightWork, nextWorkDays, outdoorTypes, suggestSlots, toMin, useForecast, useHebcal, visitText,
} from '../ops/ops'
import { MessageBox } from '../ops/MessageBox'
import '../ops/ops.css'

interface Props {
  type: AppointmentType
  caseId?: ID
  serviceCallId?: ID
  contractId?: ID
  customerId?: ID
  title?: string
  date?: string // YYYY-MM-DD, אופציונלי
  userIds?: ID[]
  onClose: () => void
  onScheduled?: (appointmentId: ID) => void
}

const allTypes: AppointmentType[] = ['survey', 'installation', 'service', 'maintenance', 'inspection', 'meeting']
// תזכורת לצוות לפני המועד (בדקות)
const reminderOptions: { min: number; label: string }[] = [
  { min: 0, label: 'בלי תזכורת' },
  { min: 15, label: '15 דקות לפני' },
  { min: 30, label: 'חצי שעה לפני' },
  { min: 60, label: 'שעה לפני' },
  { min: 1440, label: 'יום לפני' },
]

export function ScheduleDialog({ type: type0, caseId, serviceCallId, contractId, customerId: customerId0, title: title0, date: date0, userIds: users0, onClose, onScheduled }: Props) {
  const db = useApp((s) => s.db)
  const me = useApp((s) => s.currentUserId)
  const settings = useSettings()
  const linked = Boolean(caseId || serviceCallId || contractId)

  const [type, setType] = useState<AppointmentType>(type0)
  const [customerId, setCustomerId] = useState(customerId0 ?? '')
  const ctx0 = useMemo(() => jobContext(db, { caseId, serviceCallId, contractId, customerId: customerId || undefined }), [db, caseId, serviceCallId, contractId, customerId])
  const customer = ctx0.customer
  const [addressId, setAddressId] = useState(ctx0.address?.id ?? '')
  useEffect(() => setAddressId(ctx0.address?.id ?? ''), [ctx0.address?.id])

  const defaultTitle = useMemo(() => {
    const tl = appointmentTypeLabel[type]
    if (ctx0.kase) return `${tl} — ${ctx0.kase.title}`
    if (ctx0.call) return ctx0.call.description
    if (ctx0.contract) return `${ctx0.contract.title} — ${customer?.name ?? ''}`
    return customer ? `${tl} — ${customer.name}` : tl
  }, [type, ctx0.kase, ctx0.call, ctx0.contract, customer])
  const [title, setTitle] = useState(title0 ?? '')
  const shownTitle = title || defaultTitle

  // צוות ברירת מחדל לפי סוג המשימה
  const [userIds, setUserIds] = useState<ID[]>(() => {
    if (users0?.length) return users0
    const k = ctx0.kase
    const bySkill = (sk: string) => db.users.filter((u) => u.active && u.skills?.includes(sk)).map((u) => u.id)
    switch (type0) {
      case 'installation':
        return k?.installerIds ?? []
      case 'survey':
        return [k?.agentId, k?.projectType && ['institution', 'commercial', 'underfloor_heating', 'smoke_ventilation'].includes(k.projectType) ? k.engineerId : undefined].filter(Boolean) as ID[]
      case 'service':
        return ctx0.call?.assigneeId ? [ctx0.call.assigneeId] : bySkill('שירות').slice(0, 1)
      case 'maintenance':
        return bySkill('שירות').slice(0, 1)
      case 'inspection':
        return bySkill('שחרור עשן').slice(0, 1)
      default:
        return [k?.agentId ?? me].filter(Boolean) as ID[]
    }
  })
  const [allUsers, setAllUsers] = useState(false)

  // תאריך ושעות
  const [day, setDay] = useState(date0 ?? '')
  const [startT, setStartT] = useState(settings.workStart)
  const [endT, setEndT] = useState(defaultDuration[type0] ? fromMin(toMin(settings.workStart) + defaultDuration[type0]) : settings.workEnd)
  const [days, setDays] = useState(1)
  const [height, setHeight] = useState(() => type0 === 'installation' && needsHeightWork(db, caseId))
  const [notes, setNotes] = useState('')
  const [reminderMin, setReminderMin] = useState(type0 === 'meeting' ? 30 : 0)
  const [location, setLocation] = useState('')
  const [done, setDone] = useState<Appointment[] | null>(null)

  const today = useMemo(() => dayStart(new Date()), [])
  const { cal, ready } = useHebcal(today, addDays(today, 120))
  const weather = useForecast()

  const durationMin = Math.max(0, toMin(endT) - toMin(startT))
  const fullDay = type === 'installation' && toMin(startT) <= toMin(settings.workStart) && toMin(endT) >= toMin(settings.workEnd)

  const suggestions = useMemo(
    () => suggestSlots({ appts: db.appointments, userIds, durationMin: fullDay ? 0 : durationMin || 60, cal, settings, count: 3, leaves: db.leaves }),
    [db.appointments, userIds, durationMin, fullDay, cal, settings, db.leaves],
  )

  // ברירת מחדל: המועד הפנוי הראשון, אחרי שלוח החגים נטען
  useEffect(() => {
    if (day || !ready) return
    const s0 = suggestions[0]
    if (!s0) return
    setDay(ymd(s0.start))
    setStartT(hhmmOf(s0.start))
    setEndT(hhmmOf(s0.end))
  }, [ready, suggestions, day])

  const dates = useMemo(() => (day ? nextWorkDays(day, type === 'installation' ? days : 1, cal, settings) : []), [day, days, type, cal, settings])
  const st = day ? dayStatus(dayStart(day), cal) : undefined
  const candles = day ? cal.candles[day] : undefined
  const dayEnd = st ? fromMin(dayEndMin(st, settings)) : settings.workEnd
  const afterCandles = Boolean(candles && toMin(endT) > toMin(candles))
  const afterEndBy = Boolean(st?.endBy && toMin(endT) > toMin(st.endBy))
  const offDay = day && !settings.workDays.includes(dayStart(day).getDay())
  const outsideHours = toMin(startT) < toMin(settings.workStart) || toMin(endT) > toMin(settings.workEnd)

  const conflicts = useMemo(
    () => dates.flatMap((d) => conflictsFor(db.appointments, userIds, at(d, startT), at(d, endT))),
    [dates, db.appointments, userIds, startT, endT],
  )
  // חופשות שאושרו: מי מהצוות שנבחר לא זמין במועד
  const leaveHits = useMemo(
    () => dates.flatMap((d) => leaveConflicts(db.leaves, userIds, at(d, startT), at(d, endT)).map((x) => ({ ...x, day: d }))),
    [dates, db.leaves, userIds, startT, endT],
  )
  const leaveOf = (uid0: ID) => {
    for (const d of dates) {
      const hit = leaveConflicts(db.leaves, [uid0], at(d, startT), at(d, endT))[0]
      if (hit) return { ...hit, day: d }
    }
    const part = dates.map((d) => leavesOn(db.leaves, d, uid0)[0]).find(Boolean)
    return part ? { userId: uid0, leave: part, day: part.from, partial: true } : undefined
  }
  const leaveLabel = (key: string) => db.config.leaveTypes.find((o) => o.key === key)?.label ?? 'חופשה'

  const certIssues = useMemo(() => {
    if (!height || type !== 'installation' || !dates.length) return []
    const last = dates[dates.length - 1]
    return userIds
      .map((id) => db.users.find((u) => u.id === id))
      .filter((u): u is User => !!u && u.role === 'installer')
      .map((u) => certIssue(u, 'עבודה בגובה', last))
      .filter(Boolean) as { tone: 'danger' | 'warning'; text: string }[]
  }, [height, type, dates, userIds, db.users])

  const relevantRoles = fieldRoles[type]
  const people = useMemo(() => {
    const act = db.users.filter((u) => u.active)
    const rel = act.filter((u) => relevantRoles.includes(u.role))
    const rest = act.filter((u) => !relevantRoles.includes(u.role))
    return allUsers ? [...rel, ...rest] : [...rel, ...rest.filter((u) => userIds.includes(u.id))]
  }, [db.users, relevantRoles, allUsers, userIds])

  const blocked = Boolean(st && !st.ok)
  const invalid = !day || blocked || durationMin <= 0 || afterCandles || !userIds.length || !shownTitle.trim() || leaveHits.length > 0

  const strip = useMemo(() => Array.from({ length: 21 }, (_, i) => addDays(today, i)), [today])

  const save = () => {
    if (invalid) return
    const created = dates.map((d, i) =>
      scheduleAppointment({
        type,
        title: dates.length > 1 ? `${shownTitle} — יום ${i + 1}` : shownTitle,
        caseId,
        serviceCallId,
        contractId: contractId ?? ctx0.call?.contractId,
        customerId: customer?.id,
        addressId: addressId || undefined,
        start: at(d, startT).toISOString(),
        end: at(d, endT).toISOString(),
        userIds,
        notes: notes.trim() || undefined,
        checklist: checklistFor(type),
        ...(reminderMin ? { reminderMin } : {}),
        ...(location.trim() ? { location: location.trim() } : {}),
      }),
    )
    const s = useApp.getState()
    if (caseId && type === 'installation' && dates.length > 1) touchCase(caseId, { installWindow: { from: dates[0], to: dates[dates.length - 1] } })
    if (serviceCallId && ctx0.call) {
      s.patch('serviceCalls', serviceCallId, { status: ['new', 'assigned'].includes(ctx0.call.status) ? 'scheduled' : ctx0.call.status, assigneeId: ctx0.call.assigneeId ?? userIds[0] })
      s.log({ kind: 'service', serviceCallId, customerId: customer?.id, text: `נקבע ביקור ל${dateLong(created[0].start)} ב-${fmtTime(created[0].start)}` })
    }
    const kt = contractId ?? ctx0.call?.contractId
    if (kt && (type === 'maintenance' || type === 'inspection')) s.patch('contracts', kt, { nextVisit: dates[0] })
    toast.success(dates.length > 1 ? `נקבעו ${dates.length} ימי עבודה` : 'המועד נקבע')
    onScheduled?.(created[0].id)
    setDone(created)
  }

  // ---------- אחרי השמירה ----------
  if (done) {
    const first = done[0]
    const ctx = jobContext(useApp.getState().db, first)
    const tKey: TemplateKey = type === 'survey' ? 'survey' : type === 'installation' ? 'schedule' : 'free'
    const raw = tKey === 'free' ? visitText[type] ?? '' : templates[tKey].text
    const text = fill(raw, messageVars(ctx, first))
    const withLoc = (a: Appointment) => { const e = icsEvent(useApp.getState().db, a); return a.location ? { ...e, location: a.location } : e }
    const ev = withLoc(first)
    return (
      <Modal title="המועד נקבע" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>סיום</button>}>
        <div className="col">
          <Callout tone="success" icon={<CheckCircle2 size={18} />}>
            <div className="strong">{first.title.replace(/ — יום 1$/, '')}</div>
            {done.map((a) => (
              <div key={a.id}>{dateLong(a.start)} · {fmtTime(a.start)}–{fmtTime(a.end)}</div>
            ))}
            {ctx.team.length > 0 && <div className="muted">צוות: {ctx.team.map((u) => u.name).join(', ')}</div>}
            {first.location && <div className="muted"><MapPin size={13} style={{ verticalAlign: -2 }} /> {first.location}</div>}
            {first.reminderMin ? <div className="muted"><Bell size={13} style={{ verticalAlign: -2 }} /> תזכורת לצוות {reminderOptions.find((o) => o.min === first.reminderMin)?.label}</div> : null}
          </Callout>
          {ctx.phone && raw ? (
            <div className="card flat card-body">
              <div className="strong mb8">אישור ללקוח</div>
              <MessageBox to={ctx.phone} text={text} templateKey={tKey} caseId={first.caseId} serviceCallId={first.serviceCallId} customerId={ctx.customer?.id} />
            </div>
          ) : null}
          <div className="row wrap">
            <a className="btn" href={googleCalendarLink(ev)} target="_blank" rel="noreferrer"><CalendarPlus size={16} /> הוספה ליומן גוגל</a>
            <button className="btn" onClick={() => download(icsFile(done.map(withLoc)), `genair-${ymd(first.start)}.ics`)}><Download size={16} /> קובץ ליומן (‎.ics)</button>
          </div>
        </div>
      </Modal>
    )
  }

  // ---------- טופס ----------
  return (
    <Modal
      title={`שיבוץ ${appointmentTypeLabel[type]}`}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>ביטול</button>
          <button className="btn primary" disabled={invalid} onClick={save}><CalendarCheck size={16} /> {dates.length > 1 ? `קביעת ${dates.length} ימים` : 'קביעת המועד'}</button>
        </>
      }
    >
      <div className="sch">
        <div className="col sch-form">
          {!linked && (
            <div className="row wrap" role="radiogroup" aria-label="סוג">
              {allTypes.map((t) => (
                <button key={t} type="button" className={`chip ${t === type ? 'on' : ''}`} onClick={() => { setType(t); setEndT(defaultDuration[t] ? fromMin(toMin(startT) + defaultDuration[t]) : dayEnd); if (t === 'meeting' && !reminderMin) setReminderMin(30) }}>
                  <span className="dotc" style={{ background: appointmentTypeColor[t] }} /> {appointmentTypeLabel[t]}
                </button>
              ))}
            </div>
          )}

          {!linked && !customerId0 && (
            <Field label="לקוח">
              <select className="select" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">ללא לקוח (פגישה פנימית)</option>
                {db.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          )}

          <Field label="כותרת">
            <input className="input" value={shownTitle} onChange={(e) => setTitle(e.target.value)} />
          </Field>

          {customer && (
            customer.addresses.length > 1 ? (
              <Field label="כתובת">
                <select className="select" value={addressId} onChange={(e) => setAddressId(e.target.value)}>
                  {customer.addresses.map((a) => <option key={a.id} value={a.id}>{a.label ? `${a.label} — ` : ''}{addressText(a)}</option>)}
                </select>
              </Field>
            ) : (
              <div className="small muted">{customer.name}{customer.addresses[0] ? ` · ${addressText(customer.addresses[0])}` : ''}</div>
            )
          )}

          <div>
            <div className="label mb8">יום</div>
            <div className="day-strip">
              {strip.map((d) => {
                const k = ymd(d)
                const ds = dayStatus(d, cal)
                const off = !settings.workDays.includes(d.getDay())
                const away = ds.ok && userIds.some((id) => leavesOn(db.leaves, k, id).some((l) => !l.hours))
                return (
                  <button
                    key={k}
                    type="button"
                    className={`day-btn ${k === day ? 'on' : ''} ${!ds.ok ? 'blocked' : ''} ${ds.short ? 'short' : ''} ${off && ds.ok ? 'off' : ''}`}
                    disabled={!ds.ok}
                    title={ds.label}
                    onClick={() => setDay(k)}
                  >
                    <span className="dw">{dow(d)}</span>
                    <b>{d.getDate()}</b>
                    <span className="lb" style={away ? { color: 'var(--danger)', fontWeight: 600 } : undefined}>{!ds.ok ? ds.label : away ? 'חופשה' : ds.short ? `עד ${ds.endBy}` : k === ymd(today) ? 'היום' : ' '}</span>
                  </button>
                )
              })}
            </div>
            <div className="row mt8 wrap">
              <input type="date" className="input sm" style={{ width: 170 }} value={day} min={ymd(today)} onChange={(e) => setDay(e.target.value)} aria-label="תאריך" />
              {day && <span className="small muted">{dateLong(day)}</span>}
            </div>
          </div>

          <div className="grid g3 sch-times">
            <Field label="התחלה"><input type="time" className="input" step={900} value={startT} onChange={(e) => setStartT(e.target.value)} /></Field>
            <Field label="סיום"><input type="time" className="input" step={900} value={endT} onChange={(e) => setEndT(e.target.value)} /></Field>
            {type === 'installation' ? (
              <Field label="ימי עבודה" hint={dates.length > 1 ? `עד ${dateShortDay(dates[dates.length - 1])}` : undefined}>
                <input type="number" className="input" min={1} max={10} value={days} onChange={(e) => setDays(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} />
              </Field>
            ) : (
              <Field label="משך"><div className="input" style={{ display: 'flex', alignItems: 'center', background: 'var(--surface-2)' }}>{durationLabel(durationMin)}</div></Field>
            )}
          </div>
          <div className="row wrap">
            {[60, 90, 120, 180].map((m) => (
              <button key={m} type="button" className={`chip ${durationMin === m ? 'on' : ''}`} onClick={() => setEndT(fromMin(Math.min(toMin(startT) + m, 23 * 60 + 45)))}>{durationLabel(m)}</button>
            ))}
            <button type="button" className={`chip ${fullDay || (startT === settings.workStart && endT === dayEnd) ? 'on' : ''}`} onClick={() => { setStartT(settings.workStart); setEndT(dayEnd) }}>יום מלא</button>
          </div>

          <div>
            <div className="row between mb8">
              <span className="label"><Users size={14} style={{ verticalAlign: -2 }} /> צוות</span>
              <button type="button" className="btn sm ghost" onClick={() => setAllUsers((v) => !v)}>{allUsers ? 'רק הרלוונטיים' : 'כל העובדים'}</button>
            </div>
            <div className="pick-list">
              {people.map((u) => {
                const on = userIds.includes(u.id)
                const busy = day ? busyOn(db.appointments, u.id, day) : []
                const clash = busy.some((a) => toMin(hhmmOf(a.start)) < toMin(endT) && toMin(startT) < toMin(hhmmOf(a.end)))
                const away = day ? leaveOf(u.id) : undefined
                const out = !!away && !('partial' in away)
                return (
                  <button
                    key={u.id}
                    type="button"
                    className={`pick-user ${on ? 'on' : ''}`}
                    style={out ? { borderColor: on ? 'var(--danger)' : undefined, background: on ? 'var(--danger-50)' : 'var(--surface-2)', cursor: on ? 'pointer' : 'not-allowed' } : undefined}
                    disabled={out && !on}
                    title={out && away ? `${u.name} בחופשה (${leaveLabel(away.leave.type)})` : undefined}
                    onClick={() => setUserIds((l) => (on ? l.filter((x) => x !== u.id) : [...l, u.id]))}
                    aria-pressed={on}
                  >
                    <Avatar user={u} />
                    <span className="grow" style={{ textAlign: 'start', opacity: out && !on ? 0.6 : 1 }}>
                      <span className="strong">{u.name}</span>
                      <span className="tiny muted" style={{ display: 'block' }}>{u.title || roleLabel[u.role]}</span>
                    </span>
                    {day && out ? (
                      <span className="tiny txt-danger strong" style={{ textAlign: 'end', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Palmtree size={13} /> בחופשה</span>
                    ) : day && away ? (
                      <span className="tiny txt-warning" style={{ textAlign: 'end' }}>חופשה {away.leave.hours?.start}–{away.leave.hours?.end}</span>
                    ) : day && (
                      busy.length ? (
                        <span className={`tiny ${clash ? 'txt-danger' : 'muted'}`} style={{ textAlign: 'end' }}>
                          {busy.slice(0, 2).map((a) => <span key={a.id} style={{ display: 'block' }}>{fmtTime(a.start)}–{fmtTime(a.end)}</span>)}
                        </span>
                      ) : (
                        <span className="tiny txt-success">פנוי</span>
                      )
                    )}
                    <span className={`tick ${on ? 'on' : ''}`} aria-hidden>✓</span>
                  </button>
                )
              })}
            </div>
          </div>

          {type === 'installation' && (
            <label className="check">
              <input type="checkbox" checked={height} onChange={(e) => setHeight(e.target.checked)} /> עבודה בגובה / מנוף
            </label>
          )}

          <div className="grid g2">
            {(type === 'meeting' || !customer) && (
              <Field label={<span><MapPin size={13} style={{ verticalAlign: -2 }} /> מיקום</span>}>
                <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder={customer ? 'אם לא אצל הלקוח: משרד, אתר, זום...' : 'משרד, אתר הבנייה, זום...'} />
              </Field>
            )}
            <Field label={<span><Bell size={13} style={{ verticalAlign: -2 }} /> תזכורת לצוות</span>}>
              <select className="select" value={reminderMin} onChange={(e) => setReminderMin(Number(e.target.value))}>
                {reminderOptions.map((o) => <option key={o.min} value={o.min}>{o.label}</option>)}
              </select>
            </Field>
          </div>

          <Field label="הערות לצוות">
            <textarea className="textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="חניה, קוד כניסה, ציוד מיוחד..." />
          </Field>
        </div>

        <aside className="col sch-side">
          <div className="side-box">
            <div className="row mb8"><Sparkles size={15} className="txt-brand" /><span className="strong small">מועדים פנויים קרובים</span></div>
            {!ready ? (
              <div className="small muted">בודק חגים וזמינות...</div>
            ) : suggestions.length ? (
              <div className="col" style={{ gap: 6 }}>
                {suggestions.map((s) => {
                  const k = ymd(s.start)
                  const on = k === day && hhmmOf(s.start) === startT
                  return (
                    <button key={+s.start} type="button" className={`slot-btn ${on ? 'on' : ''}`} onClick={() => { setDay(k); setStartT(hhmmOf(s.start)); setEndT(hhmmOf(s.end)) }}>
                      <b>{dateShortDay(s.start)}</b>
                      <span className="num">{fmtTime(s.start)}–{fmtTime(s.end)}</span>
                      {s.short && <Badge tone="warning">יום קצר</Badge>}
                    </button>
                  )
                })}
                <div className="tiny muted">לפי ימי ושעות העבודה, בלי שבתות וחגים{userIds.length ? ' ולפי היומן של הצוות שנבחר' : ''}.</div>
              </div>
            ) : (
              <div className="small muted">לא נמצא מועד פנוי ב-45 הימים הקרובים לצוות הזה.</div>
            )}
          </div>

          {day && (
            <div className="col" style={{ gap: 8 }}>
              {blocked && <Callout tone="danger">{st?.label}: לא משבצים עבודה ביום הזה.</Callout>}
              {!blocked && st?.short && (
                <Callout tone={afterEndBy ? 'danger' : 'warning'}>
                  <div><b>{st.label ?? 'יום קצר'}</b>: לסיים עד {st.endBy}{candles ? ` (הדלקת נרות ${candles})` : ''}.</div>
                  {afterEndBy && (
                    <div className="row wrap mt8">
                      <span>{afterCandles ? 'שעת הסיום אחרי כניסת השבת.' : 'שעת הסיום מאוחרת מדי.'}</span>
                      <button type="button" className="btn sm" onClick={() => setEndT(st.endBy!)}>לסיים ב-{st.endBy}</button>
                    </div>
                  )}
                </Callout>
              )}
              {!blocked && !st?.short && st?.label && <Callout>{st.label}</Callout>}
              {!blocked && offDay && !st?.short && <Callout tone="warning">היום הזה אינו יום עבודה רגיל לפי ההגדרות.</Callout>}
              {!blocked && outsideHours && <Callout>מחוץ לשעות העבודה ({settings.workStart}–{settings.workEnd}).</Callout>}
              {durationMin <= 0 && <Callout tone="danger">שעת הסיום חייבת להיות אחרי שעת ההתחלה.</Callout>}
            </div>
          )}

          {day && outdoorTypes.includes(type) && <WeatherBox dates={dates} weather={weather} />}

          {conflicts.length > 0 && (
            <Callout tone="warning">
              <div className="strong">חפיפה ביומן</div>
              {conflicts.slice(0, 5).map((a) => {
                const who = a.userIds.filter((x) => userIds.includes(x)).map((x) => db.users.find((u) => u.id === x)?.name).join(', ')
                return <div key={a.id}>{who}: {a.title} ({dateShortDay(a.start)} {fmtTime(a.start)}–{fmtTime(a.end)})</div>
              })}
            </Callout>
          )}
          {leaveHits.length > 0 && (
            <Callout tone="danger" icon={<Palmtree size={18} />}>
              <div className="strong">בחופשה במועד הזה</div>
              {[...new Map(leaveHits.map((h) => [h.userId, h])).values()].map((h) => (
                <div key={h.userId} className="row between wrap" style={{ gap: 6 }}>
                  <span>{db.users.find((u) => u.id === h.userId)?.name}: {leaveLabel(h.leave.type)} ({h.leave.from === h.leave.to ? dateShortDay(h.leave.from) : `${dateShortDay(h.leave.from)} – ${dateShortDay(h.leave.to)}`}{h.leave.hours ? ` ${h.leave.hours.start}–${h.leave.hours.end}` : ''})</span>
                  <button type="button" className="btn sm" onClick={() => setUserIds((l) => l.filter((x) => x !== h.userId))}>הסרה מהשיבוץ</button>
                </div>
              ))}
              <div className="tiny mt8">אי אפשר לשבץ עובד בחופשה שאושרה. בחרו מישהו אחר או יום אחר.</div>
            </Callout>
          )}
          {certIssues.map((c, i) => <Callout key={i} tone={c.tone}>{c.text}. לעבודה בגובה צריך אישור בתוקף.</Callout>)}
          {!userIds.length && <Callout>בחרו לפחות איש צוות אחד.</Callout>}

          {day && dates.length > 0 && !blocked && durationMin > 0 && (
            <div className="side-box small">
              <div className="row mb8"><Clock size={15} className="muted" /><span className="strong">סיכום</span></div>
              {dates.map((d) => <div key={d}>{dateLong(d)} · {startT}–{endT}</div>)}
              {userIds.length > 0 && <div className="muted mt8">{userIds.map((id) => db.users.find((u) => u.id === id)?.name).join(', ')}</div>}
            </div>
          )}
        </aside>
      </div>
    </Modal>
  )
}

function WeatherBox({ dates, weather }: { dates: string[]; weather: ReturnType<typeof useForecast> }) {
  if (!weather.length) return null
  const rows = dates.map((d) => ({ d, f: weather.find((w) => w.date === d) }))
  if (rows.every((r) => !r.f)) return <div className="side-box small muted">התחזית זמינה עד 10 ימים קדימה.</div>
  return (
    <div className="side-box small">
      <div className="strong mb8">תחזית לירושלים</div>
      {rows.map(({ d, f }) => {
        const risk = outdoorRisk(f)
        return (
          <div key={d} className="row between" style={{ padding: '3px 0' }}>
            <span>{dateShortDay(d)}</span>
            {f ? (
              <span className="row" style={{ gap: 6 }}>
                <span>{weatherIcon(f.code)} {f.tMax}°/{f.tMin}°</span>
                <span className="muted">גשם {f.rainProb}% · רוח {f.windMax}</span>
                {risk && <Badge tone="warning">{risk}</Badge>}
              </span>
            ) : (
              <span className="muted">אין תחזית</span>
            )}
          </div>
        )
      })}
    </div>
  )
}
