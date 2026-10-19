import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Building2, Plus } from 'lucide-react'
import { useApp } from '../../lib/store'
import { Badge, Card, Empty, Field, Modal, PageHead } from '../../components/ui'
import { planStatusLabel } from '../../lib/labels'
import { daysBetween, date, money, nowIso, uid, ymd, addDays } from '../../lib/format'
import { totals } from '../../lib/quote'
import type { Apartment, ApartmentPlanStatus, BuildingProject } from '../../lib/types'

export const planColor: Record<ApartmentPlanStatus, string> = {
  base: '#e2e8f0',
  requested: '#bae6fd',
  quoted: '#7dd3fc',
  approved: '#4ade80',
  installed: '#16a34a',
}

export function upgradesValue(p: BuildingProject) {
  return p.apartments.filter((a) => a.planStatus === 'approved' || a.planStatus === 'installed').reduce((s, a) => s + totals({ lines: a.upgrades, discountPct: 0, vatPct: 0 }).net, 0)
}

export default function ProjectsPage() {
  const db = useApp((s) => s.db)
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  return (
    <div>
      <PageHead
        title="בנייה רוויה"
        sub="פרויקטים של יזמים, ומחלקת שינויי דיירים: לכל דייר תוכנית אישית ומדויקת"
        actions={<button className="btn primary" onClick={() => setOpen(true)}><Plus size={17} /> פרויקט חדש</button>}
      />
      {db.projects.length === 0 && <Card><Empty icon={<Building2 size={36} />} title="אין פרויקטים" /></Card>}
      <div className="grid g2">
        {db.projects.map((p) => {
          const dev = db.customers.find((c) => c.id === p.developerId)
          const by = (s: ApartmentPlanStatus) => p.apartments.filter((a) => a.planStatus === s).length
          const left = daysBetween(new Date(), p.changesDeadline)
          return (
            <Card key={p.id} onClick={() => nav(`/projects/${p.id}`)}>
              <div className="card-body">
                <div className="row between">
                  <div>
                    <h2>{p.name}</h2>
                    <div className="small muted">{dev?.name} · {p.address}</div>
                  </div>
                  <Badge tone={left < 0 ? 'muted' : left <= 7 ? 'danger' : 'brand'}>{left < 0 ? 'מועד השינויים עבר' : `${left} ימים לסיום שינויים`}</Badge>
                </div>
                <div className="row mt16" style={{ gap: 2, height: 10, borderRadius: 6, overflow: 'hidden' }}>
                  {(Object.keys(planColor) as ApartmentPlanStatus[]).map((s) => by(s) > 0 && <div key={s} style={{ flex: by(s), background: planColor[s] }} title={`${planStatusLabel[s]}: ${by(s)}`} />)}
                </div>
                <div className="row wrap mt12 small" style={{ gap: 14 }}>
                  {(Object.keys(planColor) as ApartmentPlanStatus[]).map((s) => (
                    <span key={s} className="row" style={{ gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: planColor[s] }} />{planStatusLabel[s]} {by(s)}</span>
                  ))}
                </div>
                <div className="row between mt16">
                  <span className="small muted">{p.apartments.length} מתוך {p.totalApartments} דירות במערכת</span>
                  <span className="small">שדרוגים מאושרים: <b className="num">{money(upgradesValue(p))}</b></span>
                </div>
              </div>
            </Card>
          )
        })}
      </div>
      {open && <NewProject onClose={() => setOpen(false)} onCreated={(id) => nav(`/projects/${id}`)} />}
      <p className="tiny muted mt16">טיפ: כל פרויקט רגיל של היזם (סקר, הצעה, ביצוע) מנוהל כתיק <Link to="/cases">בתיקים</Link>; כאן מנוהלים השינויים לכל דייר.</p>
    </div>
  )
}

function NewProject({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const db = useApp((s) => s.db)
  const upsert = useApp((s) => s.upsert)
  const devs = db.customers.filter((c) => c.type === 'developer' || c.type === 'business')
  const [f, setF] = useState({ name: '', developerId: devs[0]?.id ?? '', city: 'ירושלים', address: '', buildings: 1, floors: 8, perFloor: 4, basePlan: 'מיני מרכזי לכל דירה, כולל הכנה לחדר שינה ראשי.', deadline: ymd(addDays(new Date(), 45)) })
  return (
    <Modal
      title="פרויקט בנייה רוויה חדש"
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>ביטול</button><button className="btn primary" disabled={!f.name || !f.developerId} onClick={() => {
        const apartments: Apartment[] = []
        let n = 1
        for (let b = 0; b < f.buildings; b++)
          for (let fl = 1; fl <= f.floors; fl++)
            for (let i = 0; i < f.perFloor; i++) apartments.push({ id: uid('apt'), building: String.fromCharCode(65 + b), floor: fl, number: String(n++), rooms: 4, planStatus: 'base', upgrades: [] })
        const p: BuildingProject = {
          id: uid('p'), name: f.name, developerId: f.developerId, city: f.city, address: f.address, totalApartments: apartments.length, basePlan: f.basePlan, basePlanLines: [],
          changesDeadline: f.deadline, stage: 'tenant_changes', apartments, createdAt: nowIso(),
        }
        upsert('projects', p)
        onCreated(p.id)
      }}>יצירה</button></>}
    >
      <div className="grid g2">
        <Field label="שם הפרויקט"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="מגדלי הנוף — שלב א׳" /></Field>
        <Field label="יזם">
          <select className="select" value={f.developerId} onChange={(e) => setF({ ...f, developerId: e.target.value })}>
            {devs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="עיר"><input className="input" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
        <Field label="כתובת / מתחם"><input className="input" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <Field label="בניינים"><input className="input" type="number" min={1} value={f.buildings} onChange={(e) => setF({ ...f, buildings: Number(e.target.value) })} /></Field>
        <Field label="קומות"><input className="input" type="number" min={1} value={f.floors} onChange={(e) => setF({ ...f, floors: Number(e.target.value) })} /></Field>
        <Field label="דירות בקומה"><input className="input" type="number" min={1} value={f.perFloor} onChange={(e) => setF({ ...f, perFloor: Number(e.target.value) })} /></Field>
        <Field label="מועד אחרון לשינויים"><input className="input" type="date" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} /></Field>
      </div>
      <Field label="תוכנית הבסיס" className="mt12"><textarea className="textarea" value={f.basePlan} onChange={(e) => setF({ ...f, basePlan: e.target.value })} /></Field>
      <div className="tiny muted mt8">ייווצרו {f.buildings * f.floors * f.perFloor} דירות. את שמות הדיירים מוסיפים כשהם מתקבלים מהיזם. בתאריך {date(f.deadline)} השינויים ננעלים.</div>
    </Modal>
  )
}
