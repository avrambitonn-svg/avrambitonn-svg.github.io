// כרטיס הלקוח בתיק: פרטים, סנכרון ל-Priority, משלם, אנשי קשר (כוכב = ראשי) ופעולות מהירות. תיק בלי לקוח: שיוך לקוח
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { MoreHorizontal, Plus, Repeat, Search, Star, UserMinus, UserPlus, X } from 'lucide-react'
import { useApp } from '../../lib/store'
import { Badge, Callout, Card, Confirm, Field, Modal, toast } from '../../components/ui'
import { QuickContact } from '../../components/extras'
import { customerTypeLabel, syncLabel, syncTone } from '../../lib/labels'
import { nowIso, phone, uid } from '../../lib/format'
import { createCustomer } from '../../lib/actions'
import { addressText } from '../../lib/integrations/links'
import type { Address, Contact, CustomerType, ID } from '../../lib/types'
import '../ops/ops.css'
import './case.css'

export function CaseCustomerCard({ caseId, onWhatsapp }: { caseId: ID; onWhatsapp: () => void }) {
  const k = useApp((s) => s.db.cases.find((x) => x.id === caseId))
  const customers = useApp((s) => s.db.customers)
  const allContacts = useApp((s) => s.db.contacts)
  const patch = useApp((s) => s.patch)
  const log = useApp((s) => s.log)
  const [assign, setAssign] = useState<'assign' | 'replace' | null>(null)
  const [removeOpen, setRemoveOpen] = useState(false)
  const [addContact, setAddContact] = useState(false)
  const [menu, setMenu] = useState(false)
  const contacts = useMemo(() => (k ? allContacts.filter((x) => k.contactIds.includes(x.id)) : []), [allContacts, k])
  if (!k) return null
  const c = customers.find((x) => x.id === k.customerId)
  const payer = customers.find((x) => x.id === k.payerCustomerId)
  const addr = c?.addresses.find((a) => a.id === k.addressId) ?? c?.addresses[0]
  const primary = contacts.find((x) => x.primary) ?? contacts[0]

  const setPrimary = (ct: Contact) => {
    allContacts.filter((x) => x.customerId === ct.customerId && x.primary && x.id !== ct.id).forEach((x) => patch('contacts', x.id, { primary: false }))
    patch('contacts', ct.id, { primary: true })
    toast.success(`${ct.name} הוא איש הקשר הראשי`)
  }
  const detach = (ct: Contact) => patch('cases', k.id, { contactIds: k.contactIds.filter((x) => x !== ct.id), updatedAt: nowIso() })
  const removeCustomer = () => {
    patch('cases', k.id, { customerId: '', addressId: '', contactIds: [], payerCustomerId: undefined, updatedAt: nowIso() })
    log({ kind: 'note', caseId: k.id, text: `הלקוח ${c?.name ?? ''} הוסר מהתיק` })
    toast.info('הלקוח הוסר מהתיק')
  }

  if (!c) {
    return (
      <Card title="לקוח" pad>
        <div className="col" style={{ gap: 10 }}>
          <Callout tone="warning">התיק עדיין לא משויך ללקוח. בלי לקוח אי אפשר לשלוח הודעות, הצעת מחיר או קישור לאזור האישי.</Callout>
          <button className="btn primary" onClick={() => setAssign('assign')}><UserPlus size={16} /> שיוך לקוח</button>
        </div>
        {assign && <AssignDialog caseId={k.id} mode="assign" onClose={() => setAssign(null)} />}
      </Card>
    )
  }

  return (
    <Card
      title="לקוח"
      actions={
        <div className="cc-menu">
          <button className="icon-btn sm" onClick={() => setMenu((m) => !m)} aria-label="פעולות לקוח" aria-expanded={menu}><MoreHorizontal size={17} /></button>
          {menu && (
            <div className="cc-pop" onMouseLeave={() => setMenu(false)}>
              <button onClick={() => { setMenu(false); setAssign('replace') }}><Repeat size={15} /> החלפת לקוח</button>
              <button className="danger" onClick={() => { setMenu(false); setRemoveOpen(true) }}><UserMinus size={15} /> הסרת לקוח</button>
            </div>
          )}
        </div>
      }
      pad
    >
      <Link to={`/customers/${c.id}`} className="strong">{c.name}</Link>
      <div className="small muted">{customerTypeLabel[c.type]} · <span className="ltr">{phone(c.phone)}</span></div>
      <div className="row wrap mt8" style={{ gap: 6 }}>
        <Badge tone={syncTone[c.sync.status]}>{syncLabel[c.sync.status]} ב-Priority</Badge>
        {c.temp && <Badge tone="warning">לקוח זמני</Badge>}
      </div>
      {payer && <div className="small mt8">משלם: <Link to={`/customers/${payer.id}`}>{payer.name}</Link></div>}
      <div className="mt12"><QuickContact phone={primary?.phone ?? c.phone} address={addr} whatsapp={onWhatsapp} /></div>

      <div className="row between mt16">
        <span className="label">אנשי קשר</span>
        <button className="btn sm ghost" onClick={() => setAddContact(true)}><Plus size={14} /> איש קשר</button>
      </div>
      <div className="col mt8" style={{ gap: 4 }}>
        {contacts.length === 0 && <div className="small muted">אין אנשי קשר בתיק</div>}
        {contacts.map((x) => (
          <div key={x.id} className="cc-contact">
            <button className={`cc-star ${x.primary ? 'on' : ''}`} onClick={() => !x.primary && setPrimary(x)} aria-label={x.primary ? 'איש קשר ראשי' : 'סימון כראשי'} title={x.primary ? 'איש קשר ראשי' : 'סימון כראשי'}>
              <Star size={15} fill={x.primary ? 'currentColor' : 'none'} />
            </button>
            <span className="grow small" style={{ minWidth: 0 }}>
              <span className="strong">{x.name}</span>{x.role ? <span className="muted"> · {x.role}</span> : null}
              <span className="muted"> · </span><a className="ltr cc-phone" href={`tel:${x.phone.replace(/[^\d+]/g, '')}`}>{phone(x.phone)}</a>
            </span>
            <button className="icon-btn sm" onClick={() => detach(x)} aria-label="הסרה מהתיק" title="הסרה מהתיק"><X size={14} /></button>
          </div>
        ))}
      </div>
      {addr?.entryNotes && <div className="small muted mt8">כניסה: {addr.entryNotes}</div>}

      {assign && <AssignDialog caseId={k.id} mode={assign} onClose={() => setAssign(null)} />}
      {addContact && <ContactDialog caseId={k.id} customerId={c.id} onClose={() => setAddContact(false)} />}
      {removeOpen && <Confirm title="הסרת לקוח מהתיק" text={`להסיר את ${c.name} מהתיק? הלקוח עצמו לא נמחק, ואפשר לשייך לקוח אחר.`} confirmLabel="הסרה" danger onConfirm={removeCustomer} onClose={() => setRemoveOpen(false)} />}
    </Card>
  )
}

