import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarPlus, CheckCircle2, Search, ShieldCheck, ShieldOff, UserPlus, X } from 'lucide-react'
import { Callout, Field, Modal, toast } from '../../components/ui'
import { Dictate } from '../../components/extras'
import { app, useApp } from '../../lib/store'
import { createCustomer } from '../../lib/actions'
import type { Contract, CustomerType, ID, LeadSource, ServiceCall } from '../../lib/types'
import { customerTypeLabel, sourceLabel } from '../../lib/labels'
import { date as fmtDate, nowIso, phone as fmtPhone, uid } from '../../lib/format'
import { addressText } from '../../lib/integrations/links'
import { fill, templates } from '../../lib/messaging'
import { ScheduleDialog } from '../schedule/ScheduleDialog'
import { MessageBox } from './MessageBox'
import { firstName, symptomLabel, urgencyLabel, warrantyOf, type Symptom } from './ops'
import './ops.css'

const symptoms = Object.keys(symptomLabel) as Symptom[]
const urgencies: ServiceCall['urgency'][] = ['low', 'normal', 'high', 'urgent']

export function NewServiceCallDialog({ customerId: c0, unitId: u0, onClose, onCreated }: { customerId?: ID; unitId?: ID; onClose: () => void; onCreated?: (id: ID) => void }) {
  const db = useApp((s) => s.db)
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [custId, setCustId] = useState(c0 ?? '')
  const [isNew, setIsNew] = useState(false)
  const [nc, setNc] = useState({ name: '', phone: '', type: 'private' as CustomerType, city: 'ירושלים', street: '', number: '' })
  const customer = db.customers.find((c) => c.id === custId)
  const [addressId, setAddressId] = useState(customer?.addresses[0]?.id ?? '')
  const [unitId, setUnitId] = useState(u0 ?? '')
  const [symptom, setSymptom] = useState<Symptom>('not_cooling')
  const [errorCode, setErrorCode] = useState('')
  const [desc, setDesc] = useState('')
  const [urgency, setUrgency] = useState<ServiceCall['urgency']>('normal')
  const [source, setSource] = useState<LeadSource>('phone')
  const [assigneeId, setAssigneeId] = useState('')
  const [warrantyOverride, setWarrantyOverride] = useState<boolean | null>(null)
  const [created, setCreated] = useState<ServiceCall | null>(null)
  const [schedule, setSchedule] = useState(false)

  const results = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return []
    const digits = t.replace(/\D/g, '')
    return db.customers
      .filter((c) => c.name.toLowerCase().includes(t) || (digits.length >= 3 && c.phone.replace(/\D/g, '').includes(digits)) || c.addresses.some((a) => addressText(a).includes(t)))
      .slice(0, 6)
  }, [q, db.customers])

  const units = useMemo(() => db.units.filter((u) => u.customerId === custId && (!addressId || !u.addressId || u.addressId === addressId)), [db.units, custId, addressId])
  const unit = db.units.find((u) => u.id === unitId)
  const w = warrantyOf(unit)
  const underWarranty = warrantyOverride ?? w.under
  const contract: Contract | undefined = useMemo(() => {
    const live = db.contracts.filter((c) => c.customerId === custId && (c.status === 'active' || c.status === 'expiring'))
    return (unitId && live.find((c) => c.unitIds.includes(unitId))) || live.find((c) => !c.unitIds.length) || (unitId ? undefined : live[0])
  }, [db.contracts, custId, unitId])
  const techs = db.users.filter((u) => u.active && u.role === 'installer')

  const pickCustomer = (id: ID) => {
    const c = db.customers.find((x) => x.id === id)
    setCustId(id)
    setAddressId(c?.addresses[0]?.id ?? '')
    setUnitId('')
    setWarrantyOverride(null)
    setQ('')
    setIsNew(false)
  }

  const valid = (custId || (isNew && nc.name.trim() && nc.phone.replace(/\D/g, '').length >= 9)) && (desc.trim() || symptom)

  const submit = () => {
    if (!valid) return
    const s = app()
    let cust = customer
    if (!cust) {
      cust = createCustomer({
        name: nc.name.trim(), type: nc.type, phone: nc.phone.trim(), tags: [],
        addresses: [{ id: uid('ad'), city: nc.city.trim(), street: nc.street.trim(), number: nc.number.trim() || undefined }],
      })
    }
    const description = desc.trim() || `${symptomLabel[symptom]}${errorCode ? ` (קוד ${errorCode})` : ''}`
    const call: ServiceCall = {
      id: uid('sc'),
      number: s.nextNumber('service', 'SC-', 4),
      customerId: cust.id,
      addressId: addressId || cust.addresses[0]?.id,
      unitId: unitId || undefined,
      contractId: contract?.id,
      description,
      symptom,
      errorCode: errorCode.trim() || undefined,
      urgency,
      status: assigneeId ? 'assigned' : 'new',
      assigneeId: assigneeId || undefined,
      underWarranty,
      source,
      createdAt: nowIso(),
    }
    s.upsert('serviceCalls', call)
    s.log({ kind: 'service', serviceCallId: call.id, customerId: cust.id, text: `נפתחה קריאת שירות ${call.number}: ${description}` })
    if (assigneeId && assigneeId !== s.currentUserId) s.notify(assigneeId, `קריאה חדשה שובצה לך: ${call.number}`, `/service/${call.id}`)
    s.db.users.filter((u) => (u.role === 'office' || u.role === 'admin') && u.id !== s.currentUserId).forEach((u) => s.notify(u.id, `קריאת שירות חדשה ${call.number}${urgency === 'urgent' ? ' (דחופה)' : ''}: ${cust!.name}`, `/service/${call.id}`))
    toast.success(`הקריאה ${call.number} נפתחה`)
    onCreated?.(call.id)
    setCreated(call)
  }

  if (created && schedule) return <ScheduleDialog type="service" serviceCallId={created.id} onClose={onClose} />

  if (created) {
    const c = useApp.getState().db.customers.find((x) => x.id === created.customerId)
    const contact = db.contacts.find((x) => x.customerId === created.customerId && x.primary)
    const text = fill(templates.service_received.text, { name: contact ? firstName(contact.name) : c?.name, number: created.number })
    return (
      <Modal
        title="הקריאה נפתחה"
        onClose={onClose}
        footer={
          <>
            <button className="btn" onClick={() => { onClose(); nav(`/service/${created.id}`) }}>לכרטיס הקריאה</button>
            <button className="btn primary" onClick={() => setSchedule(true)}><CalendarPlus size={16} /> שיבוץ טכנאי</button>
          </>
        }
      >
        <div className="col">
          <Callout tone="success" icon={<CheckCircle2 size={18} />}>
            <div className="strong">{created.number} · {c?.name}</div>
            <div>{created.description}{created.underWarranty ? ' · באחריות' : ''}</div>
          </Callout>
          <div className="card flat card-body">
            <div className="strong mb8">אישור קבלה ללקוח</div>
            <MessageBox to={contact?.phone ?? c?.phone} text={text} templateKey="service_received" serviceCallId={created.id} customerId={created.customerId} />
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      title="קריאת שירות חדשה"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>ביטול</button>
          <button className="btn primary" disabled={!valid} onClick={submit}>פתיחת הקריאה</button>
        </>
      }
    >
      <div className="col" style={{ gap: 14 }}>
        {/* לקוח */}
        {customer ? (
          <div className="picked">
            <div className="grow">
              <div className="strong">{customer.name}</div>
              <div className="tiny muted"><span className="ltr">{fmtPhone(customer.phone)}</span> · {customerTypeLabel[customer.type]}</div>
            </div>
            {!c0 && <button className="btn sm ghost" onClick={() => { setCustId(''); setUnitId('') }}><X size={14} /> החלפה</button>}
          </div>
        ) : isNew ? (
          <div className="side-box col" style={{ gap: 10 }}>
            <div className="row between"><span className="strong small">לקוח חדש</span><button className="btn sm ghost" onClick={() => setIsNew(false)}>חיפוש לקוח קיים</button></div>
            <div className="grid g2" style={{ gap: 10 }}>
              <Field label="שם"><input className="input" value={nc.name} onChange={(e) => setNc({ ...nc, name: e.target.value })} autoFocus /></Field>
              <Field label="טלפון"><input className="input ltr" style={{ textAlign: 'right' }} inputMode="tel" value={nc.phone} onChange={(e) => setNc({ ...nc, phone: e.target.value })} /></Field>
              <Field label="עיר"><input className="input" value={nc.city} onChange={(e) => setNc({ ...nc, city: e.target.value })} /></Field>
              <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) 80px', gap: 8 }}>
                <Field label="רחוב"><input className="input" value={nc.street} onChange={(e) => setNc({ ...nc, street: e.target.value })} /></Field>
                <Field label="מס׳"><input className="input" value={nc.number} onChange={(e) => setNc({ ...nc, number: e.target.value })} /></Field>
              </div>
            </div>
            <div className="row wrap" style={{ gap: 6 }}>
              {(Object.keys(customerTypeLabel) as CustomerType[]).map((t) => (
                <button key={t} type="button" className={`chip ${nc.type === t ? 'on' : ''}`} onClick={() => setNc({ ...nc, type: t })}>{customerTypeLabel[t]}</button>
              ))}
            </div>
            <div className="tiny muted">הלקוח יישמר כלקוח זמני עד שייפתח ב-Priority.</div>
          </div>
        ) : (
          <div className="col" style={{ gap: 6 }}>
            <Field label="לקוח">
              <div className="search-box">
                <Search size={16} className="muted" />
                <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="שם, טלפון או כתובת" autoFocus />
              </div>
            </Field>
            {results.length > 0 && (
              <div className="pick-results">
                {results.map((c) => (
                  <button key={c.id} type="button" className="list-item click" onClick={() => pickCustomer(c.id)}>
                    <span className="grow" style={{ textAlign: 'start' }}>
                      <span className="strong" style={{ display: 'block' }}>{c.name}</span>
                      <span className="tiny muted"><span className="ltr">{fmtPhone(c.phone)}</span>{c.addresses[0] ? ` · ${addressText(c.addresses[0])}` : ''}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
            {q.trim() && !results.length && <div className="small muted">לא נמצא לקוח כזה.</div>}
            <button type="button" className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => { setIsNew(true); setNc((x) => ({ ...x, name: /\d/.test(q) ? '' : q, phone: /\d/.test(q) ? q : '' })) }}>
              <UserPlus size={15} /> לקוח חדש
            </button>
          </div>
        )}

        {customer && (
          <div className="grid g2" style={{ gap: 10 }}>
            {customer.addresses.length > 1 ? (
              <Field label="כתובת">
                <select className="select" value={addressId} onChange={(e) => { setAddressId(e.target.value); setUnitId('') }}>
                  {customer.addresses.map((a) => <option key={a.id} value={a.id}>{a.label ? `${a.label} — ` : ''}{addressText(a)}</option>)}
                </select>
              </Field>
            ) : (
              <Field label="כתובת"><div className="input" style={{ display: 'flex', alignItems: 'center', background: 'var(--surface-2)' }}>{addressText(customer.addresses[0]) || '—'}</div></Field>
            )}
            <Field label="יחידה" hint={units.length ? undefined : 'אין יחידות רשומות ללקוח'}>
              <select className="select" value={unitId} onChange={(e) => { setUnitId(e.target.value); setWarrantyOverride(null) }} disabled={!units.length}>
                <option value="">לא ידוע / אחר</option>
                {units.map((u) => <option key={u.id} value={u.id}>{u.location ? `${u.location} · ` : ''}{u.model}</option>)}
              </select>
            </Field>
          </div>
        )}

        {customer && (
          <div className={`warranty ${unit ? (w.under ? 'ok' : 'off') : ''}`}>
            {unit ? (w.under ? <ShieldCheck size={18} /> : <ShieldOff size={18} />) : <ShieldOff size={18} />}
            <div className="grow small">
              {unit ? (w.under ? <><b>באחריות</b> עד {fmtDate(w.until)}</> : <><b>האחריות הסתיימה</b> ב-{fmtDate(w.until)}</>) : 'בחרו יחידה כדי לבדוק אחריות'}
              {contract && <div className="tiny muted">חוזה {contract.number}: {contract.title}</div>}
            </div>
            <label className="check small">
              <input type="checkbox" checked={underWarranty} onChange={(e) => setWarrantyOverride(e.target.checked)} /> באחריות
            </label>
          </div>
        )}

        <div>
          <div className="label mb8">מה התקלה</div>
          <div className="row wrap" style={{ gap: 6 }}>
            {symptoms.map((s) => (
              <button key={s} type="button" className={`chip ${symptom === s ? 'on' : ''}`} onClick={() => setSymptom(s)}>{symptomLabel[s]}</button>
            ))}
          </div>
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) 130px', gap: 10 }}>
          <Field label="תיאור">
            <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={`למשל: ${symptom === 'leak' ? 'מטפטף מים על הקיר בסלון' : symptom === 'noise' ? 'רעש חזק מהיחידה החיצונית' : 'המזגן בחדר השינה לא מקרר'}`} />
          </Field>
          <Field label="קוד תקלה"><input className="input ltr" style={{ textAlign: 'right' }} value={errorCode} onChange={(e) => setErrorCode(e.target.value.toUpperCase())} placeholder="E4" /></Field>
        </div>
        <div className="row wrap"><Dictate onText={(t) => setDesc((x) => (x ? `${x} ${t}` : t))} label="הכתבת תיאור" /></div>

        <div>
          <div className="label mb8">דחיפות</div>
          <div className="seg seg-fill">
            {urgencies.map((u) => <button key={u} type="button" className={`${urgency === u ? 'on' : ''} u-${u}`} onClick={() => setUrgency(u)}>{urgencyLabel[u]}</button>)}
          </div>
        </div>
        <div className="grid g2" style={{ gap: 10 }}>
          <Field label="איך הגיעה">
            <select className="select" value={source} onChange={(e) => setSource(e.target.value as LeadSource)}>
              {(Object.keys(sourceLabel) as LeadSource[]).map((s) => <option key={s} value={s}>{sourceLabel[s]}</option>)}
            </select>
          </Field>
          <Field label="טכנאי">
            <select className="select" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">עדיין לא</option>
              {techs.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
        </div>
      </div>
    </Modal>
  )
}
