import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation, useParams } from 'react-router-dom'
import {
  ArrowRight, Camera, CheckCircle2, ClipboardCheck, ExternalLink, FileBadge, KeyRound, ListChecks, MapPin, MessageCircle, Minus, Package, Plus, Printer, Star, Trash2, X,
} from 'lucide-react'
import { Badge, Callout, Card, Empty, Field, Modal, PhotoInput, Progress, SignaturePad, toast } from '../../components/ui'
import { Dictate, QuickContact } from '../../components/extras'
import { useApp, useMe, useSettings } from '../../lib/store'
import { completeInstallation } from '../../lib/actions'
import type { Appointment, ChecklistItem, Contract, DB, ID, InstalledUnit, Photo, Signature } from '../../lib/types'
import { appointmentStatusLabel, appointmentTypeColor, appointmentTypeLabel, categoryLabel } from '../../lib/labels'
import { date as fmtDate, dateLong, dateTime, money, nowIso, time as fmtTime, uid, ymd } from '../../lib/format'
import { mapsEmbed, mapsLink } from '../../lib/integrations/links'
import { fill, templates, type TemplateKey } from '../../lib/messaging'
import { brand } from '../../brand'
import { StatusFlow } from '../../features/ops/JobStatus'
import { MessageModal } from '../../features/ops/MessageBox'
import {
  addMonths, addressLine, checklistFor, findStock, jobContext, messageVars, moveStock, serviceDoneText, symptomLabel, vanOf, visitDoneText, warrantyOf,
} from '../../features/ops/ops'
import { Wordmark } from '../../components/Layout'
import '../../features/ops/ops.css'

const statusTone = { planned: 'muted', confirmed: 'info', on_the_way: 'brand', in_progress: 'warning', done: 'success', cancelled: 'danger' } as const

export default function FieldJob() {
  const { id } = useParams()
  const ap = useApp((s) => s.db.appointments.find((a) => a.id === id))
  if (!ap) {
    return (
      <Card>
        <Empty title="המשימה לא נמצאה">
          <Link to="/field">חזרה ליום שלי</Link>
        </Empty>
      </Card>
    )
  }
  return <Job ap={ap} />
}

function Job({ ap }: { ap: Appointment }) {
  const db = useApp((s) => s.db)
  const patch = useApp((s) => s.patch)
  const me = useMe()
  const loc = useLocation()
  const ctx = useMemo(() => jobContext(db, ap), [db, ap])
  const finishRef = useRef<HTMLDivElement>(null)
  const [msg, setMsg] = useState<{ title: string; text: string; key: TemplateKey } | null>(null)
  const [cert, setCert] = useState(false)
  const done = ap.status === 'done'
  const goFinish = () => finishRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  useEffect(() => {
    if ((loc.state as { finish?: boolean } | null)?.finish) setTimeout(goFinish, 250)
  }, [loc.state])

  const save = (changes: Partial<Appointment>) => patch('appointments', ap.id, changes)

  return (
    <div className="fieldapp job">
      <div className="row between no-print">
        <Link to="/field" className="btn sm ghost"><ArrowRight size={16} /> היום שלי</Link>
        {ap.caseId && <Link to={`/cases/${ap.caseId}`} className="btn sm ghost">לתיק <ExternalLink size={14} /></Link>}
        {ap.serviceCallId && <Link to={`/service/${ap.serviceCallId}`} className="btn sm ghost">לקריאה <ExternalLink size={14} /></Link>}
      </div>

      <div className="job-card job-head" style={{ borderInlineStartColor: appointmentTypeColor[ap.type] }}>
        <div className="row wrap" style={{ gap: 6 }}>
          <span className="badge" style={{ background: appointmentTypeColor[ap.type] + '1f', color: appointmentTypeColor[ap.type] }}>{appointmentTypeLabel[ap.type]}</span>
          <Badge tone={statusTone[ap.status]}>{appointmentStatusLabel[ap.status]}</Badge>
          {ctx.call?.underWarranty && <Badge tone="success">באחריות</Badge>}
        </div>
        <h1 className="job-h1">{ap.title}</h1>
        <div className="small muted">{dateLong(ap.start)} · <span className="num">{fmtTime(ap.start)}–{fmtTime(ap.end)}</span>{ctx.team.length ? ` · ${ctx.team.map((u) => u.name).join(', ')}` : ''}</div>
        {ctx.customer && (
          <div className="col" style={{ gap: 4 }}>
            <div><span className="strong">{ctx.customer.name}</span>{ctx.contact && ctx.contact.name !== ctx.customer.name && <span className="muted"> · {ctx.contact.name}{ctx.contact.role ? ` (${ctx.contact.role})` : ''}</span>}</div>
            {ctx.address && <div className="small row" style={{ gap: 6, alignItems: 'flex-start' }}><MapPin size={15} className="muted" style={{ flex: 'none', marginTop: 2 }} />{addressLine(ctx.address)}</div>}
            {ctx.address?.entryNotes && <div className="small row" style={{ gap: 6 }}><KeyRound size={15} className="muted" style={{ flex: 'none' }} />{ctx.address.entryNotes}</div>}
          </div>
        )}
        <QuickContact
          phone={ctx.phone}
          address={ctx.address}
          whatsapp={ctx.phone ? () => setMsg({ title: 'הודעה ללקוח', text: fill('שלום {name}, ', messageVars(ctx, ap)), key: 'free' }) : undefined}
        />
        {!done && <div className="job-flow"><StatusFlow ap={ap} big onFinish={goFinish} />{ap.status !== 'in_progress' && <button className="btn ghost" onClick={goFinish}>לסיום ומסירה</button>}</div>}
      </div>

      <div className="job-grid">
        <div className="col" style={{ gap: 16 }}>
          <ChecklistCard ap={ap} onChange={(checklist) => save({ checklist })} />
          <PhotosCard ap={ap} userId={me.id} onChange={save} />
          <PartsCard ap={ap} db={db} />
          <div ref={finishRef} style={{ scrollMarginTop: 80 }}>
            {done ? (
              <DoneCard ap={ap} db={db} onMessage={setMsg} onCert={() => setCert(true)} />
            ) : (
              <FinishCard ap={ap} db={db} onDone={(kind) => {
                if (kind === 'inspection') setCert(true)
              }} />
            )}
          </div>
        </div>
        <aside className="col" style={{ gap: 16 }}>
          {ctx.address && (
            <Card>
              <iframe className="map-embed" title="מפה" src={mapsEmbed(ctx.address)} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
              <div className="card-body row between">
                <span className="small">{addressLine(ctx.address)}</span>
                <a className="btn sm ghost" href={mapsLink(ctx.address)} target="_blank" rel="noreferrer">גוגל מפות <ExternalLink size={13} /></a>
              </div>
            </Card>
          )}
          <NotesCard ap={ap} db={db} onSave={(notes) => save({ notes })} />
          <RelatedCard ap={ap} db={db} />
        </aside>
      </div>

      {msg && (
        <MessageModal title={msg.title} to={ctx.phone} text={msg.text} templateKey={msg.key} caseId={ap.caseId} serviceCallId={ap.serviceCallId} customerId={ctx.customer?.id} onClose={() => setMsg(null)} />
      )}
      {cert && <CertModal ap={ap} db={db} onClose={() => setCert(false)} />}
    </div>
  )
}