// שיוך (או החלפה): חיפוש לקוח קיים, או לקוח חדש
function AssignDialog({ caseId, mode, onClose }: { caseId: ID; mode: 'assign' | 'replace'; onClose: () => void }) {
  const customers = useApp((s) => s.db.customers)
  const contacts = useApp((s) => s.db.contacts)
  const cases = useApp((s) => s.db.cases)
  const k = cases.find((x) => x.id === caseId)
  const patch = useApp((s) => s.patch)
  const upsert = useApp((s) => s.upsert)
  const log = useApp((s) => s.log)
  const [q, setQ] = useState('')
  const [pick, setPick] = useState<string>('')
  const [addrId, setAddrId] = useState('')
  const [isNew, setIsNew] = useState(false)
  const [nc, setNc] = useState({ name: '', phone: '', email: '', idNumber: '', type: 'private' as CustomerType, city: 'ירושלים', street: '', number: '' })
  const results = useMemo(() => {
    const t = q.trim()
    if (t.length < 2) return customers.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5)
    const d = t.replace(/\D/g, '')
    return customers.filter((c) => c.name.includes(t) || (d.length >= 3 && c.phone.replace(/\D/g, '').includes(d))).slice(0, 8)
  }, [q, customers])
  const chosen = customers.find((c) => c.id === pick)
  const dup = isNew && nc.phone.replace(/\D/g, '').length >= 9 ? customers.find((c) => c.phone.replace(/\D/g, '') === nc.phone.replace(/\D/g, '')) : undefined
  const ok = isNew ? nc.name.trim() && nc.phone.replace(/\D/g, '').length >= 9 : !!chosen
  if (!k) return null

  const save = () => {
    let custId = pick
    let addressId = addrId
    let ids: ID[]
    if (isNew) {
      const address: Address | undefined = nc.street.trim() ? { id: uid('ad'), city: nc.city.trim(), street: nc.street.trim(), number: nc.number.trim() } : undefined
      const c = createCustomer({ name: nc.name.trim(), phone: nc.phone, email: nc.email || undefined, idNumber: nc.idNumber || undefined, type: nc.type, addresses: address ? [address] : [] })
      const ct: Contact = { id: uid('ct'), customerId: c.id, name: nc.name.trim(), phone: nc.phone, email: nc.email || undefined, primary: true }
      upsert('contacts', ct)
      custId = c.id
      addressId = address?.id ?? ''
      ids = [ct.id]
    } else {
      addressId = addrId || chosen?.addresses[0]?.id || ''
      ids = contacts.filter((x) => x.customerId === custId && x.primary).map((x) => x.id)
    }
    const name = isNew ? nc.name.trim() : chosen?.name
    patch('cases', caseId, { customerId: custId, addressId, contactIds: ids, updatedAt: nowIso() })
    log({ kind: 'note', caseId, customerId: custId, text: mode === 'replace' ? `הלקוח בתיק הוחלף ל${name}` : `התיק שויך ללקוח ${name}` })
    toast.success(mode === 'replace' ? 'הלקוח הוחלף' : 'הלקוח שויך לתיק')
    onClose()
  }

  return (
    <Modal title={mode === 'replace' ? 'החלפת לקוח' : 'שיוך לקוח לתיק'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>ביטול</button><button className="btn primary" disabled={!ok} onClick={save}>{isNew ? 'יצירה ושיוך' : 'שיוך'}</button></>}>
      <div className="col" style={{ gap: 12 }}>
        {mode === 'replace' && <Callout tone="warning">אנשי הקשר של הלקוח הקודם יוסרו מהתיק. ההצעות וההיסטוריה נשארות.</Callout>}
        <div className="seg" role="tablist">
          <button className={!isNew ? 'on' : ''} onClick={() => setIsNew(false)}><Search size={14} /> לקוח קיים</button>
          <button className={isNew ? 'on' : ''} onClick={() => setIsNew(true)}><UserPlus size={14} /> לקוח חדש</button>
        </div>
        {!isNew ? (
          <>
            <div className="search-box">
              <Search size={16} className="muted" />
              <input className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש לפי שם או טלפון" aria-label="חיפוש לקוח" />
            </div>
            <div className="col" style={{ gap: 6 }}>
              {results.filter((c) => c.id !== k.customerId).map((c) => (
                <button key={c.id} className={`cc-result ${pick === c.id ? 'on' : ''}`} onClick={() => { setPick(c.id); setAddrId(c.addresses[0]?.id ?? '') }}>
                  <span className="grow" style={{ textAlign: 'start' }}>
                    <span className="small strong" style={{ display: 'block' }}>{c.name}</span>
                    <span className="tiny muted"><span className="ltr">{phone(c.phone)}</span> · {customerTypeLabel[c.type]}{c.addresses[0] ? ` · ${addressText(c.addresses[0])}` : ''}</span>
                  </span>
                  {c.temp && <Badge tone="warning">זמני</Badge>}
                </button>
              ))}
              {results.length === 0 && <div className="small muted">לא נמצא. אפשר ליצור לקוח חדש.</div>}
            </div>
            {chosen && chosen.addresses.length > 1 && (
              <Field label="כתובת הפרויקט">
                <select className="select" value={addrId} onChange={(e) => setAddrId(e.target.value)}>
                  {chosen.addresses.map((a) => <option key={a.id} value={a.id}>{addressText(a)}{a.label ? ` (${a.label})` : ''}</option>)}
                </select>
              </Field>
            )}
          </>
        ) : (
          <>
            <div className="grid g2">
              <Field label="שם *"><input className="input" autoFocus value={nc.name} onChange={(e) => setNc({ ...nc, name: e.target.value })} /></Field>
              <Field label="טלפון *"><input className="input ltr" inputMode="tel" value={nc.phone} onChange={(e) => setNc({ ...nc, phone: e.target.value })} /></Field>
              <Field label="אימייל"><input className="input ltr" value={nc.email} onChange={(e) => setNc({ ...nc, email: e.target.value })} /></Field>
              <Field label="ת״ז / ח״פ"><input className="input" value={nc.idNumber} onChange={(e) => setNc({ ...nc, idNumber: e.target.value })} /></Field>
              <Field label="עיר"><input className="input" value={nc.city} onChange={(e) => setNc({ ...nc, city: e.target.value })} /></Field>
              <div className="row" style={{ alignItems: 'flex-end' }}>
                <Field label="רחוב" className="grow"><input className="input" value={nc.street} onChange={(e) => setNc({ ...nc, street: e.target.value })} /></Field>
                <Field label="מס׳"><input className="input" style={{ width: 70 }} value={nc.number} onChange={(e) => setNc({ ...nc, number: e.target.value })} /></Field>
              </div>
            </div>
            <div className="row wrap">
              {(Object.keys(customerTypeLabel) as CustomerType[]).map((t) => <button key={t} className={`chip ${nc.type === t ? 'on' : ''}`} onClick={() => setNc({ ...nc, type: t })}>{customerTypeLabel[t]}</button>)}
            </div>
            {dup && <Callout tone="warning">כבר יש לקוח עם הטלפון הזה: <b>{dup.name}</b>. <button className="btn sm" onClick={() => { setIsNew(false); setPick(dup.id); setAddrId(dup.addresses[0]?.id ?? '') }}>לבחור בו</button></Callout>}
          </>
        )}
      </div>
    </Modal>
  )
}

