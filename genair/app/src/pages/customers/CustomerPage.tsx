import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { FolderPlus, MessageCircle, Pencil, RefreshCw, ShieldCheck, Wrench } from 'lucide-react'
import { useApp } from '../../lib/store'
import { Badge, Card, Empty, Field, Modal, toast } from '../../components/ui'
import { QuickContact } from '../../components/extras'
import { contractTypeLabel, customerTypeLabel, serviceStatusLabel, serviceStatusTone, stageLabel, stageTone, syncLabel, syncTone } from '../../lib/labels'
import { date, daysBetween, money, phone, relative } from '../../lib/format'
import { totals } from '../../lib/quote'
import { addressText } from '../../lib/integrations/links'
import { pushCustomer } from '../../lib/integrations/priority'
import { sendMessage } from '../../lib/messaging'

export default function CustomerPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const db = useApp((s) => s.db)
  const patch = useApp((s) => s.patch)
  const c = db.customers.find((x) => x.id === id)
  const [edit, setEdit] = useState(false)
  const [msg, setMsg] = useState('')

  const cases = useMemo(() => db.cases.filter((k) => k.customerId === id || k.payerCustomerId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [db.cases, id])
  const units = useMemo(() => db.units.filter((u) => u.customerId === id), [db.units, id])
  const contracts = useMemo(() => db.contracts.filter((x) => x.customerId === id), [db.contracts, id])
  const calls = useMemo(() => db.serviceCalls.filter((x) => x.customerId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [db.serviceCalls, id])
  const msgs = useMemo(() => db.messages.filter((m) => m.customerId === id).sort((a, b) => b.at.localeCompare(a.at)), [db.messages, id])

  if (!c) return <Card><Empty title="הלקוח לא נמצא"><Link to="/customers">לרשימת הלקוחות</Link></Empty></Card>
  const contacts = db.contacts.filter((x) => x.customerId === c.id)
  const revenue = db.quotes.filter((q) => q.status === 'approved' && cases.some((k) => k.id === q.caseId)).reduce((s, q) => s + totals(q).net, 0)

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card>
        <div className="card-body row between wrap" style={{ alignItems: 'flex-start' }}>
          <div>
            <div className="row wrap" style={{ gap: 8 }}>
              <Badge>{customerTypeLabel[c.type]}</Badge>
              <Badge tone={syncTone[c.sync.status]}>{syncLabel[c.sync.status]} ב-Priority{c.sync.priorityId ? ` · ${c.sync.priorityId}` : ''}</Badge>
              {c.temp && <Badge tone="warning">לקוח זמני</Badge>}
              {c.tags?.map((t) => <Badge key={t} tone="brand">{t}</Badge>)}
            </div>
            <h1 className="mt8">{c.name}</h1>
            <div className="small muted mt8">
              <span className="ltr">{phone(c.phone)}</span>{c.email ? ` · ${c.email}` : ''}{c.idNumber ? ` · ת״ז/ח״פ ${c.idNumber}` : ''} · לקוח מ-{date(c.createdAt)}
            </div>
            {c.sync.error && <div className="small mt8" style={{ color: 'var(--danger)' }}>{c.sync.error}</div>}
          </div>
          <div className="col" style={{ alignItems: 'flex-end' }}>
            <div className="row wrap">
              <button className="btn sm" onClick={() => setEdit(true)}><Pencil size={15} /> עריכה</button>
              <button className="btn sm" onClick={async () => { const s = await pushCustomer(c); toast[s.status === 'synced' ? 'success' : 'info'](s.status === 'synced' ? 'הלקוח סונכרן ל-Priority' : s.status === 'error' ? `שגיאה: ${s.error}` : 'נכנס לתור הסנכרון') }}><RefreshCw size={15} /> סנכרון</button>
              <button className="btn sm primary" onClick={() => nav('/cases/new')}><FolderPlus size={15} /> תיק חדש</button>
            </div>
            <QuickContact phone={c.phone} address={c.addresses[0]} whatsapp={() => setMsg(`שלום ${c.name.replace(/^משפחת /, '')}, `)} />
          </div>
        </div>
      </Card>

      <div className="grid g4">
        <div className="card stat"><div className="grow"><div className="lbl">תיקים</div><div className="val">{cases.length}</div></div></div>
        <div className="card stat"><div className="grow"><div className="lbl">הכנסה מאושרת</div><div className="val">{money(revenue)}</div></div></div>
        <div className="card stat"><div className="grow"><div className="lbl">יחידות מותקנות</div><div className="val">{units.length}</div></div></div>
        <div className="card stat"><div className="grow"><div className="lbl">קריאות שירות</div><div className="val">{calls.length}</div></div></div>
      </div>

      <div className="grid g-side">
        <div className="col" style={{ gap: 16 }}>
          <Card title="תיקים">
            {cases.length === 0 ? <Empty title="אין תיקים" /> : (
              <div className="list">
                {cases.map((k) => (
                  <Link key={k.id} to={`/cases/${k.id}`} className="list-item">
                    <div className="grow">
                      <div className="small strong">{k.title}</div>
                      <div className="tiny muted">{k.number} · {date(k.createdAt)}{k.payerCustomerId === c.id && k.customerId !== c.id ? ' · כלקוח משלם' : ''}</div>
                    </div>
                    <Badge tone={stageTone[k.stage]} dot>{stageLabel[k.stage]}</Badge>
                  </Link>
                ))}
              </div>
            )}
          </Card>
          <Card title={<div className="row"><ShieldCheck size={17} color="var(--success)" /><h2>יחידות מותקנות ואחריות</h2></div>}>
            {units.length === 0 ? <Empty title="אין יחידות רשומות" /> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>דגם</th><th>מיקום</th><th className="hide-mobile">מספר סידורי</th><th>הותקן</th><th>אחריות עד</th><th className="hide-mobile">טיפול הבא</th></tr></thead>
                  <tbody>
                    {units.map((u) => {
                      const left = daysBetween(new Date(), u.warrantyUntil)
                      return (
                        <tr key={u.id}>
                          <td className="small strong">{u.model}</td>
                          <td className="small">{u.location ?? '—'}</td>
                          <td className="tiny num hide-mobile"><span className="ltr">{u.serial}</span></td>
                          <td className="small">{date(u.installedAt)}</td>
                          <td><Badge tone={left < 0 ? 'muted' : left < 60 ? 'warning' : 'success'}>{left < 0 ? 'הסתיימה' : date(u.warrantyUntil)}</Badge></td>
                          <td className="small hide-mobile">{date(u.nextServiceAt)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <Card title={<div className="row"><Wrench size={17} /><h2>קריאות שירות</h2></div>} actions={<Link className="btn sm" to="/service">קריאה חדשה</Link>}>
            {calls.length === 0 ? <Empty title="אין קריאות שירות" /> : (
              <div className="list">
                {calls.map((s) => (
                  <Link key={s.id} to={`/service/${s.id}`} className="list-item">
                    <div className="grow">
                      <div className="small strong">{s.description}</div>
                      <div className="tiny muted">{s.number} · {relative(s.createdAt)}{s.underWarranty ? ' · באחריות' : ''}</div>
                    </div>
                    <Badge tone={serviceStatusTone[s.status]}>{serviceStatusLabel[s.status]}</Badge>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>
        <div className="col" style={{ gap: 16 }}>
          <Card title="כתובות" pad>
            <div className="col" style={{ gap: 8 }}>
              {c.addresses.length === 0 && <div className="small muted">אין כתובות</div>}
              {c.addresses.map((a) => (
                <div key={a.id} className="small">{a.label && <b>{a.label}: </b>}{addressText(a)}{a.floor ? `, קומה ${a.floor}` : ''}{a.apartment ? `, דירה ${a.apartment}` : ''}</div>
              ))}
            </div>
          </Card>
          <Card title="אנשי קשר" pad>
            <div className="col" style={{ gap: 8 }}>
              {contacts.map((x) => (
                <div key={x.id} className="small">{x.name}{x.role ? ` · ${x.role}` : ''} · <span className="ltr">{phone(x.phone)}</span> {x.primary && <Badge tone="brand">ראשי</Badge>}</div>
              ))}
            </div>
          </Card>
          <Card title="חוזי שירות" actions={<Link className="btn sm ghost" to="/contracts">לכל החוזים</Link>}>
            {contracts.length === 0 ? <Empty title="אין חוזה שירות">כדאי להציע טיפול תקופתי</Empty> : (
              <div className="list">
                {contracts.map((k) => (
                  <div key={k.id} className="list-item">
                    <div className="grow">
                      <div className="small strong">{k.title}</div>
                      <div className="tiny muted">{contractTypeLabel[k.type]} · ביקור הבא {date(k.nextVisit)} · {money(k.pricePerYear)} לשנה</div>
                    </div>
                    <Badge tone={k.status === 'active' ? 'success' : k.status === 'expiring' ? 'warning' : 'muted'}>{k.status === 'active' ? 'פעיל' : k.status === 'expiring' ? 'מסתיים' : 'לא פעיל'}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card title="הודעות אחרונות">
            {msgs.length === 0 ? <Empty title="אין הודעות" /> : (
              <div className="list">
                {msgs.slice(0, 6).map((m) => (
                  <div key={m.id} className="list-item">
                    <MessageCircle size={15} color={m.direction === 'in' ? 'var(--success)' : 'var(--text-3)'} />
                    <div className="grow">
                      <div className="small truncate">{m.body.replace('{portal}', '🔗')}</div>
                      <div className="tiny muted">{m.direction === 'in' ? 'מהלקוח' : 'אל הלקוח'} · {relative(m.at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {edit && (
        <Modal title="עריכת לקוח" onClose={() => setEdit(false)} footer={<button className="btn primary" onClick={() => setEdit(false)}>סגירה</button>}>
          <div className="grid g2">
            <Field label="שם"><input className="input" value={c.name} onChange={(e) => patch('customers', c.id, { name: e.target.value })} /></Field>
            <Field label="טלפון"><input className="input ltr" value={c.phone} onChange={(e) => patch('customers', c.id, { phone: e.target.value })} /></Field>
            <Field label="אימייל"><input className="input ltr" value={c.email ?? ''} onChange={(e) => patch('customers', c.id, { email: e.target.value })} /></Field>
            <Field label="ת״ז / ח״פ" hint="חסר? Priority לא יפתח את הלקוח"><input className="input" value={c.idNumber ?? ''} onChange={(e) => patch('customers', c.id, { idNumber: e.target.value })} /></Field>
          </div>
          <Field label="הערות" className="mt12"><textarea className="textarea" value={c.notes ?? ''} onChange={(e) => patch('customers', c.id, { notes: e.target.value })} /></Field>
        </Modal>
      )}
      {msg && (
        <Modal title="הודעה בוואטסאפ" onClose={() => setMsg('')} footer={<button className="btn wa" onClick={() => { void sendMessage({ to: c.phone, body: msg, customerId: c.id }); setMsg('') }}>פתיחה בוואטסאפ</button>}>
          <textarea className="textarea" style={{ minHeight: 120 }} value={msg} onChange={(e) => setMsg(e.target.value)} />
        </Modal>
      )}
    </div>
  )
}