// ---------- צ׳קליסט ----------
function ChecklistCard({ ap, onChange }: { ap: Appointment; onChange: (l: ChecklistItem[]) => void }) {
  const [text, setText] = useState('')
  const list = ap.checklist
  const doneN = list.filter((c) => c.done).length
  return (
    <Card title={<div className="row" style={{ gap: 8 }}><ListChecks size={17} className="muted" /><h2>צ׳קליסט</h2></div>} actions={list.length ? <span className="small muted">{doneN}/{list.length}</span> : undefined}>
      {list.length > 0 && <div style={{ padding: '12px 18px 0' }}><Progress value={(doneN / list.length) * 100} /></div>}
      <div className="list check-list">
        {list.map((c) => (
          <label key={c.id} className={`list-item check-row ${c.done ? 'on' : ''}`}>
            <input type="checkbox" checked={c.done} onChange={() => onChange(list.map((x) => (x.id === c.id ? { ...x, done: !x.done } : x)))} />
            <span className="grow">{c.text}</span>
          </label>
        ))}
        {!list.length && (
          <div className="row between wrap small muted" style={{ padding: '12px 18px' }}>
            <span>אין צ׳קליסט למשימה הזו.</span>
            {checklistFor(ap.type).length > 0 && <button type="button" className="btn sm" onClick={() => onChange(checklistFor(ap.type))}>טעינת הצ׳קליסט הקבוע ל{appointmentTypeLabel[ap.type]}</button>}
          </div>
        )}
      </div>
      <form
        className="row card-body"
        style={{ borderTop: '1px solid var(--line-2)' }}
        onSubmit={(e) => {
          e.preventDefault()
          if (!text.trim()) return
          onChange([...list, { id: uid('cl'), text: text.trim(), done: false }])
          setText('')
        }}
      >
        <input className="input sm grow" value={text} onChange={(e) => setText(e.target.value)} placeholder="שלב נוסף..." />
        <button className="btn sm" type="submit" disabled={!text.trim()}><Plus size={15} /> הוספה</button>
      </form>
    </Card>
  )
}

