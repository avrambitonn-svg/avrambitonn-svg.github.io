// אשף פתיחת תיק: לקוח (או בלי לקוח), פרטי פרויקט, צוות, סיכום. מתחת לשלבים: תקציר של מה שכבר נבחר
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, Loader2, MapPin, Plus, Search, UserPlus, UserX } from 'lucide-react'
import { useApp, useMe } from '../../lib/store'
import { Badge, Callout, Card, Field, PageHead } from '../../components/ui'
import { Dictate } from '../../components/extras'
import { customerTypeLabel, roleLabel, sourceLabel } from '../../lib/labels'
import { phone as fmtPhone, uid } from '../../lib/format'
import { createCase, createCustomer } from '../../lib/actions'
import { addressText } from '../../lib/integrations/links'
import { sendMessage, templates, fill } from '../../lib/messaging'
import { portalUrl } from '../../lib/integrations/links'
import { choices } from '../../lib/config'
import { caseNumberTaken, peekCaseNumber } from '../../lib/numbering'
import type { Address, Contact, CustomerType, LeadSource, ProjectType, User } from '../../lib/types'
import '../../features/ops/ops.css'
import './newcase.css'

const typeHints: Record<string, string> = {
  apartment: 'מזגנים עיליים / מיני מרכזי',
  luxury: 'תכנון הנדסי, VRF, אסתטיקה',
  institution: 'מוסדות, דיור מוגן, מבני ציבור',
  commercial: 'מסעדות, מלונות, מרפאות, משרדים',
  residential_building: 'פרויקט דירות + שינויי דיירים',
  underfloor_heating: 'משאבות חום, מקוואות',
  smoke_ventilation: 'פינוי עשן ואישורים שנתיים',
  replacement: 'פירוק והתקנה מחדש',
  other: 'כל השאר',
}
const needsEngineer: ProjectType[] = ['luxury', 'institution', 'commercial', 'residential_building', 'underfloor_heating', 'smoke_ventilation']
const hasFn = (u: User, f: 'department_manager' | 'project_manager') => !!u.functions?.includes(f)

