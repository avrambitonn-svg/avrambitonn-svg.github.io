import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, Loader2, MapPin, Plus, Search, UserPlus } from 'lucide-react'
import { useApp, useMe } from '../../lib/store'
import { Badge, Callout, Card, Field, PageHead } from '../../components/ui'
import { Dictate } from '../../components/extras'
import { customerTypeLabel, projectTypeLabel, roleLabel, sourceLabel } from '../../lib/labels'
import { phone as fmtPhone, uid } from '../../lib/format'
import { createCase, createCustomer } from '../../lib/actions'
import { addressText } from '../../lib/integrations/links'
import { sendMessage, templates, fill } from '../../lib/messaging'
import { portalUrl } from '../../lib/integrations/links'
import type { Address, Contact, CustomerType, LeadSource, ProjectType } from '../../lib/types'

const typeHints: Record<ProjectType, string> = {
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
const tagOptions = ['VIP', 'לקוח חוזר', 'דחוף לפני הקיץ', 'דורש מנוף', 'עבודה בגובה', 'הפניה מאדריכל']

export default function NewCase() {
  const db = useApp((s) => s.db)
  const upsert = useApp((s) => s.upsert)
  const me = useMe()
  const nav = useNavigate()
  const [step, setStep] = useState(0)

  // שלב 1: לקוח
  const [q, setQ] = useState('')
  const [customerId, setCustomerId] = useState<string>('')
  const [isNew, setIsNew] = useState(false)
  const [nc, setNc] = useState({ name: '', phone: '', email: '', idNumber: '', type: 'private' as CustomerType })
  const [addrId, setAddrId] = useState('')
  const [newAddr, setNewAddr] = useState<Address>({ id: uid('ad'), city: 'ירושלים', street: '', number: '', floor: '', apartment: '', entryNotes: '' })
  const [contactIds, setContactIds] = useState<string[]>([])
  const [extraContact, setExtraContact] = useState({ name: '', phone: '', role: '' })
  const [payerOn, setPayerOn] = useState(false)
  const [payerId, setPayerId] = useState('')

  // שלב 2: פרויקט
  const [projectType, setProjectType] = useState<ProjectType>('apartment')
  const [title, setTitle] = useState('')
  const [source, setSource] = useState<LeadSource>('phone')
  const [priority, setPriority] = useState<'normal' | 'high' | 'urgent'>('normal')
  const [notes, setNotes] = useState('')
  const [projectId, setProjectId] = useState('')
  const [aptId, setAptId] = useState('')

  // שלב 3: צוות
  const [agentId, setAgentId] = useState(me.role === 'agent' ? me.id : '')
  const [engineerId, setEngineerId] = useState('')
  const [managerId, setManagerId] = useState(me.role === 'office' ? me.id : '')
  const [tags, setTags] = useState<string[]>([])

  // שלב 4
  const [scheduleSurvey, setScheduleSurvey] = useState(true)
  const [welcome, setWelcome] = useState(true)
  const [creating, setCreating] = useState<number>(-1)

  const customer = db.customers.find((c) => c.id === customerId)
  const results = useMemo(() => {
    const t = q.trim()
    if (t.length < 2) return []
    const d = t.replace(/\D/g, '')
    return db.customers.filter((c) => c.name.includes(t) || (d.length >= 3 && c.phone.replace(/\D/g, '').includes(d))).slice(0, 6)
  }, [q, db.customers])
  const dupByPhone = isNew && nc.phone.replace(/\D/g, '').length >= 9 ? db.customers.find((c) => c.phone.replace(/\D/g, '') === nc.phone.replace(/\D/g, '')) : undefined
  const custContacts = db.contacts.filter((c) => c.customerId === customerId)
  const addresses = customer?.addresses ?? []
  const chosenAddr = addrId ? addresses.find((a) => a.id === addrId) : newAddr
  const custName = isNew ? nc.name : customer?.name ?? ''
  const suggestedTitle = `${projectTypeLabel[projectType]} — ${custName}${chosenAddr?.city ? `, ${chosenAddr.city}` : ''}`
  const project = db.projects.find((p) => p.id === projectId)

  const step1ok = (isNew ? nc.name.trim() && nc.phone.replace(/\D/g, '').length >= 9 : !!customerId) && (addrId || (newAddr.street.trim() && newAddr.city.trim()))
  const steps = ['לקוח ואנשי קשר', 'פרטי הפרויקט', 'צוות', 'סיכום ויצירה']
  const users = (roles: string[]) => db.users.filter((u) => roles.includes(u.role) && u.active)

  async function create() {
    const run = async (i: number) => {
      setCreating(i)
      await new Promise((r) => setTimeout(r, 380))
    }
    await run(0)
    let custId = customerId
    let addressId = addrId
    const ids = [...contactIds]
    if (isNew) {
      const c = createCustomer({ name: nc.name.trim(), phone: nc.phone, email: nc.email || undefined, idNumber: nc.idNumber || undefined, type: nc.type, addresses: [newAddr] })
      custId = c.id
      addressId = newAddr.id
      const primary: Contact = { id: uid('ct'), customerId: c.id, name: nc.name.trim(), phone: nc.phone, primary: true }
      upsert('contacts', primary)
      ids.push(primary.id)
    } else if (!addrId && customer) {
      useApp.getState().patch('customers', customer.id, { addresses: [...customer.addresses, newAddr] })
      addressId = newAddr.id
    }
    if (extraContact.name.trim() && extraContact.phone.trim()) {
      const ct: Contact = { id: uid('ct'), customerId: custId, name: extraContact.name.trim(), phone: extraContact.phone, role: extraContact.role || undefined }
      upsert('contacts', ct)
      ids.push(ct.id)
    }
    await run(1)
    const k = createCase({
      title: title.trim() || suggestedTitle,
      customerId: custId,
      payerCustomerId: payerOn && payerId ? payerId : undefined,
      contactIds: ids,
      addressId,
      projectType,
      source,
      priority,
      notes: notes.trim() || undefined,
      agentId: agentId || undefined,
      engineerId: engineerId || undefined,
      managerId: managerId || undefined,
      tags,
      buildingProjectId: projectId || undefined,
      apartmentId: aptId || undefined,
    })
    if (projectId && aptId) {
      const p = db.projects.find((x) => x.id === projectId)
      if (p) useApp.getState().patch('projects', p.id, { apartments: p.apartments.map((a) => (a.id === aptId ? { ...a, caseId: k.id } : a)) })
    }
    await run(2)
    await run(3)
    await run(4)
    // בשליחה דרך Cloud API שולחים מיד; במצב קישור הכפתור יופיע בדף התיק (חלון קופץ דורש לחיצה ישירה)
    const cloud = useApp.getState().settings.whatsappMode === 'cloud_api'
    if (welcome && cloud) {
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
    if (scheduleSurvey) qs.set('schedule', 'survey')
    if (welcome && !cloud) qs.set('welcome', '1')
    nav(`/cases/${k.id}${qs.toString() ? `?${qs}` : ''}`)
  }

  const progressSteps = ['פתיחת לקוח (זמני עד ש-Priority מאשר)', 'הקצאת מספר תיק', 'שמירה במערכת', 'יצירת תיקיית מסמכים', 'התראות לצוות']

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

      {step === 0 && (
        <div className="col" style={{ gap: 16 }}>
          <Card title="לקוח" pad>
            {!isNew && !customer && (
              <div className="col">
                <div className="search" style={{ minWidth: 0, borderRadius: 10, background: '#fff' }}>
                  <Search size={16} />
                  <input autoFocus placeholder="חיפוש לפי שם או טלפון..." value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
                {results.map((c) => (
                  <button key={c.id} className="list-item click" style={{ border: '1px solid var(--line)', borderRadius: 10, background: '#fff', textAlign: 'start' }} onClick={() => { setCustomerId(c.id); setContactIds(db.contacts.filter((x) => x.customerId === c.id && x.primary).map((x) => x.id)); setAddrId(c.addresses[0]?.id ?? '') }}>
                    <div className="grow">
                      <div className="strong small">{c.name}</div>
                      <div className="tiny muted">{fmtPhone(c.phone)} · {customerTypeLabel[c.type]} · {addressText(c.addresses[0])}</div>
                    </div>
                    <Badge tone="muted">{db.cases.filter((k) => k.customerId === c.id).length} תיקים</Badge>
                  </button>
                ))}
                <button className="btn" onClick={() => { setIsNew(true); setNc((p) => ({ ...p, name: /\d/.test(q) ? '' : q, phone: /\d/.test(q) ? q : '' })) }}>
                  <UserPlus size={16} /> לקוח חדש
                </button>
              </div>
            )}
            {customer && (
              <div className="row between">
                <div>
                  <div className="strong">{customer.name}</div>
                  <div className="small muted">{fmtPhone(customer.phone)} · {customerTypeLabel[customer.type]}</div>
                </div>
                <button className="btn sm" onClick={() => { setCustomerId(''); setAddrId(''); setContactIds([]) }}>החלפה</button>
              </div>
            )}
            {isNew && (
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
                    <button className="btn sm" onClick={() => { setIsNew(false); setCustomerId(dupByPhone.id); setAddrId(dupByPhone.addresses[0]?.id ?? '') }}>להשתמש בו</button>
                  </Callout>
                )}
                <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setIsNew(false)}>חזרה לחיפוש</button>
              </div>
            )}
          </Card>

          {(customer || isNew) && (
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

          {(customer || isNew) && (
            <Card title="אנשי קשר ותשלום" pad>
              <div className="col">
                {custContacts.map((c) => (
                  <label key={c.id} className="check">
                    <input type="checkbox" checked={contactIds.includes(c.id)} onChange={(e) => setContactIds(e.target.checked ? [...contactIds, c.id] : contactIds.filter((x) => x !== c.id))} />
                    <span>{c.name}{c.role ? ` · ${c.role}` : ''} · <span className="ltr">{fmtPhone(c.phone)}</span></span>
                  </label>
                ))}
                {isNew && <div className="small muted">הלקוח עצמו יירשם כאיש הקשר הראשי.</div>}
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
              {(Object.keys(projectTypeLabel) as ProjectType[]).map((t) => (
                <button key={t} className={`choice ${projectType === t ? 'on' : ''}`} onClick={() => setProjectType(t)}>
                  <b>{projectTypeLabel[t]}</b>
                  <small>{typeHints[t]}</small>
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
              <Field label="שם התיק" hint="אפשר להשאיר את ההצעה האוטומטית">
                <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={suggestedTitle} />
              </Field>
              <div className="grid g2">
                <Field label="איך הלקוח הגיע">
                  <select className="select" value={source} onChange={(e) => setSource(e.target.value as LeadSource)}>
                    {Object.entries(sourceLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
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
              <Field label={<span className="row between"><span>מה הלקוח צריך</span><Dictate onText={(t) => setNotes((n) => (n ? n + ' ' : '') + t)} /></span>}>
                <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="כמה חדרים, מה קיים היום, לוחות זמנים, בקשות מיוחדות..." />
              </Field>
            </div>
          </Card>
        </div>
      )}

      {step === 2 && (
        <Card title="צוות התיק" pad>
          <div className="grid g3">
            <Field label="יועץ מכירות">
              <select className="select" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                <option value="">ללא</option>
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
          {needsEngineer.includes(projectType) && !engineerId && <div className="mt12"><Callout tone="warning">בפרויקט מסוג "{projectTypeLabel[projectType]}" מחלקת ההנדסה מלווה את התכנון. כדאי לשבץ מהנדס.</Callout></div>}
          <div className="mt16">
            <div className="label mb8">תגיות</div>
            <div className="row wrap">
              {tagOptions.map((t) => (
                <button key={t} className={`chip ${tags.includes(t) ? 'on' : ''}`} onClick={() => setTags(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t])}>{t}</button>
              ))}
            </div>
          </div>
        </Card>
      )}

      {step === 3 && (
        <div className="col" style={{ gap: 16 }}>
          <Card title="סיכום" pad>
            <div className="grid g2 small">
              <div><span className="muted">לקוח: </span><b>{custName}</b>{isNew && <> <Badge tone="warning">חדש</Badge></>}</div>
              <div><span className="muted">כתובת: </span>{addressText(chosenAddr)}</div>
              <div><span className="muted">סוג: </span>{projectTypeLabel[projectType]}</div>
              <div><span className="muted">שם התיק: </span>{title.trim() || suggestedTitle}</div>
              <div><span className="muted">סוכן: </span>{db.users.find((u) => u.id === agentId)?.name ?? '—'}</div>
              <div><span className="muted">מהנדס: </span>{db.users.find((u) => u.id === engineerId)?.name ?? '—'}</div>
            </div>
          </Card>
          <Card title="מה עוד לעשות עכשיו" pad>
            <div className="col">
              <label className="check"><input type="checkbox" checked={scheduleSurvey} onChange={(e) => setScheduleSurvey(e.target.checked)} /> לקבוע סקר בשטח מיד אחרי הפתיחה</label>
              <label className="check"><input type="checkbox" checked={welcome} onChange={(e) => setWelcome(e.target.checked)} /> לשלוח ללקוח קישור לאזור האישי בוואטסאפ</label>
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
          <button className="btn primary" disabled={step === 0 && !step1ok} onClick={() => setStep(step + 1)}>
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