// ---------- תמונות לפני/אחרי ----------
function PhotosCard({ ap, userId, onChange }: { ap: Appointment; userId: ID; onChange: (c: Partial<Appointment>) => void }) {
  const add = (tag: 'before' | 'after', urls: string[]) => {
    const ph: Photo[] = urls.map((dataUrl) => ({ id: uid('ph'), dataUrl, tag, takenAt: nowIso(), by: userId }))
    if (tag === 'before') onChange({ photosBefore: [...ap.photosBefore, ...ph] })
    else onChange({ photosAfter: [...ap.photosAfter, ...ph] })
    toast.success(urls.length > 1 ? `נוספו ${urls.length} תמונות` : 'התמונה נשמרה')
  }
  const del = (tag: 'before' | 'after', id: ID) => {
    if (tag === 'before') onChange({ photosBefore: ap.photosBefore.filter((p) => p.id !== id) })
    else onChange({ photosAfter: ap.photosAfter.filter((p) => p.id !== id) })
  }
  const block = (tag: 'before' | 'after', list: Photo[], label: string) => (
    <div>
      <div className="label mb8">{label} <span className="muted">({list.length})</span></div>
      <div className="photo-grid">
        {list.map((p) => (
          <div key={p.id} className="photo">
            <img src={p.dataUrl} alt={p.caption ?? label} />
            {p.caption && <div className="cap">{p.caption}</div>}
            <button className="x" onClick={() => del(tag, p.id)} aria-label="מחיקת תמונה"><X size={14} /></button>
          </div>
        ))}
        <PhotoInput label={tag === 'before' ? 'צילום לפני' : 'צילום אחרי'} onAdd={(u) => add(tag, u)} />
      </div>
    </div>
  )
  return (
    <Card title={<div className="row" style={{ gap: 8 }}><Camera size={17} className="muted" /><h2>תמונות</h2></div>}>
      <div className="card-body col" style={{ gap: 16 }}>
        {block('before', ap.photosBefore, 'לפני העבודה')}
        {block('after', ap.photosAfter, 'אחרי העבודה')}
      </div>
    </Card>
  )
}

// ---------- חלקים שנצרכו ----------
function PartsCard({ ap, db }: { ap: Appointment; db: DB }) {
  const me = useMe()
  const vanUser = ap.userIds.includes(me.id) ? me : db.users.find((u) => u.id === ap.userIds[0]) ?? me
  const van = vanOf(vanUser)
  const [itemId, setItemId] = useState('')
  const [qty, setQty] = useState(1)
  const parts = ap.partsUsed ?? []
  const items = useMemo(() => db.catalog.filter((c) => c.active && c.category !== 'labor'), [db.catalog])
  const inVan = items.filter((c) => findStock(db.stock, c.id, van))
  const rest = items.filter((c) => !findStock(db.stock, c.id, van))
  const sel = items.find((c) => c.id === itemId)
  const have = itemId ? findStock(db.stock, itemId, van)?.qty ?? 0 : 0

  const syncCall = (list: { itemId: ID; qty: number }[]) => {
    if (!ap.serviceCallId) return
    const s = useApp.getState()
    const call = s.db.serviceCalls.find((x) => x.id === ap.serviceCallId)
    if (!call) return
    const others = (call.partsUsed ?? []).filter((p) => !parts.some((q) => q.itemId === p.itemId))
    const merged = [...others, ...list.map(({ itemId: i, qty: q }) => ({ itemId: i, qty: q }))]
    s.patch('serviceCalls', call.id, { partsUsed: merged })
  }

  const add = () => {
    if (!itemId || qty <= 0) return
    const left = moveStock(itemId, van, -qty)
    const exists = parts.find((p) => p.itemId === itemId && p.location === van)
    const next = exists ? parts.map((p) => (p === exists ? { ...p, qty: p.qty + qty } : p)) : [...parts, { itemId, qty, location: van }]
    useApp.getState().patch('appointments', ap.id, { partsUsed: next })
    syncCall(next)
    if (left < 0) toast.error(`המלאי ברכב ירד מתחת לאפס (${left}). כדאי לעדכן את המשרד.`)
    else toast.success(`נרשם. נשארו ברכב ${left} ${sel?.unit ?? ''}`)
    setItemId('')
    setQty(1)
  }
  const remove = (i: number) => {
    const p = parts[i]
    moveStock(p.itemId, p.location ?? van, p.qty)
    const next = parts.filter((_, j) => j !== i)
    useApp.getState().patch('appointments', ap.id, { partsUsed: next })
    syncCall(next)
    toast.info('החלק הוחזר למלאי ברכב')
  }

  return (
    <Card title={<div className="row" style={{ gap: 8 }}><Package size={17} className="muted" /><h2>חלקים וחומרים</h2></div>} actions={<span className="tiny muted">יורד מ{van}</span>}>
      {parts.length > 0 && (
        <div className="list">
          {parts.map((p, i) => {
            const it = db.catalog.find((c) => c.id === p.itemId)
            const left = findStock(db.stock, p.itemId, p.location ?? van)?.qty ?? 0
            return (
              <div key={`${p.itemId}-${i}`} className="list-item">
                <span className="grow">
                  <span className="strong" style={{ display: 'block' }}>{it?.name ?? p.itemId}</span>
                  <span className={`tiny ${left < 0 ? 'txt-danger strong' : 'muted'}`}>נשארו ברכב: <span className="ltr num">{left}</span></span>
                </span>
                <span className="num strong">{p.qty} {it?.unit}</span>
                {ap.status !== 'done' && <button className="icon-btn" onClick={() => remove(i)} aria-label="הסרה"><Trash2 size={16} /></button>}
              </div>
            )
          })}
        </div>
      )}
      {ap.status !== 'done' ? (
        <div className="card-body col" style={{ gap: 8, borderTop: parts.length ? '1px solid var(--line-2)' : 0 }}>
          <div className="parts-add">
            <select className="select" value={itemId} onChange={(e) => setItemId(e.target.value)} aria-label="פריט">
              <option value="">בחירת פריט...</option>
              {inVan.length > 0 && (
                <optgroup label="ברכב">
                  {inVan.map((c) => <option key={c.id} value={c.id}>{c.name} ({findStock(db.stock, c.id, van)?.qty})</option>)}
                </optgroup>
              )}
              <optgroup label="שאר הקטלוג">
                {rest.map((c) => <option key={c.id} value={c.id}>{c.name} · {categoryLabel[c.category]}</option>)}
              </optgroup>
            </select>
            <div className="qty">
              <button type="button" className="icon-btn" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="פחות"><Minus size={15} /></button>
              <input className="input num" inputMode="numeric" value={qty} onChange={(e) => setQty(Math.max(0, Number(e.target.value.replace(/\D/g, '')) || 0))} aria-label="כמות" />
              <button type="button" className="icon-btn" onClick={() => setQty((q) => q + 1)} aria-label="יותר"><Plus size={15} /></button>
            </div>
            <button className="btn primary" disabled={!itemId || qty <= 0} onClick={add}>הוספה</button>
          </div>
          {sel && qty > have && <div className="tiny txt-warning">ברכב יש {have} {sel.unit}. אפשר לרשום בכל זאת, והמלאי יירד מתחת לאפס.</div>}
          {!parts.length && <div className="tiny muted">רשמו כל חלק שיצא מהרכב, כדי שהמלאי יישאר מעודכן.</div>}
        </div>
      ) : (
        !parts.length && <div className="card-body small muted">לא נרשמו חלקים.</div>
      )}
    </Card>
  )
}

