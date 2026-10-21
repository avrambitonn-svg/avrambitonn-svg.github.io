import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Boxes, ChevronLeft, CloudOff, KeyRound, MapPin, MessageCircle, Navigation, Phone, Wifi } from 'lucide-react'
import { Badge, Card, Empty } from '../../components/ui'
import { useApp, useMe } from '../../lib/store'
import { canOpen } from '../../lib/access'
import type { Appointment, DB, ID, User } from '../../lib/types'
import { appointmentStatusLabel, appointmentTypeColor, appointmentTypeLabel } from '../../lib/labels'
import { addDays, dateLong, time as fmtTime, ymd } from '../../lib/format'
import { telLink, wazeLink } from '../../lib/integrations/links'
import { outdoorRisk, weatherIcon } from '../../lib/integrations/weather'
import { fill } from '../../lib/messaging'
import { StatusFlow } from '../../features/ops/JobStatus'
import { MessageModal } from '../../features/ops/MessageBox'
import { addressLine, dowNames, findStock, firstName, jobContext, messageVars, useForecast, useOnline, vanOf } from '../../features/ops/ops'
import '../../features/ops/ops.css'

const statusTone = { planned: 'muted', confirmed: 'info', on_the_way: 'brand', in_progress: 'warning', done: 'success', cancelled: 'danger' } as const

function greeting() {
  const h = new Date().getHours()
  return h < 5 ? 'לילה טוב' : h < 12 ? 'בוקר טוב' : h < 16 ? 'צהריים טובים' : h < 21 ? 'ערב טוב' : 'לילה טוב'
}

// מה צריך ברכב להיום: חומרים ואביזרים מההצעות המאושרות של ההתקנות, מול המלאי ברכב
function vanCheck(db: DB, user: User, jobs: Appointment[]) {
  const van = vanOf(user)
  const need: Record<ID, number> = {}
  jobs.filter((a) => a.status !== 'done' && a.type === 'installation' && a.caseId).forEach((a) => {
    const q = db.quotes.find((x) => x.caseId === a.caseId && x.status === 'approved')
    q?.lines.forEach((l) => {
      const it = db.catalog.find((c) => c.id === l.itemId)
      if (it && (it.category === 'material' || it.category === 'accessory')) need[it.id] = (need[it.id] ?? 0) + l.qty
    })
  })
  const missing = Object.entries(need)
    .map(([itemId, qty]) => ({ itemId, need: qty, have: findStock(db.stock, itemId, van)?.qty ?? 0 }))
    .filter((x) => x.have < x.need)
  const low = db.stock.filter((e) => e.location === van && e.qty < e.min && !need[e.itemId])
  return { van, missing, low, needCount: Object.keys(need).length }
}

