import { useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CalendarPlus, CheckCircle2, ChevronLeft, FileSignature, HardHat, History, MessageCircle, Package, RotateCcw, ShieldCheck, ShieldOff, Star, Trash2 } from 'lucide-react'
import { Avatars, Badge, Callout, Card, Confirm, Empty, Field, PageHead, toast } from '../../components/ui'
import { Dictate, QuickContact } from '../../components/extras'
import { useApp, useSettings } from '../../lib/store'
import type { ID, ServiceCall, ServiceStatus } from '../../lib/types'
import { appointmentStatusLabel, contractTypeLabel, serviceStatusLabel, serviceStatusTone, sourceLabel } from '../../lib/labels'
import { date as fmtDate, dateShortDay, dateTime, money, nowIso, relative, time as fmtTime } from '../../lib/format'
import { fill, templates, type TemplateKey } from '../../lib/messaging'
import { ScheduleDialog } from '../../features/schedule/ScheduleDialog'
import { MessageModal } from '../../features/ops/MessageBox'
import {
  addressLine, findStock, greetName, locationsOf, MAIN_WAREHOUSE, moveStock, openStatuses, serviceDoneText, symptomLabel, urgencyLabel, urgencyTone, vanOf, warrantyOf,
} from '../../features/ops/ops'
import '../../features/ops/ops.css'

const flow: ServiceStatus[] = ['new', 'assigned', 'scheduled', 'in_progress', 'waiting_parts']

export default function ServiceCallPage() {
  const { id } = useParams()
  const call = useApp((s) => s.db.serviceCalls.find((x) => x.id === id))
  if (!call) {
    return (
      <Card>
        <Empty title="הקריאה לא נמצאה"><Link to="/service">לכל הקריאות</Link></Empty>
      </Card>
    )
  }
  return <CallView call={call} />
}