// ---------- הערות ----------
function NotesCard({ ap, db, onSave }: { ap: Appointment; db: DB; onSave: (notes: string) => void }) {
  const [v, setV] = useState(ap.notes ?? '')
  useEffect(() => setV(ap.notes ?? ''), [ap.notes])
  const kase = ap.caseId ? db.cases.find((k) => k.id === ap.caseId) : undefined
  const dirty = v !== (ap.notes ?? '')
  return (
    <Card title="הערות" actions={<Dictate onText={(t) => setV((x) => (x ? `${x} ${t}` : t))} />}>
      <div className="card-body col" style={{ gap: 8 }}>
        {kase?.notes && <div className="small" style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '8px 10px' }}><span className="muted">מהתיק: </span>{kase.notes}</div>}
        {kase?.survey.voiceNotes && <div className="small" style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '8px 10px' }}><span className="muted">מהסקר: </span>{kase.survey.voiceNotes}</div>}
        <textarea className="textarea" rows={3} value={v} onChange={(e) => setV(e.target.value)} placeholder="ממצאים, בקשות של הלקוח, מה נשאר לעשות..." />
        {dirty && <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn sm primary" onClick={() => { onSave(v.trim()); toast.success('ההערות נשמרו') }}>שמירה</button></div>}
      </div>
    </Card>
  )
}

// ---------- מידע לעבודה ----------
function unitLines(db: DB, caseId?: ID) {
  const q = caseId ? db.quotes.find((x) => x.caseId === caseId && x.status === 'approved') : undefined
  if (!q) return { q, units: [], other: [] }
  const isUnit = (itemId?: ID) => {
    const it = db.catalog.find((c) => c.id === itemId)
    return !!it && ['unit', 'heating', 'ventilation'].includes(it.category) && it.unit !== 'מ״ר'
  }
  return { q, units: q.lines.filter((l) => isUnit(l.itemId)), other: q.lines.filter((l) => !isUnit(l.itemId)) }
}

function contractUnits(db: DB, c?: Contract): InstalledUnit[] {
  if (!c) return []
  return c.unitIds.map((id) => db.units.find((u) => u.id === id)).filter(Boolean) as InstalledUnit[]
}