function ContactDialog({ caseId, customerId, onClose }: { caseId: ID; customerId: ID; onClose: () => void }) {
  const k = useApp((s) => s.db.cases.find((x) => x.id === caseId))
  const all = useApp((s) => s.db.contacts)
  const upsert = useApp((s) => s.upsert)
  const patch = useApp((s) => s.patch)
  const [f, setF] = useState({ name: '', phone: '', role: '', email: '', primary: false })
  const others = useMemo(() => all.filter((x) => x.customerId === customerId && !k?.contactIds.includes(x.id)), [all, customerId, k])
  if (!k) return null
  const attach = (id: ID) => patch('cases', caseId, { contactIds: [...k.contactIds, id], updatedAt: nowIso() })
  const ok = f.name.trim() && f.phone.replace(/\D/g, '').length >= 9
  const save = () => {
    const ct: Contact = { id: uid('ct'), customerId, name: f.name.trim(), phone: f.phone, role: f.role.trim() || undefined, email: f.email.trim() || undefined, primary: f.primary, fromCaseId: caseId }
    if (f.primary) all.filter((x) => x.customerId === customerId && x.primary).forEach((x) => patch('contacts', x.id, { primary: false }))
    upsert('contacts', ct)
    attach(ct.id)
    toast.success('איש הקשר נוסף')
    onClose()
  }
  return (
    <Modal title="איש קשר לתיק" size="narrow" onClose={onClose} footer={<><button className="btn" onClick={onClose}>סגירה</button><button className="btn primary" disabled={!ok} onClick={save}>הוספה</button></>}>
      <div className="col" style={{ gap: 12 }}>
        {others.length > 0 && (
          <div className="col" style={{ gap: 6 }}>
            <span className="label">אנשי קשר של הלקוח</span>
            {others.map((x) => (
              <div key={x.id} className="cc-contact">
                <span className="grow small"><span className="strong">{x.name}</span>{x.role ? ` · ${x.role}` : ''} · <span className="ltr">{phone(x.phone)}</span></span>
                <button className="btn sm" onClick={() => { attach(x.id); toast.success(`${x.name} נוסף לתיק`) }}><Plus size={14} /> לתיק</button>
              </div>
            ))}
            <hr className="hr" style={{ margin: '4px 0' }} />
          </div>
        )}
        <Field label="שם *"><input className="input" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="אדריכל, מנהל עבודה, בן משפחה..." /></Field>
        <div className="grid g2" style={{ gap: 10 }}>
          <Field label="טלפון *"><input className="input ltr" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="תפקיד"><input className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} /></Field>
        </div>
        <Field label="אימייל"><input className="input ltr" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <label className="check small"><input type="checkbox" checked={f.primary} onChange={(e) => setF({ ...f, primary: e.target.checked })} /> איש הקשר הראשי</label>
      </div>
    </Modal>
  )
}