export default function NewCase() {
  const db = useApp((s) => s.db)
  const upsert = useApp((s) => s.upsert)
  const cfg = db.config
  const me = useMe()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const [step, setStep] = useState(0)

  // שלב 1: לקוח
  const [q, setQ] = useState('')
  const [customerId, setCustomerId] = useState<string>('')
  const [isNew, setIsNew] = useState(false)
  const [noCustomer, setNoCustomer] = useState(false)
  const [nc, setNc] = useState({ name: '', phone: '', email: '', idNumber: '', type: 'private' as CustomerType })
  const [addrId, setAddrId] = useState('')
  const [newAddr, setNewAddr] = useState<Address>({ id: uid('ad'), city: 'ירושלים', street: '', number: '', floor: '', apartment: '', entryNotes: '' })
  const [contactIds, setContactIds] = useState<string[]>([])
  const [isContact, setIsContact] = useState(true)
  const [person, setPerson] = useState({ name: '', phone: '', role: '' })
  const [extraContact, setExtraContact] = useState({ name: '', phone: '', role: '' })
  const [payerOn, setPayerOn] = useState(false)
  const [payerId, setPayerId] = useState('')

  // שלב 2: פרויקט
  const types = useMemo(() => cfg.projectTypes.filter((t) => t.active), [cfg.projectTypes])
  const [projectType, setProjectType] = useState<ProjectType>(() => types[0]?.key ?? 'apartment')
  const [title, setTitle] = useState('')
  const [titleTouched, setTitleTouched] = useState(false)
  const [manualNumber, setManualNumber] = useState('')
  const [source, setSource] = useState<LeadSource>('phone')
  const [contactMethod, setContactMethod] = useState('')
  const [priority, setPriority] = useState<'normal' | 'high' | 'urgent'>('normal')
  const [notes, setNotes] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [templateId, setTemplateId] = useState<string>('')
  const [projectId, setProjectId] = useState('')
  const [aptId, setAptId] = useState('')

  // שלב 3: צוות
  const [agentId, setAgentId] = useState(me.role === 'agent' ? me.id : '')
  const [engineerId, setEngineerId] = useState('')
  const [managerId, setManagerId] = useState(me.role === 'office' ? me.id : '')
  const [deptIds, setDeptIds] = useState<string[]>([])
  const [pmId, setPmId] = useState('')

  // שלב 4
  const [scheduleSurvey, setScheduleSurvey] = useState(true)
  const [welcome, setWelcome] = useState(true)
  const [creating, setCreating] = useState<number>(-1)

  // פתיחה מכרטיס לקוח: /cases/new?customer=c1
  useEffect(() => {
    const cid = params.get('customer')
    const c = cid ? db.customers.find((x) => x.id === cid) : undefined
    if (c) pickCustomer(c.id)
  }, [])

  const customer = db.customers.find((c) => c.id === customerId)
  const results = useMemo(() => {
    const t = q.trim()
    if (t.length < 2) return []
    const d = t.replace(/\D/g, '')
    return db.customers.filter((c) => c.name.includes(t) || (d.length >= 3 && c.phone.replace(/\D/g, '').includes(d))).slice(0, 6)
  }, [q, db.customers])
  const dupByPhone = isNew && nc.phone.replace(/\D/g, '').length >= 9 ? db.customers.find((c) => c.phone.replace(/\D/g, '') === nc.phone.replace(/\D/g, '')) : undefined
  const custContacts = useMemo(() => db.contacts.filter((c) => c.customerId === customerId), [db.contacts, customerId])
  const addresses = customer?.addresses ?? []
  const chosenAddr = noCustomer ? undefined : addrId ? addresses.find((a) => a.id === addrId) : newAddr
  const custName = noCustomer ? '' : isNew ? nc.name : customer?.name ?? ''
  const typeOpt = cfg.projectTypes.find((t) => t.key === projectType)
  const typeName = typeOpt?.label ?? projectType
  const autoName = !!typeOpt?.autoName
  const suggestedTitle = [typeName, custName].filter(Boolean).join(' — ') + (chosenAddr?.city ? `, ${chosenAddr.city}` : '')
  // שם אוטומטי: מתעדכן לבד עד שהמשתמש עורך אותו
  useEffect(() => {
    if (!titleTouched) setTitle(autoName ? suggestedTitle : '')
  }, [suggestedTitle, autoName, titleTouched])
  const project = db.projects.find((p) => p.id === projectId)
  const tplOptions = useMemo(() => cfg.caseTemplates.filter((t) => t.active && (!t.projectTypes.length || t.projectTypes.includes(projectType))), [cfg.caseTemplates, projectType])
  useEffect(() => {
    if (!tplOptions.some((t) => t.id === templateId)) setTemplateId(tplOptions[0]?.id ?? '')
  }, [tplOptions])
  const template = cfg.caseTemplates.find((t) => t.id === templateId)
  const nextNumber = useMemo(() => peekCaseNumber(agentId || undefined), [agentId, db.counters, cfg.caseNumbering, db.users])
  const numberTaken = !!manualNumber.trim() && caseNumberTaken(manualNumber)

  const phoneOk = (p: string) => p.replace(/\D/g, '').length >= 9
  const personOk = isContact || (person.name.trim() && phoneOk(person.phone))
  const step1ok = noCustomer || ((isNew ? nc.name.trim() && phoneOk(nc.phone) : !!customerId) && (addrId || (newAddr.street.trim() && newAddr.city.trim())) && personOk)
  const step2ok = !!title.trim() && !numberTaken
  const steps = ['לקוח ואנשי קשר', 'פרטי הפרויקט', 'צוות', 'סיכום ויצירה']
  const active = useMemo(() => db.users.filter((u) => u.active), [db.users])
  const users = (roles: string[]) => active.filter((u) => roles.includes(u.role))
  // מנהלי מחלקה / מנהל פרויקט: מי שמוגדר בפונקציה הזו קודם
  const byFn = (f: 'department_manager' | 'project_manager') => [...active.filter((u) => hasFn(u, f)), ...active.filter((u) => !hasFn(u, f) && u.role !== 'installer'), ...active.filter((u) => !hasFn(u, f) && u.role === 'installer')]
  const deptPool = byFn('department_manager')
  const pmPool = byFn('project_manager')
  const name = (id?: string) => db.users.find((u) => u.id === id)?.name

  function pickCustomer(id: string) {
    const c = db.customers.find((x) => x.id === id)
    if (!c) return
    setCustomerId(c.id)
    setIsNew(false)
    setNoCustomer(false)
    setContactIds(db.contacts.filter((x) => x.customerId === c.id && x.primary).map((x) => x.id))
    setAddrId(c.addresses[0]?.id ?? '')
  }

  async function create() {
    const run = async (i: number) => {
      setCreating(i)
      await new Promise((r) => setTimeout(r, 320))
    }
    await run(0)
    let custId = noCustomer ? '' : customerId
    let addressId = noCustomer ? '' : addrId
    const ids = noCustomer ? [] : [...contactIds]
    const fromCase: string[] = []
    const addContact = (ct: Contact, mark = true) => {
      upsert('contacts', ct)
      ids.push(ct.id)
      if (mark) fromCase.push(ct.id)
    }
    if (!noCustomer) {
      if (isNew) {
        const c = createCustomer({ name: nc.name.trim(), phone: nc.phone, email: nc.email || undefined, idNumber: nc.idNumber || undefined, type: nc.type, addresses: [newAddr] })
        custId = c.id
        addressId = newAddr.id
        if (isContact) addContact({ id: uid('ct'), customerId: c.id, name: nc.name.trim(), phone: nc.phone, email: nc.email || undefined, primary: true }, false)
      } else if (!addrId && customer) {
        useApp.getState().patch('customers', customer.id, { addresses: [...customer.addresses, newAddr] })
        addressId = newAddr.id
      }
      if (!isContact && person.name.trim()) {
        const hasPrimary = !isNew && custContacts.some((c) => c.primary)
        addContact({ id: uid('ct'), customerId: custId, name: person.name.trim(), phone: person.phone, role: person.role || undefined, primary: !hasPrimary })
      }
      if (extraContact.name.trim() && extraContact.phone.trim()) addContact({ id: uid('ct'), customerId: custId, name: extraContact.name.trim(), phone: extraContact.phone, role: extraContact.role || undefined })
    }
    await run(1)
    const k = createCase({
      title: title.trim() || suggestedTitle,
      number: manualNumber.trim() || undefined,
      customerId: custId,
      payerCustomerId: !noCustomer && payerOn && payerId ? payerId : undefined,
      contactIds: ids,
      addressId,
      projectType,
      source,
      contactMethod: contactMethod || undefined,
      priority,
      notes: notes.trim() || undefined,
      agentId: agentId || undefined,
      engineerId: engineerId || undefined,
      managerId: managerId || undefined,
      departmentManagerIds: deptIds.length ? deptIds : undefined,
      projectManagerId: pmId || undefined,
      templateId: templateId || undefined,
      tags,
      buildingProjectId: projectId || undefined,
      apartmentId: aptId || undefined,
    })
    fromCase.forEach((id) => useApp.getState().patch('contacts', id, { fromCaseId: k.id }))
    if (projectId && aptId) {
      const p = db.projects.find((x) => x.id === projectId)
      if (p) useApp.getState().patch('projects', p.id, { apartments: p.apartments.map((a) => (a.id === aptId ? { ...a, caseId: k.id } : a)) })
    }
    await run(2)
    await run(3)
    await run(4)
    // בשליחה דרך Cloud API שולחים מיד; במצב קישור הכפתור יופיע בדף התיק (חלון קופץ דורש לחיצה ישירה)
    const cloud = useApp.getState().settings.whatsappMode === 'cloud_api'
    const sendWelcome = welcome && !noCustomer
    if (sendWelcome && cloud) {
      const cust = useApp.getState().db.customers.find((c) => c.id === custId)
      if (cust) {
        void sendMessage({
          to: cust.phone,
          body: fill(templates.portal.text, { name: cust.name.replace(/^משפחת /, ''), portal: portalUrl(k.portal.token) }),
          caseId: k.id,
          customerId: cust.id,
          templateKey: 'portal',
        })
      }
    }
    const qs = new URLSearchParams()
    if (scheduleSurvey && !noCustomer) qs.set('schedule', 'survey')
    if (sendWelcome && !cloud) qs.set('welcome', '1')
    nav(`/cases/${k.id}${qs.toString() ? `?${qs}` : ''}`)
  }

  const progressSteps = [noCustomer ? 'תיק בלי לקוח (משייכים אחר כך)' : isNew ? 'פתיחת לקוח (זמני עד ש-Priority מאשר)' : 'שיוך הלקוח ואנשי הקשר', manualNumber.trim() ? `מספר תיק ידני ${manualNumber.trim()}` : 'הקצאת מספר תיק', 'שמירה במערכת', 'יצירת תיקיית מסמכים', 'התראות לצוות']

  // תקציר מה שנבחר בשלבים שהושלמו
  const chips: { step: number; text: string }[] = []
  if (step > 0) {
    chips.push({ step: 0, text: noCustomer ? 'ללא לקוח' : `לקוח: ${custName}${isNew ? ' (חדש)' : ''}` })
    if (chosenAddr && addressText(chosenAddr)) chips.push({ step: 0, text: addressText(chosenAddr) })
    if (!noCustomer && !isContact && person.name) chips.push({ step: 0, text: `איש קשר: ${person.name}` })
  }
  if (step > 1) {
    chips.push({ step: 1, text: typeName })
    chips.push({ step: 1, text: `שם: ${title.trim() || suggestedTitle}` })
    chips.push({ step: 1, text: `מספר: ${manualNumber.trim() || nextNumber}` })
    if (contactMethod) chips.push({ step: 1, text: cfg.contactMethods.find((o) => o.key === contactMethod)?.label ?? contactMethod })
    if (tags.length) chips.push({ step: 1, text: `${tags.length} תגיות` })
    if (template) chips.push({ step: 1, text: `תבנית: ${template.name}` })
  }
  if (step > 2) {
    chips.push({ step: 2, text: agentId ? `סוכן: ${name(agentId)}` : 'ללא סוכן' })
    if (deptIds.length) chips.push({ step: 2, text: deptIds.length === 1 ? `מנהל מחלקה: ${name(deptIds[0])}` : `${deptIds.length} מנהלי מחלקה` })
    if (pmId) chips.push({ step: 2, text: `מנהל פרויקט: ${name(pmId)}` })
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <PageHead title="תיק חדש" sub="ארבעה שלבים קצרים, ואפשר לחזור אחורה בכל רגע" />
      <div className="stepper">
        {steps.map((s, i) => (
          <div key={s} className={`step ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`}>
            <span className="n">{i < step ? <Check size={15} /> : i + 1}</span>
            <span className="t">{s}</span>
          </div>
        ))}
      </div>
      {chips.length > 0 && (
        <div className="nc-chips" aria-label="מה נבחר עד עכשיו">
          {chips.map((c, i) => (
            <button key={i} className="nc-chip" onClick={() => creating < 0 && setStep(c.step)} title="חזרה לשלב">
              <Check size={13} /> <span className="truncate">{c.text}</span>
            </button>
          ))}
        </div>
      )}

      {step === 0 && (
        <div className="col" style={{ gap: 16 }}>
          <Card title="לקוח" pad>
            {noCustomer && (
              <div className="row between wrap">
                <div className="row">
                  <span className="nc-ico"><UserX size={18} /></span>
                  <div>
                    <div className="strong">תיק בלי לקוח</div>
                    <div className="small muted">אפשר לשייך לקוח מדף התיק בכל שלב. בינתיים לא נשלחות הודעות ללקוח.</div>
                  </div>
                </div>
                <button className="btn sm" onClick={() => setNoCustomer(false)}>בחירת לקוח</button>
              </div>
            )}
            {!noCustomer && !isNew && !customer && (
              <div className="col">
                <div className="search" style={{ minWidth: 0, borderRadius: 10, background: '#fff' }}>
                  <Search size={16} />
                  <input autoFocus placeholder="חיפוש לפי שם או טלפון..." value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
                {results.map((c) => (
                  <button key={c.id} className="list-item click" style={{ border: '1px solid var(--line)', borderRadius: 10, background: '#fff', textAlign: 'start' }} onClick={() => pickCustomer(c.id)}>
                    <div className="grow">
                      <div className="strong small">{c.name}</div>
                      <div className="tiny muted"><span className="ltr">{fmtPhone(c.phone)}</span> · {customerTypeLabel[c.type]} · {addressText(c.addresses[0])}</div>
                    </div>
                    <Badge tone="muted">{db.cases.filter((k) => k.customerId === c.id).length} תיקים</Badge>
                  </button>
                ))}
                <div className="row wrap">
                  <button className="btn" onClick={() => { setIsNew(true); setNc((p) => ({ ...p, name: /\d/.test(q) ? '' : q, phone: /\d/.test(q) ? q : '' })) }}>
                    <UserPlus size={16} /> לקוח חדש
                  </button>
                  <button className="btn ghost" onClick={() => { setNoCustomer(true); setCustomerId(''); setIsNew(false) }}>
                    <UserX size={16} /> ללא לקוח — אפשר לשייך אחר כך
                  </button>
                </div>
              </div>
            )}
            {!noCustomer && customer && (
              <div className="row between">
                <div>
                  <div className="strong">{customer.name}</div>
                  <div className="small muted"><span className="ltr">{fmtPhone(customer.phone)}</span> · {customerTypeLabel[customer.type]}</div>
                </div>
                <button className="btn sm" onClick={() => { setCustomerId(''); setAddrId(''); setContactIds([]) }}>החלפה</button>
              </div>
            )}
            {!noCustomer && isNew && (
              <div className="col">
                <div className="grid g2">
                  <Field label="שם הלקוח *"><input className="input" autoFocus value={nc.name} onChange={(e) => setNc({ ...nc, name: e.target.value })} placeholder="משפחת כהן / שם העסק" /></Field>
                  <Field label="טלפון נייד *"><input className="input ltr" inputMode="tel" value={nc.phone} onChange={(e) => setNc({ ...nc, phone: e.target.value })} placeholder="05X-XXXXXXX" /></Field>
                  <Field label="אימייל"><input className="input ltr" inputMode="email" value={nc.email} onChange={(e) => setNc({ ...nc, email: e.target.value })} /></Field>
                  <Field label="ת״ז / ח״פ" hint="נדרש לפתיחת הלקוח ב-Priority"><input className="input" inputMode="numeric" value={nc.idNumber} onChange={(e) => setNc({ ...nc, idNumber: e.target.value })} /></Field>
                </div>
                <div className="row wrap">
                  {(Object.keys(customerTypeLabel) as CustomerType[]).map((t) => (
                    <button key={t} className={`chip ${nc.type === t ? 'on' : ''}`} onClick={() => setNc({ ...nc, type: t })}>{customerTypeLabel[t]}</button>
                  ))}
                </div>
                {dupByPhone && (
                  <Callout tone="warning">
                    כבר יש לקוח עם הטלפון הזה: <b>{dupByPhone.name}</b>.{' '}
                    <button className="btn sm" onClick={() => pickCustomer(dupByPhone.id)}>להשתמש בו</button>
                  </Callout>
                )}
                <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setIsNew(false)}>חזרה לחיפוש</button>
              </div>
            )}
          </Card>

          {!noCustomer && (customer || isNew) && (
            <Card title={<div className="row"><MapPin size={17} /><h2>כתובת הפרויקט</h2></div>} pad>
              <div className="col">
                {addresses.map((a) => (
                  <label key={a.id} className="check">
                    <input type="radio" name="addr" checked={addrId === a.id} onChange={() => setAddrId(a.id)} />
                    <span>{addressText(a)}{a.floor ? `, קומה ${a.floor}` : ''}{a.label ? ` (${a.label})` : ''}</span>
                  </label>
                ))}
                {addresses.length > 0 && (
                  <label className="check">
                    <input type="radio" name="addr" checked={!addrId} onChange={() => setAddrId('')} />
                    <span>כתובת אחרת</span>
                  </label>
                )}
                {!addrId && (
                  <div className="grid g3">
                    <Field label="עיר *"><input className="input" value={newAddr.city} onChange={(e) => setNewAddr({ ...newAddr, city: e.target.value })} /></Field>
                    <Field label="רחוב *"><input className="input" value={newAddr.street} onChange={(e) => setNewAddr({ ...newAddr, street: e.target.value })} /></Field>
                    <Field label="מספר"><input className="input" value={newAddr.number} onChange={(e) => setNewAddr({ ...newAddr, number: e.target.value })} /></Field>
                    <Field label="קומה"><input className="input" value={newAddr.floor} onChange={(e) => setNewAddr({ ...newAddr, floor: e.target.value })} /></Field>
                    <Field label="דירה"><input className="input" value={newAddr.apartment} onChange={(e) => setNewAddr({ ...newAddr, apartment: e.target.value })} /></Field>
                    <Field label="הערות כניסה"><input className="input" value={newAddr.entryNotes} onChange={(e) => setNewAddr({ ...newAddr, entryNotes: e.target.value })} placeholder="קוד בניין, חניה..." /></Field>
                  </div>
                )}
              </div>
            </Card>
          )}

          {!noCustomer && (customer || isNew) && (
            <Card title="אנשי קשר ותשלום" pad>
              <div className="col">
                <label className="check">
                  <input type="checkbox" checked={isContact} onChange={(e) => setIsContact(e.target.checked)} />
                  <span>הלקוח הוא גם איש הקשר</span>
                </label>
                {!isContact && (
                  <div className="grid g3">
                    <Field label="איש הקשר *"><input className="input" value={person.name} onChange={(e) => setPerson({ ...person, name: e.target.value })} placeholder="מי מדבר איתנו בפועל" /></Field>
                    <Field label="טלפון *"><input className="input ltr" inputMode="tel" value={person.phone} onChange={(e) => setPerson({ ...person, phone: e.target.value })} /></Field>
                    <Field label="תפקיד"><input className="input" value={person.role} onChange={(e) => setPerson({ ...person, role: e.target.value })} placeholder="בן משפחה, מנהל אחזקה..." /></Field>
                  </div>
                )}
                {custContacts.map((c) => (
                  <label key={c.id} className="check">
                    <input type="checkbox" checked={contactIds.includes(c.id)} onChange={(e) => setContactIds(e.target.checked ? [...contactIds, c.id] : contactIds.filter((x) => x !== c.id))} />
                    <span>{c.name}{c.role ? ` · ${c.role}` : ''} · <span className="ltr">{fmtPhone(c.phone)}</span>{c.primary ? ' · ראשי' : ''}</span>
                  </label>
                ))}
                {isNew && isContact && <div className="small muted">הלקוח עצמו יירשם כאיש הקשר הראשי.</div>}
                <div className="grid g3">
                  <Field label="איש קשר נוסף"><input className="input" value={extraContact.name} onChange={(e) => setExtraContact({ ...extraContact, name: e.target.value })} placeholder="אדריכל, מנהל עבודה..." /></Field>
                  <Field label="טלפון"><input className="input ltr" value={extraContact.phone} onChange={(e) => setExtraContact({ ...extraContact, phone: e.target.value })} /></Field>
                  <Field label="תפקיד"><input className="input" value={extraContact.role} onChange={(e) => setExtraContact({ ...extraContact, role: e.target.value })} /></Field>
                </div>
                <label className="check">
                  <input type="checkbox" checked={payerOn} onChange={(e) => setPayerOn(e.target.checked)} />
                  <span>הלקוח המשלם שונה (למשל יזם או חברת ניהול)</span>
                </label>
                {payerOn && (
                  <select className="select" value={payerId} onChange={(e) => setPayerId(e.target.value)}>
                    <option value="">בחירת לקוח משלם...</option>
                    {db.customers.filter((c) => c.id !== customerId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
              </div>
            </Card>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="col" style={{ gap: 16 }}>
          <Card title="סוג הפרויקט" pad>
            <div className="choice-grid">
              {types.map((t) => (
                <button key={t.key} className={`choice ${projectType === t.key ? 'on' : ''}`} onClick={() => setProjectType(t.key)}>
                  <span className="row" style={{ gap: 7 }}><span className="nc-dot" style={{ background: t.color ?? '#94a3b8' }} /><b>{t.label}</b></span>
                  <small>{typeHints[t.key] ?? (t.autoName ? 'שם אוטומטי' : 'שם ידני')}</small>
                </button>
              ))}
            </div>
          </Card>
          {projectType === 'residential_building' && (
            <Card title="שיוך לפרויקט בנייה רוויה" pad>
              <div className="grid g2">
                <Field label="פרויקט">
                  <select className="select" value={projectId} onChange={(e) => { setProjectId(e.target.value); setAptId('') }}>
                    <option value="">בלי שיוך</option>
                    {db.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Field>
                {project && (
                  <Field label="דירה">
                    <select className="select" value={aptId} onChange={(e) => setAptId(e.target.value)}>
                      <option value="">בחירת דירה...</option>
                      {project.apartments.filter((a) => !a.caseId).map((a) => <option key={a.id} value={a.id}>בניין {a.building}, קומה {a.floor}, דירה {a.number} — {a.tenantName}</option>)}
                    </select>
                  </Field>
                )}
              </div>
            </Card>
          )}
          <Card title="פרטים" pad>
            <div className="col">
              <div className="grid g2">
                <Field label={autoName ? 'שם התיק' : 'שם התיק *'} hint={autoName ? 'נוצר אוטומטית לפי הסוג, הלקוח והעיר. אפשר לערוך.' : 'בסוג הזה נותנים שם ידני'}>
                  <input className="input" value={title} onChange={(e) => { setTitle(e.target.value); setTitleTouched(true) }} placeholder={autoName ? suggestedTitle : 'למשל: מגדל המשרדים, קומות 3-5'} />
                </Field>
                <Field label="מספר תיק" hint={<>השאירו ריק למספר אוטומטי · הבא בתור: <b className="ltr">{nextNumber}</b></>}>
                  <input className={`input ltr ${numberTaken ? 'nc-bad' : ''}`} value={manualNumber} onChange={(e) => setManualNumber(e.target.value)} placeholder={nextNumber} />
                </Field>
              </div>
              {numberTaken && <div className="tiny txt-danger">המספר הזה כבר קיים בתיק אחר</div>}
              {autoName && titleTouched && title !== suggestedTitle && <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setTitleTouched(false)}>חזרה לשם האוטומטי</button>}
              <div className="grid g3">
                <Field label="מקור הליד">
                  <select className="select" value={source} onChange={(e) => setSource(e.target.value as LeadSource)}>
                    {Object.entries(sourceLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </Field>
                <Field label="אופן יצירת קשר">
                  <select className="select" value={contactMethod} onChange={(e) => setContactMethod(e.target.value)}>
                    <option value="">לא צוין</option>
                    {choices(cfg.contactMethods, contactMethod).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                  </select>
                </Field>
                <Field label="עדיפות">
                  <div className="row">
                    {(['normal', 'high', 'urgent'] as const).map((p) => (
                      <button key={p} className={`chip ${priority === p ? 'on' : ''}`} onClick={() => setPriority(p)}>{p === 'normal' ? 'רגילה' : p === 'high' ? 'גבוהה' : 'דחוף'}</button>
                    ))}
                  </div>
                </Field>
              </div>
              <div>
                <div className="label mb8">תגיות</div>
                <div className="row wrap">
                  {choices(cfg.tags).map((t) => {
                    const on = tags.includes(t.label)
                    return (
                      <button key={t.key} className={`chip ${on ? 'on' : ''}`} onClick={() => setTags(on ? tags.filter((x) => x !== t.label) : [...tags, t.label])}>
                        <span className="nc-dot" style={{ background: t.color ?? '#94a3b8' }} />{t.label}
                      </button>
                    )
                  })}
                </div>
              </div>
              <Field label="תבנית תיק" hint={template ? `${template.stageIds.length} שלבים בתהליך העבודה, המשימות נפתחות לצוות אוטומטית` : 'התבנית הראשונה שמתאימה לסוג הפרויקט'}>
                <select className="select" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                  <option value="">אוטומטית לפי סוג הפרויקט</option>
                  {tplOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </Field>
              <Field label={<span className="row between"><span>מה הלקוח צריך</span><Dictate onText={(t) => setNotes((n) => (n ? n + ' ' : '') + t)} /></span>}>
                <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="כמה חדרים, מה קיים היום, לוחות זמנים, בקשות מיוחדות..." />
              </Field>
            </div>
          </Card>
        </div>
      )}

      {step === 2 && (
        <div className="col" style={{ gap: 16 }}>
          <Card title="צוות התיק" pad>
            <div className="grid g3">
              <Field label="סוכן אחראי">
                <select className="select" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                  <option value="">ללא סוכן (ההנהלה / מנהל הפרויקט אחראים)</option>
                  {users(['agent', 'admin']).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </Field>
              <Field label="מהנדס" hint={needsEngineer.includes(projectType) ? 'מומלץ לפרויקט מהסוג הזה' : undefined}>
                <select className="select" value={engineerId} onChange={(e) => setEngineerId(e.target.value)}>
                  <option value="">ללא</option>
                  {users(['engineer']).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </Field>
              <Field label="מנהל התיק במשרד">
                <select className="select" value={managerId} onChange={(e) => setManagerId(e.target.value)}>
                  <option value="">ללא</option>
                  {users(['office', 'admin']).map((u) => <option key={u.id} value={u.id}>{u.name} · {roleLabel[u.role]}</option>)}
                </select>
              </Field>
            </div>
            {!agentId && <div className="tiny muted mt8">בלי סוכן לא נרשמת עמלה, והמשימות של הסוכן עוברות למנהל הפרויקט.</div>}
            {needsEngineer.includes(projectType) && !engineerId && <div className="mt12"><Callout tone="warning">בפרויקט מסוג "{typeName}" מחלקת ההנדסה מלווה את התכנון. כדאי לשבץ מהנדס.</Callout></div>}
          </Card>
          <Card title="מנהלי מחלקה" actions={deptIds.length ? <Badge tone="brand">{deptIds.length} נבחרו</Badge> : undefined} pad>
            <div className="small muted mb12">כל מנהלי המחלקה שנבחרו מקבלים את משימות התיק ואת העדכונים שלו.</div>
            <div className="pick-list">
              {deptPool.map((u) => {
                const on = deptIds.includes(u.id)
                return (
                  <button key={u.id} type="button" className={`pick-user ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => setDeptIds(on ? deptIds.filter((x) => x !== u.id) : [...deptIds, u.id])}>
                    <span className={`tick ${on ? 'on' : ''}`}>✓</span>
                    <span className="grow" style={{ textAlign: 'start', minWidth: 0 }}>
                      <span className="small strong" style={{ display: 'block' }}>{u.name}</span>
                      <span className="tiny muted">{hasFn(u, 'department_manager') ? 'מנהל מחלקה · ' : ''}{u.title || roleLabel[u.role]}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </Card>
          <Card title="מנהל פרויקט" pad>
            <Field label="מי מנהל את הביצוע בפועל" hint="מקבל את משימות הביצוע (ציוד, מנוף, מסירה)">
              <select className="select" value={pmId} onChange={(e) => setPmId(e.target.value)}>
                <option value="">ללא</option>
                {pmPool.map((u) => <option key={u.id} value={u.id}>{u.name}{hasFn(u, 'project_manager') ? ' · מנהל פרויקטים' : ` · ${roleLabel[u.role]}`}</option>)}
              </select>
            </Field>
          </Card>
        </div>
      )}

      {step === 3 && (
        <div className="col" style={{ gap: 16 }}>
          <Card title="סיכום" pad>
            <div className="grid g2 small nc-sum">
              <div><span className="muted">לקוח: </span>{noCustomer ? <Badge tone="warning">ללא לקוח</Badge> : <><b>{custName}</b>{isNew && <> <Badge tone="warning">חדש</Badge></>}</>}</div>
              <div><span className="muted">כתובת: </span>{addressText(chosenAddr) || '—'}</div>
              <div><span className="muted">סוג: </span>{typeName}</div>
              <div><span className="muted">שם התיק: </span>{title.trim() || suggestedTitle}</div>
              <div><span className="muted">מספר: </span><b className="ltr">{manualNumber.trim() || nextNumber}</b>{manualNumber.trim() ? ' (ידני)' : ''}</div>
              <div><span className="muted">תבנית: </span>{template?.name ?? 'לפי סוג הפרויקט'}</div>
              <div><span className="muted">סוכן: </span>{agentId ? name(agentId) : 'ללא סוכן'}</div>
              <div><span className="muted">מהנדס: </span>{name(engineerId) ?? '—'}</div>
              <div><span className="muted">מנהלי מחלקה: </span>{deptIds.length ? deptIds.map(name).join(', ') : '—'}</div>
              <div><span className="muted">מנהל פרויקט: </span>{name(pmId) ?? '—'}</div>
              {tags.length > 0 && <div><span className="muted">תגיות: </span>{tags.join(', ')}</div>}
              {contactMethod && <div><span className="muted">אופן יצירת קשר: </span>{cfg.contactMethods.find((o) => o.key === contactMethod)?.label}</div>}
            </div>
          </Card>
          <Card title="מה עוד לעשות עכשיו" pad>
            <div className="col">
              <label className={`check ${noCustomer ? 'muted' : ''}`}><input type="checkbox" disabled={noCustomer} checked={scheduleSurvey && !noCustomer} onChange={(e) => setScheduleSurvey(e.target.checked)} /> לקבוע סקר בשטח מיד אחרי הפתיחה</label>
              <label className={`check ${noCustomer ? 'muted' : ''}`}><input type="checkbox" disabled={noCustomer} checked={welcome && !noCustomer} onChange={(e) => setWelcome(e.target.checked)} /> לשלוח ללקוח קישור לאזור האישי בוואטסאפ</label>
              {noCustomer && <div className="tiny muted">אחרי שתשייכו לקוח אפשר לקבוע סקר ולשלוח לו קישור מדף התיק.</div>}
            </div>
          </Card>
          {creating >= 0 && (
            <Card pad>
              <div className="col">
                {progressSteps.map((s, i) => (
                  <div key={s} className="row small" style={{ color: i <= creating ? 'var(--ink)' : 'var(--text-3)' }}>
                    {i < creating ? <Check size={16} color="var(--success)" /> : i === creating ? <Loader2 size={16} className="spin" /> : <span style={{ width: 16 }} />}
                    {s}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      <div className="row between mt24">
        <button className="btn" onClick={() => (step === 0 ? nav(-1) : setStep(step - 1))} disabled={creating >= 0}>
          <ArrowRight size={16} /> {step === 0 ? 'ביטול' : 'הקודם'}
        </button>
        {step < 3 ? (
          <button className="btn primary" disabled={(step === 0 && !step1ok) || (step === 1 && !step2ok)} onClick={() => setStep(step + 1)}>
            הבא <ArrowLeft size={16} />
          </button>
        ) : (
          <button className="btn primary lg" disabled={creating >= 0} onClick={create}>
            <Plus size={18} /> יצירת התיק
          </button>
        )}
      </div>
      <style>{'.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}'}</style>
    </div>
  )
}