function RelatedCard({ ap, db }: { ap: Appointment; db: DB }) {
  const ctx = jobContext(db, ap)
  if (ap.type === 'installation') {
    const { q, units, other } = unitLines(db, ap.caseId)
    if (!q) return null
    return (
      <Card title="מה מתקינים" actions={<span className="tiny muted">הצעה {q.number}</span>}>
        <div className="list">
          {[...units, ...other.filter((l) => db.catalog.find((c) => c.id === l.itemId)?.category !== 'labor')].map((l) => (
            <div key={l.id} className="list-item small">
              <span className="grow">{l.description}{l.room ? <span className="muted"> · {l.room}</span> : null}</span>
              <span className="num strong nowrap">{l.qty} {l.unit}</span>
            </div>
          ))}
        </div>
      </Card>
    )
  }
  if (ap.type === 'service' && ctx.call) {
    const unit = db.units.find((u) => u.id === ctx.call!.unitId)
    const w = warrantyOf(unit)
    return (
      <Card title={`קריאה ${ctx.call.number}`}>
        <div className="card-body col" style={{ gap: 8 }}>
          <div>{ctx.call.description}</div>
          <div className="row wrap" style={{ gap: 6 }}>
            {ctx.call.symptom && <Badge tone="info">{symptomLabel[ctx.call.symptom]}</Badge>}
            {ctx.call.errorCode && <Badge tone="danger">קוד {ctx.call.errorCode}</Badge>}
            {ctx.call.underWarranty ? <Badge tone="success">באחריות</Badge> : <Badge tone="muted">לא באחריות</Badge>}
          </div>
          {unit && (
            <div className="small" style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '8px 10px' }}>
              <div className="strong">{unit.model}</div>
              <div className="muted">{unit.location} · מס׳ סידורי <span className="ltr">{unit.serial}</span></div>
              <div className="muted">הותקן {fmtDate(unit.installedAt)} · אחריות עד {fmtDate(w.until)}</div>
            </div>
          )}
        </div>
      </Card>
    )
  }
  if ((ap.type === 'maintenance' || ap.type === 'inspection') && ctx.contract) {
    const units = contractUnits(db, ctx.contract)
    return (
      <Card title={ctx.contract.title} actions={<span className="tiny muted">{ctx.contract.number}</span>}>
        <div className="list">
          {units.map((u) => (
            <div key={u.id} className="list-item small">
              <span className="grow">
                <span className="strong" style={{ display: 'block' }}>{u.location ?? u.model}</span>
                <span className="muted ltr">{u.serial}</span>
              </span>
              <span className="tiny muted">טיפול אחרון: {u.lastServiceAt ? fmtDate(u.lastServiceAt) : '—'}</span>
            </div>
          ))}
          {!units.length && <div className="small muted card-body">לא משויכות יחידות לחוזה.</div>}
        </div>
      </Card>
    )
  }
  return null
}

