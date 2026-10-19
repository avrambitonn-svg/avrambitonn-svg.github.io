import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { BellRing, MessageCircle, Plus, Send, Trash2 } from 'lucide-react'
import { useApp } from '../../lib/store'
import { Badge, Card, Empty, Field, Modal, Stat, toast } from '../../components/ui'
import { planStatusLabel, planStatusTone } from '../../lib/labels'
import { daysBetween, date, money, phone, uid } from '../../lib/format'
import { totals } from '../../lib/quote'
import { createCase, createCustomer, createQuote, markQuoteSent } from '../../lib/actions'
import { portalUrl, whatsappLink } from '../../lib/integrations/links'
import { fill, sendMessage, templates } from '../../lib/messaging'
import { planColor, upgradesValue } from './ProjectsPage'
import type { Apartment, ApartmentPlanStatus, BuildingProject, QuoteLine } from '../../lib/types'

export default function ProjectPage() {
  const { id } = useParams()
  const db = useApp((s) => s.db)
  const p = db.projects.find((x) => x.id === id)
  const [aptId, setAptId] = useState<string | null>(null)
  const [remind, setRemind] = useState(false)
  const [building, setBuilding] = useState('')

  const floors = useMemo(() => {
    if (!p) return []
    const list = p.apartments.filter((a) => !building || a.building === building)
    const m = new Map<string, Apartment[]>()
    for (const a of list) {
      const key = `${a.building}-${a.floor}`
      m.set(key, [...(m.get(key) ?? []), a])
    }
    return [...m.entries()].sort((a, b) => b[1][0].floor - a[1][0].floor || a[0].localeCompare(b[0]))
  }, [p, building])

  if (!p) return <Card><Empty title="הפרויקט לא נמצא"><Link to="/projects">חזרה</Link></Empty></Card>
  const dev = db.customers.find((c) => c.id === p.developerId)
  const eng = db.users.find((u) => u.id === p.engineerId)
  const by = (s: ApartmentPlanStatus) => p.apartments.filter((a) => a.planStatus === s).length
  const left = daysBetween(new Date(), p.changesDeadline)
  const baseValue = totals({ lines: p.basePlanLines, discountPct: 0, vatPct: 0 }).net
  const buildings = [...new Set(p.apartments.map((a) => a.building))]
  const waiting = p.apartments.filter((a) => a.planStatus === 'base' && a.tenantPhone)
  const apt = p.apartments.find((a) => a.id === aptId)

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card>
        <div className="card-body row between wrap">
          <div>
            <h1>{p.name}</h1>
            <div className="small muted mt8">יזם: <Link to={`/customers/${dev?.id}`}>{dev?.name}</Link> · {p.address}, {p.city}{eng ? ` · מהנדס: ${eng.name}` : ''}</div>
          </div>
          <div className="row wrap">
            <Badge tone={left < 0 ? 'muted' : left <= 7 ? 'danger' : 'brand'}>{left < 0 ? 'השינויים ננעלו' : `נשארו ${left} ימים לשינויים (עד ${date(p.changesDeadline)})`}</Badge>
            <button className="btn sm" onClick={() => setRemind(true)} disabled={!waiting.length}><BellRing size={15} /> תזכורת לדיירים ({waiting.length})</button>
          </div>
        </div>
      </Card>

      <div className="grid g4">
        <Stat icon={<span className="strong">{p.totalApartments}</span>} label="דירות בפרויקט" value={p.apartments.length} delta="במערכת" />
        <Stat icon={<MessageCircle size={20} />} tone="warning" label="ביקשו שינוי / קיבלו הצעה" value={by('requested') + by('quoted')} />
        <Stat icon={<Send size={20} />} tone="success" label="אישרו שינוי" value={by('approved') + by('installed')} />
        <Stat icon={<span className="strong">₪</span>} tone="violet" label="הכנסה משדרוגים" value={money(upgradesValue(p))} delta={baseValue ? `בסיס: ${money(baseValue)} לדירה` : undefined} />
      </div>

      <div className="grid g-side">
        <Card
          title="דירות"
          actions={
            buildings.length > 1 && (
              <div className="row">
                <button className={`chip ${building === '' ? 'on' : ''}`} onClick={() => setBuilding('')}>הכל</button>
                {buildings.map((b) => <button key={b} className={`chip ${building === b ? 'on' : ''}`} onClick={() => setBuilding(b)}>בניין {b}</button>)}
              </div>
            )
          }
        >
          <div className="card-body col" style={{ gap: 8 }}>
            {floors.map(([key, apts]) => (
              <div key={key} className="row" style={{ alignItems: 'stretch' }}>
                <div className="tiny muted" style={{ width: 64, paddingTop: 10 }}>{buildings.length > 1 ? `${apts[0].building} · ` : ''}קומה {apts[0].floor}</div>
                <div className="grow" style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(apts.length, 2)}, minmax(0, 1fr))`, gap: 8 }}>
                  {apts.map((a) => (
                    <button key={a.id} onClick={() => setAptId(a.id)} className="card" style={{ padding: '8px 10px', textAlign: 'start', cursor: 'pointer', borderInlineStart: `5px solid ${planColor[a.planStatus]}`, boxShadow: 'none' }}>
                      <div className="row between"><b className="small">דירה {a.number}</b><span className="tiny muted">{a.rooms} חד׳</span></div>
                      <div className="tiny truncate">{a.tenantName ?? 'טרם נמסר דייר'}</div>
                      <div className="tiny muted">{planStatusLabel[a.planStatus]}{a.upgrades.length ? ` · ${money(totals({ lines: a.upgrades, discountPct: 0, vatPct: 0 }).net)}` : ''}</div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
        <div className="col" style={{ gap: 16 }}>
          <Card title="תוכנית הבסיס" pad>
            <p className="small">{p.basePlan}</p>
            {p.basePlanLines.length > 0 && (
              <div className="mt12 col" style={{ gap: 4 }}>
                {p.basePlanLines.map((l) => <div key={l.id} className="row between small"><span>{l.qty} × {l.description}</span><span className="num">{money(l.qty * l.unitPrice)}</span></div>)}
              </div>
            )}
          </Card>
          <Card title="איך זה עובד" pad>
            <ol className="small" style={{ margin: 0, paddingInlineStart: 18, lineHeight: 1.8 }}>
              <li>היזם מעביר רשימת דיירים, וכל דייר מקבל קישור אישי.</li>
              <li>הדייר מבקש שינוי, והסוכן בונה לו הצעה מהקטלוג.</li>
              <li>הדייר מאשר וחותם באזור האישי, ומשלם ישירות.</li>
              <li>המהנדס מקבל רשימה מסודרת של שינויים לביצוע לפי דירה.</li>
            </ol>
          </Card>
        </div>
      </div>

      {apt && <ApartmentDialog project={p} apt={apt} onClose={() => setAptId(null)} />}
      {remind && (
        <Modal title="תזכורת לדיירים שעוד לא בחרו" onClose={() => setRemind(false)}>
          <p className="small muted mb12">וואטסאפ לא מאפשר שליחה מרוכזת בלחיצה, אז כל שורה נפתחת בנפרד. עם WhatsApp Business API השליחה אוטומטית.</p>
          <div className="list">
            {waiting.map((a) => {
              const text = `שלום ${a.tenantName ?? ''}, כאן ${'ג׳נאייר'} — חברת המיזוג של ${p.name}. אפשר לבקש שינויים בתוכנית המיזוג של הדירה עד ${date(p.changesDeadline)}. לשאלות ולבקשות פשוט עונים להודעה הזו.`
              return (
                <div key={a.id} className="list-item">
                  <div className="grow"><div className="small strong">דירה {a.number} · {a.tenantName}</div><div className="tiny muted"><span className="ltr">{phone(a.tenantPhone)}</span></div></div>
                  <a className="btn sm wa" href={whatsappLink(a.tenantPhone!, text)} target="_blank" rel="noreferrer"><MessageCircle size={15} /> שליחה</a>
                </div>
              )
            })}
          </div>
        </Modal>
      )}
    </div>
  )
}

function ApartmentDialog({ project, apt, onClose }: { project: BuildingProject; apt: Apartment; onClose: () => void }) {
  const db = useApp((s) => s.db)
  const patch = useApp((s) => s.patch)
  const upsert = useApp((s) => s.upsert)
  const [a, setA] = useState<Apartment>(apt)
  const [itemId, setItemId] = useState('')
  const [qty, setQty] = useState(1)
  const [room, setRoom] = useState('')
  const sum = totals({ lines: a.upgrades, discountPct: 0, vatPct: db.quotes[0]?.vatPct ?? 18 })
  const kase = db.cases.find((k) => k.id === a.caseId)
  const save = (next: Apartment) => patch('projects', project.id, { apartments: project.apartments.map((x) => (x.id === next.id ? next : x)) })

  function sendQuote() {
    if (!a.upgrades.length) return
    let caseId = a.caseId
    let custPhone = a.tenantPhone
    let custId: string | undefined
    if (!caseId) {
      const tenant = createCustomer({ name: a.tenantName || `דייר דירה ${a.number}`, phone: a.tenantPhone || '', type: 'private', addresses: [{ id: uid('ad'), city: project.city, street: project.address, apartment: a.number, floor: String(a.floor) }] })
      upsert('contacts', { id: uid('ct'), customerId: tenant.id, name: tenant.name, phone: tenant.phone, primary: true })
      const k = createCase({
        title: `${project.name} — דירה ${a.number} (שינוי דייר)`, customerId: tenant.id, payerCustomerId: undefined, contactIds: [], addressId: tenant.addresses[0].id,
        projectType: 'residential_building', source: 'other', priority: 'normal', agentId: undefined, engineerId: project.engineerId, buildingProjectId: project.id, apartmentId: a.id, managerId: undefined,
      })
      caseId = k.id
      custId = tenant.id
    } else {
      custId = db.cases.find((k) => k.id === caseId)?.customerId
      custPhone = db.customers.find((c) => c.id === custId)?.phone ?? custPhone
    }
    const q = createQuote(caseId, a.upgrades.map((l) => ({ ...l, id: uid('ln') })), { notes: `שינויים לדירה ${a.number} מעבר לתוכנית הבסיס של ${project.name}` })
    markQuoteSent(q.id)
    const next = { ...a, caseId, planStatus: 'quoted' as const }
    setA(next)
    save(next)
    const k = useApp.getState().db.cases.find((x) => x.id === caseId)!
    if (custPhone) void sendMessage({ to: custPhone, body: fill(templates.quote.text, { name: a.tenantName ?? '', portal: portalUrl(k.portal.token) }), caseId, customerId: custId, templateKey: 'quote' })
    toast.success('ההצעה נוצרה ונשלחה לדייר')
  }

  return (
    <Modal title={`דירה ${a.number} · קומה ${a.floor}`} size="wide" onClose={() => { save(a); onClose() }} footer={
      <>
        {kase && <Link className="btn" to={`/cases/${kase.id}`}>לתיק הדייר</Link>}
        <button className="btn" onClick={() => { save(a); toast.success('נשמר'); onClose() }}>שמירה</button>
        <button className="btn primary" disabled={!a.upgrades.length || !a.tenantPhone} onClick={sendQuote}><Send size={15} /> שליחת הצעה לדייר</button>
      </>
    }>
      <div className="grid g3">
        <Field label="שם הדייר"><input className="input" value={a.tenantName ?? ''} onChange={(e) => setA({ ...a, tenantName: e.target.value })} /></Field>
        <Field label="טלפון"><input className="input ltr" value={a.tenantPhone ?? ''} onChange={(e) => setA({ ...a, tenantPhone: e.target.value })} /></Field>
        <Field label="סטטוס">
          <select className="select" value={a.planStatus} onChange={(e) => setA({ ...a, planStatus: e.target.value as ApartmentPlanStatus })}>
            {(Object.keys(planStatusLabel) as ApartmentPlanStatus[]).map((s) => <option key={s} value={s}>{planStatusLabel[s]}</option>)}
          </select>
        </Field>
      </div>
      <div className="row between mt16 mb8"><b>שינויים מעבר לתוכנית הבסיס</b><Badge tone={planStatusTone[a.planStatus]}>{planStatusLabel[a.planStatus]}</Badge></div>
      {a.upgrades.length === 0 ? <div className="small muted mb12">הדייר נשאר בתוכנית הבסיס</div> : (
        <table className="table">
          <thead><tr><th>פריט</th><th>חדר</th><th>כמות</th><th className="end">סה״כ</th><th /></tr></thead>
          <tbody>
            {a.upgrades.map((l) => (
              <tr key={l.id}>
                <td className="small">{l.description}</td>
                <td className="small">{l.room ?? '—'}</td>
                <td className="small num">{l.qty}</td>
                <td className="end small num">{money(l.qty * l.unitPrice)}</td>
                <td><button className="icon-btn" onClick={() => setA({ ...a, upgrades: a.upgrades.filter((x) => x.id !== l.id) })}><Trash2 size={15} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="row wrap mt12" style={{ alignItems: 'flex-end' }}>
        <Field label="הוספת פריט" className="grow">
          <select className="select" value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="">בחירה מהקטלוג...</option>
            {db.catalog.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name} · {money(c.price)}</option>)}
          </select>
        </Field>
        <Field label="חדר"><input className="input" style={{ width: 110 }} value={room} onChange={(e) => setRoom(e.target.value)} placeholder="ממ״ד..." /></Field>
        <Field label="כמות"><input className="input" style={{ width: 70 }} type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} /></Field>
        <button className="btn" disabled={!itemId} onClick={() => {
          const it = db.catalog.find((c) => c.id === itemId)!
          const line: QuoteLine = { id: uid('ln'), itemId: it.id, description: it.name, qty, unit: it.unit, unitPrice: it.price, room: room || undefined }
          setA({ ...a, upgrades: [...a.upgrades, line], planStatus: a.planStatus === 'base' ? 'requested' : a.planStatus })
          setItemId(''); setRoom(''); setQty(1)
        }}><Plus size={15} /> הוספה</button>
      </div>
      {a.upgrades.length > 0 && <div className="row between mt16"><span className="muted small">סה״כ לתשלום הדייר (כולל מע״מ)</span><b className="num" style={{ fontSize: 18 }}>{money(sum.total)}</b></div>}
      {!a.tenantPhone && <div className="tiny mt8" style={{ color: 'var(--warning)' }}>כדי לשלוח הצעה צריך טלפון של הדייר</div>}
    </Modal>
  )
}