export default function FieldApp() {
  const me = useMe()
  const db = useApp((s) => s.db)
  const online = useOnline()
  const weather = useForecast()
  const canPick = me.role === 'admin' || me.role === 'office'
  const todayKey = ymd(new Date())

  const [pick, setPick] = useState<ID>(() => {
    if (!canPick || db.appointments.some((a) => a.userIds.includes(me.id) && ymd(a.start) >= todayKey)) return me.id
    const withToday = db.users.find((u) => u.role === 'installer' && db.appointments.some((a) => a.userIds.includes(u.id) && ymd(a.start) === todayKey))
    return (withToday ?? db.users.find((u) => u.role === 'installer') ?? me).id
  })
  const user = (canPick ? db.users.find((u) => u.id === pick) : me) ?? me
  const [msg, setMsg] = useState<Appointment | null>(null)

  const mine = useMemo(
    () => db.appointments.filter((a) => a.userIds.includes(user.id) && a.status !== 'cancelled').sort((a, b) => a.start.localeCompare(b.start)),
    [db.appointments, user.id],
  )
  const today = mine.filter((a) => ymd(a.start) === todayKey)
  const weekEnd = ymd(addDays(new Date(), 7))
  const upcoming = mine.filter((a) => ymd(a.start) > todayKey && ymd(a.start) <= weekEnd)
  const groups = useMemo(() => {
    const m = new Map<string, Appointment[]>()
    upcoming.forEach((a) => m.set(ymd(a.start), [...(m.get(ymd(a.start)) ?? []), a]))
    return [...m.entries()]
  }, [upcoming])
  const next = today.find((a) => a.status !== 'done')
  const doneCount = today.filter((a) => a.status === 'done').length
  const van = useMemo(() => vanCheck(db, user, today), [db, user, today])
  const wToday = weather.find((w) => w.date === todayKey)
  const risk = outdoorRisk(wToday)
  const pickable = db.users.filter((u) => u.active && (u.role === 'installer' || u.role === 'engineer' || u.role === 'agent'))

  return (
    <div className="fieldapp">
      <div className="field-hero">
        <div className="row between wrap" style={{ gap: 8 }}>
          <div>
            <div className="tiny" style={{ color: '#9fb0bf' }}>{dateLong(new Date())}</div>
            <h1>{greeting()}, {firstName(user.name)}</h1>
          </div>
          {canPick && (
            <select className="select sm field-pick" value={user.id} onChange={(e) => setPick(e.target.value)} aria-label="הצגה לפי עובד">
              {pickable.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          )}
        </div>
        <div className="field-sum">
          <div><b>{today.length}</b><span>משימות היום</span></div>
          <div><b>{doneCount}</b><span>הושלמו</span></div>
          <div><b className="num">{next ? fmtTime(next.start) : '—'}</b><span>{next ? 'המשימה הבאה' : 'אין עוד היום'}</span></div>
          {wToday && (
            <div title={risk ?? undefined}><b>{weatherIcon(wToday.code)} {wToday.tMax}°</b><span>{risk ?? `גשם ${wToday.rainProb}%`}</span></div>
          )}
        </div>
        <div className={`net ${online ? '' : 'off'}`}>
          {online ? <Wifi size={14} /> : <CloudOff size={14} />}
          {online ? 'עובד גם בלי קליטה: כל מה שמסמנים נשמר במכשיר' : 'אין קליטה כרגע. ממשיכים לעבוד, הכל נשמר במכשיר'}
        </div>
      </div>

      <section className="col" style={{ gap: 12 }}>
        <div className="row between">
          <h2>היום</h2>
          {today.length > 0 && <span className="small muted">{today.length - doneCount} נשארו</span>}
        </div>
        {today.length === 0 ? (
          <Card><Empty title="אין משימות להיום">{upcoming.length ? 'המשימות של הימים הקרובים מופיעות למטה' : 'כשישבצו אותך למשימה היא תופיע כאן'}</Empty></Card>
        ) : (
          today.map((a) => <JobCard key={a.id} a={a} db={db} isNext={a.id === next?.id} onMessage={() => setMsg(a)} />)
        )}
      </section>

      {(van.missing.length > 0 || van.low.length > 0 || van.needCount > 0) && (
        <Card
          title={<div className="row" style={{ gap: 8 }}><Boxes size={17} className="muted" /><h2>מלאי ברכב להיום</h2></div>}
          actions={canOpen('/inventory', me.role) && <Link className="btn sm ghost" to="/inventory">למלאי <ChevronLeft size={15} /></Link>}
        >
          <div className="card-body col" style={{ gap: 8 }}>
            <div className="tiny muted">{van.van}</div>
            {van.missing.length === 0 && van.needCount > 0 && <div className="small txt-success strong">יש ברכב את כל החומרים להתקנות של היום</div>}
            {van.missing.map((m) => {
              const it = db.catalog.find((c) => c.id === m.itemId)
              return (
                <div key={m.itemId} className="stock-line">
                  <span className="grow">{it?.name}</span>
                  <span className="tiny muted nowrap">צריך {m.need} {it?.unit} · ברכב {m.have}</span>
                  <Badge tone="danger">חסר {m.need - m.have}</Badge>
                </div>
              )
            })}
            {van.low.map((e) => {
              const it = db.catalog.find((c) => c.id === e.itemId)
              return (
                <div key={e.id} className="stock-line">
                  <span className="grow">{it?.name}</span>
                  <span className="tiny muted nowrap">ברכב {e.qty} · מינימום {e.min}</span>
                  <Badge tone="warning">להשלים</Badge>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      <section className="col" style={{ gap: 10 }}>
        <h2>בימים הקרובים</h2>
        {groups.length === 0 ? (
          <Card><Empty title="אין משימות בשבוע הקרוב" /></Card>
        ) : (
          <Card>
            {groups.map(([day, list]) => (
              <div key={day}>
                <div className="field-day">
                  {day === ymd(addDays(new Date(), 1)) ? 'מחר' : `יום ${dowNames[new Date(day + 'T00:00:00').getDay()]}`} · {dateLong(day).split(', ')[1]}
                </div>
                <div className="list">
                  {list.map((a) => {
                    const ctx = jobContext(db, a)
                    return (
                      <Link key={a.id} to={`/field/${a.id}`} className="list-item">
                        <span className="ev-bar" style={{ background: appointmentTypeColor[a.type] }} />
                        <span className="num strong small" style={{ minWidth: 44 }}>{fmtTime(a.start)}</span>
                        <span className="grow">
                          <span className="strong truncate" style={{ display: 'block' }}>{a.title}</span>
                          <span className="tiny muted">{appointmentTypeLabel[a.type]}{ctx.address ? ` · ${ctx.address.city}` : ''}</span>
                        </span>
                        <ChevronLeft size={16} className="muted" />
                      </Link>
                    )
                  })}
                </div>
              </div>
            ))}
          </Card>
        )}
      </section>

      {msg && <QuickMessage ap={msg} onClose={() => setMsg(null)} />}
    </div>
  )
}

function JobCard({ a, db, isNext, onMessage }: { a: Appointment; db: DB; isNext: boolean; onMessage: () => void }) {
  const ctx = jobContext(db, a)
  const done = a.status === 'done'
  const checked = a.checklist.filter((c) => c.done).length
  return (
    <div className={`job-card ${done ? 'done' : ''} ${isNext ? 'next' : ''}`} style={{ borderInlineStartColor: appointmentTypeColor[a.type] }}>
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div className="job-time num">{fmtTime(a.start)}<span>–{fmtTime(a.end)}</span></div>
        <div className="row wrap" style={{ gap: 6, justifyContent: 'flex-end' }}>
          {isNext && <Badge tone="brand">הבא בתור</Badge>}
          <span className="badge" style={{ background: appointmentTypeColor[a.type] + '1f', color: appointmentTypeColor[a.type] }}>{appointmentTypeLabel[a.type]}</span>
          {a.status !== 'planned' && <Badge tone={statusTone[a.status]}>{appointmentStatusLabel[a.status]}</Badge>}
        </div>
      </div>
      <Link to={`/field/${a.id}`} className="job-title">{a.title}</Link>
      {ctx.customer && (
        <div className="small">
          <span className="strong">{ctx.customer.name}</span>
          {ctx.contact && ctx.contact.name !== ctx.customer.name && <span className="muted"> · {ctx.contact.name}</span>}
        </div>
      )}
      {ctx.address && (
        <div className="small muted row" style={{ gap: 6, alignItems: 'flex-start' }}>
          <MapPin size={15} style={{ flex: 'none', marginTop: 2 }} />
          <span>{addressLine(ctx.address)}</span>
        </div>
      )}
      {ctx.address?.entryNotes && (
        <div className="small row" style={{ gap: 6 }}><KeyRound size={15} className="muted" style={{ flex: 'none' }} /><span>{ctx.address.entryNotes}</span></div>
      )}
      {a.notes && <div className="job-note small">{a.notes}</div>}
      {a.checklist.length > 0 && !done && (
        <div className="row small" style={{ gap: 8 }}>
          <div className="progress grow"><div style={{ width: `${(checked / a.checklist.length) * 100}%` }} /></div>
          <span className="muted tiny nowrap">{checked}/{a.checklist.length}</span>
        </div>
      )}
      {!done && (
        <div className="job-actions">
          {ctx.address && <a className="btn sm" href={wazeLink(ctx.address)} target="_blank" rel="noreferrer"><Navigation size={15} /> Waze</a>}
          {ctx.phone && <a className="btn sm" href={telLink(ctx.phone)}><Phone size={15} /> חיוג</a>}
          {ctx.phone && <button className="btn sm wa" onClick={onMessage}><MessageCircle size={15} /> וואטסאפ</button>}
        </div>
      )}
      <div className="job-flow">
        <StatusFlow ap={a} big={!done} />
        <Link to={`/field/${a.id}`} className="btn ghost">{done ? 'לפרטים' : 'מסך המשימה'} <ChevronLeft size={16} /></Link>
      </div>
    </div>
  )
}

function QuickMessage({ ap, onClose }: { ap: Appointment; onClose: () => void }) {
  const db = useApp((s) => s.db)
  const me = useMe()
  const ctx = jobContext(db, ap)
  const text = fill(`שלום {name}, כאן ${firstName(me.name)} מ{brand}. `, messageVars(ctx, ap))
  return <MessageModal title={`הודעה ל${ctx.customer?.name ?? 'לקוח'}`} to={ctx.phone} text={text} caseId={ap.caseId} serviceCallId={ap.serviceCallId} customerId={ctx.customer?.id} onClose={onClose} />
}