// ---------- סיום ומסירה ----------
function FinishCard({ ap, db, onDone }: { ap: Appointment; db: DB; onDone: (kind: string) => void }) {
  const ctx = jobContext(db, ap)
  const visitPrice = db.catalog.find((c) => c.id === 's-visit')?.price ?? 290
  const [sig, setSig] = useState<string | null>(null)
  const [sigName, setSigName] = useState(ctx.contact?.name ?? ctx.customer?.name ?? '')
  const [serials, setSerials] = useState<Record<string, string>>({})
  const [resolution, setResolution] = useState(ctx.call?.resolution ?? '')
  const [charge, setCharge] = useState<number>(ctx.call?.charge ?? (ctx.call?.underWarranty ? 0 : visitPrice))
  const [outcome, setOutcome] = useState<'done' | 'waiting_parts'>('done')
  const units = contractUnits(db, ctx.contract)
  const [checkedUnits, setCheckedUnits] = useState<ID[]>(units.map((u) => u.id))
  const [findings, setFindings] = useState('')

  const otherDays = ap.caseId ? db.appointments.filter((x) => x.caseId === ap.caseId && x.id !== ap.id && x.type === 'installation' && !['done', 'cancelled'].includes(x.status)) : []
  const { units: uLines } = unitLines(db, ap.caseId)
  const open = ap.checklist.filter((c) => !c.done).length
  const needSig = ap.type === 'installation' || ap.type === 'inspection'
  const signature = (): Signature | undefined => (sig ? { name: sigName.trim() || 'הלקוח', dataUrl: sig, at: nowIso() } : undefined)
  const canFinish = (!needSig || (sig && sigName.trim())) && (ap.type !== 'service' || resolution.trim())

  const finish = () => {
    if (!canFinish) return
    const s = useApp.getState()
    const today = ymd()
    if (ap.type === 'installation') {
      completeInstallation(ap.id, signature()!, serials)
      s.patch('appointments', ap.id, { completedAt: nowIso() })
      toast.success(otherDays.length ? 'יום ההתקנה נסגר' : 'ההתקנה הסתיימה, היחידות נרשמו עם אחריות')
    } else if (ap.type === 'service') {
      if (ctx.call) {
        s.patch('serviceCalls', ctx.call.id, { status: outcome, resolution: resolution.trim(), charge, ...(outcome === 'done' ? { closedAt: nowIso() } : {}) })
        s.log({ kind: 'service', serviceCallId: ctx.call.id, customerId: ctx.call.customerId, text: outcome === 'done' ? `הקריאה ${ctx.call.number} טופלה: ${resolution.trim()}` : `הקריאה ${ctx.call.number} ממתינה לחלק: ${resolution.trim()}` })
        if (outcome === 'waiting_parts') s.db.users.filter((u) => u.role === 'office').forEach((u) => s.notify(u.id, `${ctx.call!.number} ממתינה לחלק — להזמין`, `/service/${ctx.call!.id}`))
      }
      s.patch('appointments', ap.id, { status: 'done', customerSignature: signature(), completedAt: nowIso() })
      toast.success(outcome === 'done' ? 'הקריאה נסגרה' : 'נרשם: ממתינה לחלק')
    } else if ((ap.type === 'maintenance' || ap.type === 'inspection') && ctx.contract) {
      const next = ymd(addMonths(today, ctx.contract.frequencyMonths))
      checkedUnits.forEach((id) => s.patch('units', id, { lastServiceAt: today, nextServiceAt: next }))
      s.patch('contracts', ctx.contract.id, { nextVisit: next })
      const notes = [ap.notes, findings.trim()].filter(Boolean).join('\n')
      s.patch('appointments', ap.id, { status: 'done', customerSignature: signature(), completedAt: nowIso(), notes: notes || undefined })
      s.log({ kind: 'appointment', customerId: ctx.contract.customerId, text: `${appointmentTypeLabel[ap.type]} בוצע (${checkedUnits.length} יחידות). הביקור הבא: ${fmtDate(next)}` })
      toast.success(`בוצע. הביקור הבא נקבע ל-${fmtDate(next)}`)
    } else {
      const notes = [ap.notes, findings.trim()].filter(Boolean).join('\n')
      s.patch('appointments', ap.id, { status: 'done', customerSignature: signature(), completedAt: nowIso(), notes: notes || undefined })
      if (ap.caseId) s.log({ kind: 'appointment', caseId: ap.caseId, text: `בוצע: ${ap.title}` })
      toast.success('המשימה סומנה כבוצעה')
    }
    onDone(ap.type)
  }

  return (
    <Card title={<div className="row" style={{ gap: 8 }}><ClipboardCheck size={17} className="muted" /><h2>סיום ומסירה</h2></div>}>
      <div className="card-body col" style={{ gap: 14 }}>
        {open > 0 && <Callout tone="warning">נשארו {open} שלבים פתוחים בצ׳קליסט.</Callout>}

        {ap.type === 'installation' && (
          otherDays.length ? (
            <Callout>זה לא היום האחרון של ההתקנה (נשארו עוד {otherDays.length}). היחידות והאחריות יירשמו בסיום היום האחרון.</Callout>
          ) : uLines.length ? (
            <div>
              <div className="label mb8">מספרים סידוריים (לא חובה)</div>
              <div className="grid g2" style={{ gap: 10 }}>
                {uLines.flatMap((l) =>
                  Array.from({ length: l.qty }, (_, i) => {
                    const k = `${l.id}-${i}`
                    return (
                      <Field key={k} label={<span className="tiny">{l.description.split('(')[0].trim()}{l.qty > 1 ? ` #${i + 1}` : ''}{l.room ? ` · ${l.room}` : ''}</span>}>
                        <input className="input ltr" style={{ textAlign: 'right' }} value={serials[k] ?? ''} onChange={(e) => setSerials((m) => ({ ...m, [k]: e.target.value }))} placeholder="מהמדבקה על היחידה" />
                      </Field>
                    )
                  }),
                )}
              </div>
              <div className="tiny muted mt8">יחידה בלי מספר תקבל מספר זמני, ואפשר לעדכן אחר כך.</div>
            </div>
          ) : null
        )}

        {ap.type === 'service' && (
          <>
            <Field label="מה נעשה">
              <textarea className="textarea" rows={3} value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="למשל: נוקה קו ניקוז, הוחלף קבל למנוע" />
            </Field>
            <div className="row wrap"><Dictate onText={(t) => setResolution((x) => (x ? `${x} ${t}` : t))} /></div>
            <div className="grid g2" style={{ gap: 10 }}>
              <Field label="חיוב (לפני מע״מ)" hint={ctx.call?.underWarranty ? 'הקריאה באחריות' : `ביקור טכנאי: ${money(visitPrice)}`}>
                <input className="input num" inputMode="numeric" value={charge} onChange={(e) => setCharge(Number(e.target.value.replace(/[^\d.]/g, '')) || 0)} />
              </Field>
              <Field label="סטטוס הקריאה">
                <div className="seg" style={{ height: 40, alignItems: 'center' }}>
                  <button type="button" className={outcome === 'done' ? 'on' : ''} onClick={() => setOutcome('done')}>טופלה</button>
                  <button type="button" className={outcome === 'waiting_parts' ? 'on' : ''} onClick={() => setOutcome('waiting_parts')}>ממתינה לחלק</button>
                </div>
              </Field>
            </div>
          </>
        )}

        {(ap.type === 'maintenance' || ap.type === 'inspection') && (
          ctx.contract ? (
            <div>
              <div className="label mb8">יחידות שטופלו</div>
              <div className="col" style={{ gap: 6 }}>
                {units.map((u) => (
                  <label key={u.id} className="check">
                    <input type="checkbox" checked={checkedUnits.includes(u.id)} onChange={(e) => setCheckedUnits((l) => (e.target.checked ? [...l, u.id] : l.filter((x) => x !== u.id)))} />
                    <span>{u.location ?? u.model} <span className="tiny muted ltr">{u.serial}</span></span>
                  </label>
                ))}
                {!units.length && <div className="small muted">לא משויכות יחידות לחוזה.</div>}
              </div>
              <div className="tiny muted mt8">הביקור הבא ייקבע אוטומטית בעוד {ctx.contract.frequencyMonths} חודשים ({fmtDate(ymd(addMonths(new Date(), ctx.contract.frequencyMonths)))}).</div>
            </div>
          ) : (
            <Callout>המשימה לא משויכת לחוזה, ולכן מועד הטיפול הבא לא יתעדכן.</Callout>
          )
        )}

        {ap.type !== 'service' && ap.type !== 'installation' && (
          <Field label={ap.type === 'inspection' ? 'ממצאים (יופיעו באישור)' : 'סיכום קצר'}>
            <textarea className="textarea" rows={2} value={findings} onChange={(e) => setFindings(e.target.value)} placeholder={ap.type === 'inspection' ? 'המערכת תקינה / ליקויים שנמצאו' : 'מה נעשה בביקור'} />
          </Field>
        )}

        {ap.type !== 'meeting' && (
          <div className="col" style={{ gap: 8 }}>
            <div className="label">חתימת הלקוח{needSig ? '' : ' (לא חובה)'}</div>
            <SignaturePad onChange={setSig} />
            <Field label="שם החותם">
              <input className="input" value={sigName} onChange={(e) => setSigName(e.target.value)} />
            </Field>
          </div>
        )}

        {ap.type === 'survey' && ap.caseId && <Callout>את המידות, החדרים והתמונות של הסקר ממלאים <Link to={`/cases/${ap.caseId}`}>בתיק</Link>.</Callout>}

        <button className="btn success lg block" disabled={!canFinish} onClick={finish}>
          <CheckCircle2 size={18} />
          {ap.type === 'installation' ? (otherDays.length ? 'סיום יום ההתקנה' : 'סיום ההתקנה ומסירה') : ap.type === 'service' ? 'סגירת הביקור' : ap.type === 'inspection' ? 'סיום הבדיקה והפקת אישור' : 'סימון כבוצע'}
        </button>
        {!canFinish && <div className="tiny muted" style={{ textAlign: 'center' }}>{needSig && !sig ? 'חסרה חתימת הלקוח' : ap.type === 'service' && !resolution.trim() ? 'כתבו מה נעשה' : 'חסר שם החותם'}</div>}
      </div>
    </Card>
  )
}