function CallView({ call }: { call: ServiceCall }) {
  const db = useApp((s) => s.db)
  const settings = useSettings()
  const s = useApp.getState
  const closeRef = useRef<HTMLDivElement>(null)
  const [schedule, setSchedule] = useState(false)
  const [msg, setMsg] = useState<{ title: string; text: string; key: TemplateKey } | null>(null)
  const [cancel, setCancel] = useState(false)

  const customer = db.customers.find((c) => c.id === call.customerId)
  const contact = db.contacts.find((c) => c.customerId === call.customerId && c.primary) ?? db.contacts.find((c) => c.customerId === call.customerId)
  const address = customer?.addresses.find((a) => a.id === call.addressId) ?? customer?.addresses[0]
  const phone = contact?.phone ?? customer?.phone
  const unit = db.units.find((u) => u.id === call.unitId)
  const w = warrantyOf(unit)
  const contract = db.contracts.find((c) => c.id === call.contractId)
  const suggestContract = !contract
    ? db.contracts.find((c) => c.customerId === call.customerId && (c.status === 'active' || c.status === 'expiring') && (!call.unitId || !c.unitIds.length || c.unitIds.includes(call.unitId)))
    : undefined
  const lastExpired = !contract && !suggestContract
    ? db.contracts.filter((c) => c.customerId === call.customerId && c.status === 'expired').sort((a, b) => b.endDate.localeCompare(a.endDate))[0]
    : undefined
  const visits = useMemo(() => db.appointments.filter((a) => a.serviceCallId === call.id).sort((a, b) => b.start.localeCompare(a.start)), [db.appointments, call.id])
  const history = useMemo(
    () => db.serviceCalls.filter((x) => x.id !== call.id && (call.unitId ? x.unitId === call.unitId : x.customerId === call.customerId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [db.serviceCalls, call.id, call.unitId, call.customerId],
  )
  const feed = useMemo(() => {
    const m = db.messages.filter((x) => x.serviceCallId === call.id).map((x) => ({ at: x.at, kind: 'msg' as const, m: x }))
    const a = db.activities.filter((x) => x.serviceCallId === call.id).map((x) => ({ at: x.at, kind: 'act' as const, a: x }))
    return [...m, ...a].sort((x, y) => y.at.localeCompare(x.at))
  }, [db.messages, db.activities, call.id])
  const techs = db.users.filter((u) => u.active && u.role === 'installer')
  const isOpen = openStatuses.includes(call.status)
  const vars = { name: greetName(customer, contact), number: call.number, resolution: call.resolution ? `${call.resolution}.` : '', review: settings.reviewUrl }

  const patch = (changes: Partial<ServiceCall>, log?: string) => {
    s().patch('serviceCalls', call.id, changes)
    if (log) s().log({ kind: 'service', serviceCallId: call.id, customerId: call.customerId, text: log })
  }
  const setStatus = (st: ServiceStatus) => {
    if (st === call.status) return
    if (st === 'done') return closeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    if (st === 'cancelled') return setCancel(true)
    patch({ status: st }, `סטטוס: ${serviceStatusLabel[st]}`)
    if (st === 'waiting_parts') db.users.filter((u) => u.role === 'office').forEach((u) => s().notify(u.id, `${call.number} ממתינה לחלק — להזמין`, `/service/${call.id}`))
  }
  const setAssignee = (uid: ID) => {
    patch({ assigneeId: uid || undefined, ...(call.status === 'new' && uid ? { status: 'assigned' as const } : {}) }, uid ? `שובץ טכנאי: ${db.users.find((u) => u.id === uid)?.name}` : 'הוסר השיבוץ')
    if (uid && uid !== s().currentUserId) s().notify(uid, `קריאה שובצה לך: ${call.number}`, `/service/${call.id}`)
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row"><Link to="/service" className="btn sm ghost">כל הקריאות <ChevronLeft size={15} /></Link></div>
      <PageHead
        title={call.description}
        sub={
          <span className="row wrap" style={{ gap: 6 }}>
            <span className="num strong">{call.number}</span>
            <span className="muted">· נפתחה {relative(call.createdAt)} ({sourceLabel[call.source]})</span>
            <Badge tone={serviceStatusTone[call.status]} dot>{serviceStatusLabel[call.status]}</Badge>
            <Badge tone={urgencyTone[call.urgency]}>דחיפות {urgencyLabel[call.urgency]}</Badge>
            {call.underWarranty ? <Badge tone="success">באחריות</Badge> : <Badge tone="muted">לא באחריות</Badge>}
          </span>
        }
        actions={
          <>
            {phone && <button className="btn wa" onClick={() => setMsg({ title: 'הודעה ללקוח', text: fill(isOpen ? templates.service_received.text : serviceDoneText, vars), key: isOpen ? 'service_received' : 'free' })}><MessageCircle size={16} /> וואטסאפ</button>}
            {isOpen && <button className="btn primary" onClick={() => setSchedule(true)}><CalendarPlus size={16} /> שיבוץ ביקור</button>}
          </>
        }
      />

      <div className="grid g-side">
        <div className="col" style={{ gap: 16 }}>
          <Card title="פרטי הקריאה">
            <div className="card-body col" style={{ gap: 12 }}>
              <dl className="kv">
                <dt>לקוח</dt>
                <dd>{customer ? <Link to={`/customers/${customer.id}`} className="strong">{customer.name}</Link> : '—'}{contact && contact.name !== customer?.name ? <span className="muted"> · {contact.name}{contact.role ? ` (${contact.role})` : ''}</span> : null}</dd>
                <dt>כתובת</dt>
                <dd>{addressLine(address) || '—'}{address?.entryNotes ? <div className="tiny muted">{address.entryNotes}</div> : null}</dd>
                <dt>תקלה</dt>
                <dd>{call.symptom ? symptomLabel[call.symptom] : '—'}{call.errorCode ? <> · <Badge tone="danger">קוד {call.errorCode}</Badge></> : null}</dd>
                <dt>תיאור</dt>
                <dd>{call.description}</dd>
                {call.charge !== undefined && (<><dt>חיוב</dt><dd>{money(call.charge)} <span className="tiny muted">לפני מע״מ</span></dd></>)}
              </dl>
              <QuickContact phone={phone} address={address} />
            </div>
          </Card>

          <Card title="סטטוס ושיבוץ">
            <div className="card-body col" style={{ gap: 12 }}>
              {isOpen ? (
                <div className="status-chips">
                  {flow.map((st) => (
                    <button key={st} className={`chip ${call.status === st ? 'on' : ''}`} onClick={() => setStatus(st)}>{serviceStatusLabel[st]}</button>
                  ))}
                  <button className="chip" onClick={() => setStatus('done')}>טופלה…</button>
                  <button className="chip" onClick={() => setStatus('cancelled')}>ביטול</button>
                </div>
              ) : (
                <div className="row between wrap">
                  <Badge tone={serviceStatusTone[call.status]} dot>{serviceStatusLabel[call.status]}{call.closedAt ? ` · ${dateTime(call.closedAt)}` : ''}</Badge>
                  <button className="btn sm" onClick={() => patch({ status: call.assigneeId ? 'assigned' : 'new', closedAt: undefined }, 'הקריאה נפתחה מחדש')}><RotateCcw size={15} /> פתיחה מחדש</button>
                </div>
              )}
              <Field label="טכנאי אחראי">
                <select className="select" value={call.assigneeId ?? ''} onChange={(e) => setAssignee(e.target.value)} disabled={!isOpen}>
                  <option value="">לא שובץ</option>
                  {techs.map((u) => <option key={u.id} value={u.id}>{u.name}{u.skills?.length ? ` · ${u.skills.join(', ')}` : ''}</option>)}
                </select>
              </Field>
            </div>
          </Card>

          <Card title="ביקורים" actions={isOpen ? <button className="btn sm" onClick={() => setSchedule(true)}><CalendarPlus size={15} /> שיבוץ</button> : undefined}>
            {visits.length ? (
              <div className="list">
                {visits.map((a) => (
                  <Link key={a.id} to={`/field/${a.id}`} className="list-item">
                    <HardHat size={18} className="muted" />
                    <span className="grow">
                      <span className="strong" style={{ display: 'block' }}>{dateShortDay(a.start)} · <span className="num">{fmtTime(a.start)}–{fmtTime(a.end)}</span></span>
                      <span className="tiny muted">{a.userIds.map((u) => db.users.find((x) => x.id === u)?.name).join(', ')}</span>
                    </span>
                    <Badge tone={a.status === 'done' ? 'success' : a.status === 'cancelled' ? 'danger' : 'info'}>{appointmentStatusLabel[a.status]}</Badge>
                    <Avatars users={a.userIds.map((u) => db.users.find((x) => x.id === u))} />
                  </Link>
                ))}
              </div>
            ) : (
              <Empty title="עוד לא נקבע ביקור">{isOpen ? 'שבצו טכנאי, והלקוח יקבל אישור בוואטסאפ' : undefined}</Empty>
            )}
          </Card>

          <PartsCard call={call} />

          <div ref={closeRef}>
            {isOpen ? (
              <CloseCard call={call} onClosed={() => phone && setMsg({ title: 'עדכון ללקוח', text: fill(serviceDoneText, { ...vars, resolution: `${useApp.getState().db.serviceCalls.find((x) => x.id === call.id)?.resolution ?? ''}.` }), key: 'free' })} />
            ) : call.status === 'done' ? (
              <Card>
                <div className="card-body col" style={{ gap: 10 }}>
                  <Callout tone="success" icon={<CheckCircle2 size={18} />}>
                    <div className="strong">הקריאה טופלה{call.closedAt ? ` · ${dateTime(call.closedAt)}` : ''}</div>
                    <div>{call.resolution}</div>
                    {call.charge !== undefined && <div className="muted">חיוב: {money(call.charge)}</div>}
                  </Callout>
                  {phone && (
                    <div className="row wrap">
                      <button className="btn wa" onClick={() => setMsg({ title: 'עדכון ללקוח', text: fill(serviceDoneText, vars), key: 'free' })}><MessageCircle size={16} /> עדכון ללקוח</button>
                      {settings.reviewUrl && <button className="btn" onClick={() => setMsg({ title: 'בקשת חוות דעת', text: fill(templates.review.text, vars), key: 'review' })}><Star size={16} /> בקשת חוות דעת</button>}
                    </div>
                  )}
                </div>
              </Card>
            ) : null}
          </div>
        </div>

        <aside className="col" style={{ gap: 16 }}>
          <Card title="היחידה">
            <div className="card-body col" style={{ gap: 10 }}>
              {unit ? (
                <>
                  <div>
                    <div className="strong">{unit.model}</div>
                    <div className="small muted">{unit.location} · <span className="ltr">{unit.serial}</span></div>
                  </div>
                  <div className={`warranty ${w.under ? 'ok' : 'off'}`}>
                    {w.under ? <ShieldCheck size={18} /> : <ShieldOff size={18} />}
                    <div className="grow small">{w.under ? <><b>באחריות</b> עד {fmtDate(w.until)}</> : <><b>האחריות הסתיימה</b> ב-{fmtDate(w.until)}</>}</div>
                  </div>
                  <dl className="kv small">
                    <dt>הותקנה</dt><dd>{fmtDate(unit.installedAt)}</dd>
                    <dt>טיפול אחרון</dt><dd>{unit.lastServiceAt ? fmtDate(unit.lastServiceAt) : '—'}</dd>
                    <dt>טיפול הבא</dt><dd>{unit.nextServiceAt ? fmtDate(unit.nextServiceAt) : '—'}</dd>
                  </dl>
                </>
              ) : (
                <>
                  <div className="small muted">לא צוינה יחידה.</div>
                  {db.units.some((u) => u.customerId === call.customerId) && (
                    <select
                      className="select"
                      value=""
                      onChange={(e) => {
                        const u = db.units.find((x) => x.id === e.target.value)
                        if (u) patch({ unitId: u.id, underWarranty: warrantyOf(u).under }, `שויכה יחידה: ${u.location ?? u.model}`)
                      }}
                    >
                      <option value="">שיוך יחידה של הלקוח...</option>
                      {db.units.filter((u) => u.customerId === call.customerId).map((u) => <option key={u.id} value={u.id}>{u.location ? `${u.location} · ` : ''}{u.model}</option>)}
                    </select>
                  )}
                </>
              )}
              <label className="check small">
                <input type="checkbox" checked={!!call.underWarranty} onChange={(e) => patch({ underWarranty: e.target.checked }, e.target.checked ? 'סומנה כקריאת אחריות' : 'סומנה כקריאה בתשלום')} /> קריאת אחריות
              </label>
            </div>
          </Card>

          <Card title={<div className="row" style={{ gap: 8 }}><FileSignature size={16} className="muted" /><h2>חוזה</h2></div>}>
            <div className="card-body col" style={{ gap: 8 }}>
              {contract ? (
                <>
                  <div className="strong">{contract.title}</div>
                  <div className="small muted">{contract.number} · {contractTypeLabel[contract.type]}</div>
                  <div className="row wrap" style={{ gap: 6 }}>
                    <Badge tone={contract.status === 'active' ? 'success' : contract.status === 'expiring' ? 'warning' : 'muted'}>{contract.status === 'active' ? 'פעיל' : contract.status === 'expiring' ? 'מסתיים בקרוב' : contract.status === 'expired' ? 'פג' : contract.status === 'proposed' ? 'הוצע ללקוח' : 'בוטל'}</Badge>
                    <span className="tiny muted">ביקור הבא {fmtDate(contract.nextVisit)} · עד {fmtDate(contract.endDate)}</span>
                  </div>
                  <Link to="/contracts" className="small">לחוזים ותחזוקה</Link>
                </>
              ) : suggestContract ? (
                <>
                  <div className="small">ללקוח יש חוזה פעיל: <b>{suggestContract.title}</b> ({suggestContract.number})</div>
                  <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => patch({ contractId: suggestContract.id }, `שויך לחוזה ${suggestContract.number}`)}>שיוך הקריאה לחוזה</button>
                </>
              ) : lastExpired ? (
                <div className="small">החוזה האחרון של הלקוח (<b>{lastExpired.number}</b>, {lastExpired.title}) הסתיים ב-{fmtDate(lastExpired.endDate)}. הזדמנות טובה להציע חידוש.</div>
              ) : (
                <div className="small muted">אין חוזה שירות פעיל ללקוח.</div>
              )}
            </div>
          </Card>

          <Card title={<div className="row" style={{ gap: 8 }}><History size={16} className="muted" /><h2>{call.unitId ? 'היסטוריה של היחידה' : 'קריאות קודמות של הלקוח'}</h2></div>}>
            {history.length ? (
              <div className="list">
                {history.slice(0, 6).map((h) => (
                  <Link key={h.id} to={`/service/${h.id}`} className="list-item small">
                    <span className="grow">
                      <span className="strong" style={{ display: 'block' }}>{h.description}</span>
                      <span className="tiny muted">{h.number} · {fmtDate(h.createdAt)}{h.resolution ? ` · ${h.resolution}` : ''}</span>
                    </span>
                    <Badge tone={serviceStatusTone[h.status]}>{serviceStatusLabel[h.status]}</Badge>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="card-body small muted">זו הקריאה הראשונה{call.unitId ? ' על היחידה הזו' : ' של הלקוח'}.</div>
            )}
          </Card>

          <Card title="הודעות ופעילות">
            {feed.length ? (
              <div className="card-body">
                <div className="timeline">
                  {feed.slice(0, 20).map((f, i) =>
                    f.kind === 'msg' ? (
                      <div key={i} className="tl-item">
                        <div className="when">{dateTime(f.at)} · {f.m.direction === 'in' ? 'מהלקוח' : 'ללקוח'} ({f.m.channel === 'whatsapp' ? 'וואטסאפ' : f.m.channel})</div>
                        <div className={`tl-msg ${f.m.direction}`}>{f.m.body}</div>
                      </div>
                    ) : (
                      <div key={i} className="tl-item">
                        <div className="when">{dateTime(f.at)}{f.a.userId ? ` · ${db.users.find((u) => u.id === f.a.userId)?.name ?? ''}` : ''}</div>
                        <div className="small">{f.a.text}</div>
                      </div>
                    ),
                  )}
                </div>
              </div>
            ) : (
              <div className="card-body small muted">עוד אין הודעות או פעולות על הקריאה.</div>
            )}
          </Card>
        </aside>
      </div>

      {schedule && <ScheduleDialog type="service" serviceCallId={call.id} onClose={() => setSchedule(false)} />}
      {msg && <MessageModal title={msg.title} to={phone} text={msg.text} templateKey={msg.key} serviceCallId={call.id} customerId={call.customerId} onClose={() => setMsg(null)} />}
      {cancel && (
        <Confirm title="לבטל את הקריאה?" text={`${call.number} — ${call.description}`} confirmLabel="ביטול הקריאה" danger onClose={() => setCancel(false)} onConfirm={() => { patch({ status: 'cancelled', closedAt: nowIso() }, 'הקריאה בוטלה'); toast.success('הקריאה בוטלה') }} />
      )}
    </div>
  )
}

function PartsCard({ call }: { call: ServiceCall }) {
  const db = useApp((s) => s.db)
  const assignee = db.users.find((u) => u.id === call.assigneeId)
  const locations = locationsOf(db)
  const [loc, setLoc] = useState(assignee ? vanOf(assignee) : MAIN_WAREHOUSE)
  const [itemId, setItemId] = useState('')
  const [qty, setQty] = useState(1)
  const parts = call.partsUsed ?? []
  const items = db.catalog.filter((c) => c.active && c.category !== 'labor')
  const isOpen = openStatuses.includes(call.status)

  const add = () => {
    if (!itemId || qty <= 0) return
    const left = moveStock(itemId, loc, -qty)
    const ex = parts.find((p) => p.itemId === itemId)
    const next = ex ? parts.map((p) => (p === ex ? { ...p, qty: p.qty + qty } : p)) : [...parts, { itemId, qty }]
    useApp.getState().patch('serviceCalls', call.id, { partsUsed: next })
    useApp.getState().log({ kind: 'service', serviceCallId: call.id, customerId: call.customerId, text: `נרשם חלק: ${db.catalog.find((c) => c.id === itemId)?.name} × ${qty} (${loc})` })
    if (left < 0) toast.error(`המלאי ב${loc} ירד מתחת לאפס (${left})`)
    else toast.success(`נרשם. נשארו ${left} ב${loc}`)
    setItemId('')
    setQty(1)
  }
  const remove = (i: number) => {
    const p = parts[i]
    moveStock(p.itemId, loc, p.qty)
    useApp.getState().patch('serviceCalls', call.id, { partsUsed: parts.filter((_, j) => j !== i) })
    toast.info(`הוחזר ל${loc}`)
  }

  return (
    <Card title={<div className="row" style={{ gap: 8 }}><Package size={16} className="muted" /><h2>חלקים</h2></div>}>
      {parts.length > 0 && (
        <div className="list">
          {parts.map((p, i) => {
            const it = db.catalog.find((c) => c.id === p.itemId)
            return (
              <div key={p.itemId} className="list-item">
                <span className="grow">{it?.name ?? p.itemId}<span className="tiny muted" style={{ display: 'block' }}>{it?.sku}</span></span>
                <span className="num strong">{p.qty} {it?.unit}</span>
                {isOpen && <button className="icon-btn" onClick={() => remove(i)} aria-label="הסרה"><Trash2 size={16} /></button>}
              </div>
            )
          })}
        </div>
      )}
      {isOpen ? (
        <div className="card-body col" style={{ gap: 8, borderTop: parts.length ? '1px solid var(--line-2)' : 0 }}>
          <div className="parts-add">
            <select className="select" value={itemId} onChange={(e) => setItemId(e.target.value)} aria-label="פריט">
              <option value="">בחירת חלק...</option>
              {items.map((c) => <option key={c.id} value={c.id}>{c.name}{findStock(db.stock, c.id, loc) ? ` (${findStock(db.stock, c.id, loc)!.qty})` : ''}</option>)}
            </select>
            <input className="input num" type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} aria-label="כמות" />
            <button className="btn primary" disabled={!itemId} onClick={add}>הוספה</button>
          </div>
          <div className="row small" style={{ gap: 8 }}>
            <span className="muted nowrap">יורד מ:</span>
            <select className="select sm" style={{ width: 'auto' }} value={loc} onChange={(e) => setLoc(e.target.value)}>
              {locations.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        </div>
      ) : (
        !parts.length && <div className="card-body small muted">לא נרשמו חלקים.</div>
      )}
    </Card>
  )
}

function CloseCard({ call, onClosed }: { call: ServiceCall; onClosed: () => void }) {
  const db = useApp((s) => s.db)
  const visit = db.catalog.find((c) => c.id === 's-visit')?.price ?? 290
  const [resolution, setResolution] = useState(call.resolution ?? '')
  const [charge, setCharge] = useState<number>(call.charge ?? (call.underWarranty ? 0 : visit))
  const close = () => {
    if (!resolution.trim()) return
    const s = useApp.getState()
    s.patch('serviceCalls', call.id, { status: 'done', resolution: resolution.trim(), charge, closedAt: nowIso() })
    s.log({ kind: 'service', serviceCallId: call.id, customerId: call.customerId, text: `הקריאה נסגרה: ${resolution.trim()}` })
    db.appointments.filter((a) => a.serviceCallId === call.id && !['done', 'cancelled'].includes(a.status)).forEach((a) => s.patch('appointments', a.id, { status: 'done', completedAt: nowIso() }))
    toast.success(`${call.number} נסגרה`)
    onClosed()
  }
  return (
    <Card title="סגירת הקריאה">
      <div className="card-body col" style={{ gap: 10 }}>
        <Field label="מה נעשה">
          <textarea className="textarea" rows={3} value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="אבחון, תיקון, חלקים שהוחלפו" />
        </Field>
        <div className="row between wrap" style={{ gap: 10 }}>
          <Dictate onText={(t) => setResolution((x) => (x ? `${x} ${t}` : t))} />
          <div className="row" style={{ gap: 8 }}>
            <span className="small muted nowrap">חיוב לפני מע״מ</span>
            <input className="input num" style={{ width: 110 }} inputMode="numeric" value={charge} onChange={(e) => setCharge(Number(e.target.value.replace(/[^\d.]/g, '')) || 0)} />
          </div>
        </div>
        {call.underWarranty && <div className="tiny txt-success">הקריאה באחריות</div>}
        <button className="btn success" disabled={!resolution.trim()} onClick={close}><CheckCircle2 size={16} /> סגירת הקריאה</button>
      </div>
    </Card>
  )
}