function DoneCard({ ap, db, onMessage, onCert }: { ap: Appointment; db: DB; onMessage: (m: { title: string; text: string; key: TemplateKey }) => void; onCert: () => void }) {
  const settings = useSettings()
  const ctx = jobContext(db, ap)
  const vars = messageVars(ctx, ap, { resolution: ctx.call?.resolution ? `${ctx.call.resolution}.` : '' })
  const doneMsg =
    ap.type === 'installation'
      ? { title: 'הודעת סיום התקנה', text: fill(templates.completed.text, vars), key: 'completed' as TemplateKey }
      : ap.type === 'service' && ctx.call
        ? { title: 'עדכון ללקוח', text: fill(serviceDoneText, vars), key: 'free' as TemplateKey }
        : { title: 'עדכון ללקוח', text: fill(visitDoneText, vars), key: 'free' as TemplateKey }
  return (
    <Card>
      <div className="card-body col" style={{ gap: 12 }}>
        <Callout tone="success" icon={<CheckCircle2 size={18} />}>
          <div className="strong">המשימה הושלמה{ap.completedAt ? ` · ${dateTime(ap.completedAt)}` : ''}</div>
          {ctx.call && <div>{ctx.call.status === 'waiting_parts' ? 'הקריאה ממתינה לחלק' : ctx.call.resolution}</div>}
        </Callout>
        {ap.customerSignature && (
          <div className="sig-view">
            <img src={ap.customerSignature.dataUrl} alt="חתימת הלקוח" />
            <span className="tiny muted">חתם/ה: {ap.customerSignature.name} · {dateTime(ap.customerSignature.at)}</span>
          </div>
        )}
        {ctx.phone && (
          <div className="row wrap">
            <button className="btn wa" onClick={() => onMessage(doneMsg)}><MessageCircle size={16} /> {ap.type === 'installation' ? 'הודעת סיום ללקוח' : 'עדכון ללקוח'}</button>
            {settings.reviewUrl && <button className="btn" onClick={() => onMessage({ title: 'בקשת חוות דעת', text: fill(templates.review.text, vars), key: 'review' })}><Star size={16} /> בקשת חוות דעת</button>}
          </div>
        )}
        {ap.type === 'inspection' && <button className="btn dark" onClick={onCert}><FileBadge size={16} /> אישור בדיקה שנתי</button>}
      </div>
    </Card>
  )
}

// ---------- אישור בדיקה שנתי (להדפסה) ----------
function CertModal({ ap, db, onClose }: { ap: Appointment; db: DB; onClose: () => void }) {
  useEffect(() => {
    document.body.classList.add('print-cert')
    return () => document.body.classList.remove('print-cert')
  }, [])
  const sheet = <CertSheet ap={ap} db={db} />
  return (
    <>
      <Modal
        title="אישור בדיקה שנתי"
        size="wide"
        onClose={onClose}
        footer={
          <>
            <button className="btn" onClick={onClose}>סגירה</button>
            <button className="btn primary" onClick={() => window.print()}><Printer size={16} /> הדפסה / שמירה כ-PDF</button>
          </>
        }
      >
        <div className="cert-preview">{sheet}</div>
      </Modal>
      {createPortal(<div className="cert-print">{sheet}</div>, document.body)}
    </>
  )
}

function CertSheet({ ap, db }: { ap: Appointment; db: DB }) {
  const ctx = jobContext(db, ap)
  const units = contractUnits(db, ctx.contract)
  const on = ap.completedAt ?? ap.start
  const valid = ymd(addMonths(on, 12))
  const allOk = ap.checklist.length > 0 && ap.checklist.every((c) => c.done)
  const result = !ap.checklist.length ? 'נבדק' : allOk ? 'תקין' : 'ראו ממצאים'
  const certNo = `${ctx.contract?.number ?? 'INS'}-${new Date(on).getFullYear()}`
  return (
    <div className="cert-sheet">
      <div className="cert-top">
        <div className="cert-brand"><Wordmark /></div>
        <div className="tiny" style={{ textAlign: 'end', lineHeight: 1.6 }}>
          {brand.name} · {brand.address}<br />
          {brand.phone} · {brand.email}<br />
          {brand.website.replace('https://', '')}
        </div>
      </div>
      <h2 className="cert-title">אישור בדיקה שנתי — מערכת שחרור עשן</h2>
      <div className="cert-no">מס׳ אישור <span className="ltr">{certNo}</span></div>
      <table className="cert-kv">
        <tbody>
          <tr><th>לקוח</th><td>{ctx.customer?.name}</td><th>תאריך הבדיקה</th><td>{fmtDate(on)}</td></tr>
          <tr><th>כתובת</th><td>{addressLine(ctx.address)}</td><th>בתוקף עד</th><td>{fmtDate(valid)}</td></tr>
          <tr><th>חוזה</th><td>{ctx.contract ? `${ctx.contract.number} · ${ctx.contract.title}` : '—'}</td><th>בודק</th><td>{ctx.team.map((u) => u.name).join(', ')}</td></tr>
        </tbody>
      </table>

      <h3 className="cert-h3">רכיבים שנבדקו</h3>
      <table className="cert-table">
        <thead><tr><th>מיקום</th><th>רכיב</th><th>מס׳ סידורי</th><th>תוצאה</th></tr></thead>
        <tbody>
          {units.length ? units.map((u) => (
            <tr key={u.id}><td>{u.location ?? '—'}</td><td>{u.model}</td><td><span className="ltr">{u.serial}</span></td><td>{result}</td></tr>
          )) : <tr><td colSpan={4}>—</td></tr>}
        </tbody>
      </table>

      {ap.checklist.length > 0 && (
        <>
          <h3 className="cert-h3">בדיקות שבוצעו</h3>
          <ul className="cert-checks">
            {ap.checklist.map((c) => <li key={c.id} className={c.done ? 'ok' : 'no'}>{c.done ? '✓' : '✗'} {c.text}</li>)}
          </ul>
        </>
      )}

      <h3 className="cert-h3">ממצאים</h3>
      <p className="cert-notes">{ap.notes?.trim() || (allOk || !ap.checklist.length ? 'המערכת נבדקה ונמצאה תקינה במועד הבדיקה.' : 'לא כל הבדיקות הושלמו.')}</p>

      <div className="cert-sigs">
        <div>
          <div className="cert-line">{ctx.team.map((u) => u.name).join(', ')}</div>
          <div className="tiny">הבודק מטעם {brand.name}</div>
        </div>
        <div>
          <div className="cert-line">{ap.customerSignature ? <img src={ap.customerSignature.dataUrl} alt="" /> : null}</div>
          <div className="tiny">נציג הלקוח{ap.customerSignature ? `: ${ap.customerSignature.name}` : ''}</div>
        </div>
      </div>
      <div className="cert-foot tiny">האישור מתייחס לרכיבים שנבדקו ולמצבם במועד הבדיקה. יש לבצע בדיקה חוזרת עד {fmtDate(valid)}.</div>
    </div>
  )
}
