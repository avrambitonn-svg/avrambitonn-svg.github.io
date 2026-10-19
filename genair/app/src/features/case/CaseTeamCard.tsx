// צוות התיק: סוכן, מהנדס, מנהל, מנהלי מחלקה, מנהל פרויקט, מתקינים. עריכה שולחת התראה למי שצורף
import { useMemo, useState } from 'react'
import { Pencil } from 'lucide-react'
import { useApp } from '../../lib/store'
import { Avatar, Card, Field, Modal, toast } from '../../components/ui'
import { roleLabel } from '../../lib/labels'
import { nowIso } from '../../lib/format'
import type { Case, ID, User } from '../../lib/types'
import '../ops/ops.css'
import './case.css'

type Slot = { key: string; label: string; ids: ID[] }

function slots(k: Case): Slot[] {
  return [
    { key: 'agent', label: 'סוכן', ids: k.agentId ? [k.agentId] : [] },
    { key: 'engineer', label: 'מהנדס', ids: k.engineerId ? [k.engineerId] : [] },
    { key: 'manager', label: 'מנהל התיק', ids: k.managerId ? [k.managerId] : [] },
    { key: 'dept', label: 'מנהל מחלקה', ids: k.departmentManagerIds ?? [] },
    { key: 'pm', label: 'מנהל פרויקט', ids: k.projectManagerId ? [k.projectManagerId] : [] },
    { key: 'inst', label: 'מתקין', ids: k.installerIds },
  ]
}

export function CaseTeamCard({ caseId }: { caseId: ID }) {
  const k = useApp((s) => s.db.cases.find((x) => x.id === caseId))
  const users = useApp((s) => s.db.users)
  const [edit, setEdit] = useState(false)
  if (!k) return null
  // אדם אחד יכול למלא כמה תפקידים: שורה אחת עם כל התפקידים שלו
  const rows = new Map<ID, string[]>()
  slots(k).forEach((s) => s.ids.forEach((id) => rows.set(id, [...(rows.get(id) ?? []), s.label])))
  const people = [...rows.entries()].map(([id, roles]) => ({ u: users.find((x) => x.id === id), roles })).filter((x) => x.u) as { u: User; roles: string[] }[]
  return (
    <Card title="צוות" actions={<button className="btn sm ghost" onClick={() => setEdit(true)}><Pencil size={14} /> עריכה</button>} pad>
      <div className="col" style={{ gap: 8 }}>
        {!k.agentId && <div className="tiny muted">ללא סוכן: ההנהלה ומנהל הפרויקט אחראים</div>}
        {people.length === 0 && <div className="small muted">לא שובץ צוות</div>}
        {people.map(({ u, roles }) => (
          <div key={u.id} className="row">
            <Avatar user={u} />
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="small strong">{u.name}</div>
              <div className="tiny muted">{roles.join(' · ')}{!u.active ? ' · לא פעיל' : ''}</div>
            </div>
          </div>
        ))}
      </div>
      {edit && <TeamDialog k={k} onClose={() => setEdit(false)} />}
    </Card>
  )
}

function TeamDialog({ k, onClose }: { k: Case; onClose: () => void }) {
  const users = useApp((s) => s.db.users)
  const patch = useApp((s) => s.patch)
  const notify = useApp((s) => s.notify)
  const log = useApp((s) => s.log)
  const me = useApp((s) => s.currentUserId)
  const [agentId, setAgentId] = useState(k.agentId ?? '')
  const [engineerId, setEngineerId] = useState(k.engineerId ?? '')
  const [managerId, setManagerId] = useState(k.managerId ?? '')
  const [dept, setDept] = useState<ID[]>(k.departmentManagerIds ?? [])
  const [pm, setPm] = useState(k.projectManagerId ?? '')
  const [inst, setInst] = useState<ID[]>(k.installerIds)
  const active = useMemo(() => users.filter((u) => u.active), [users])
  const of = (roles: User['role'][], keep?: ID) => active.filter((u) => roles.includes(u.role) || u.id === keep)
  const fnFirst = (f: 'department_manager' | 'project_manager') => [...active.filter((u) => u.functions?.includes(f)), ...active.filter((u) => !u.functions?.includes(f))]

  const save = () => {
    const next: Partial<Case> = {
      agentId: agentId || undefined, engineerId: engineerId || undefined, managerId: managerId || undefined,
      departmentManagerIds: dept.length ? dept : undefined, projectManagerId: pm || undefined, installerIds: inst, updatedAt: nowIso(),
    }
    const before = slots(k)
    const after = slots({ ...k, ...next })
    const added: { id: ID; label: string }[] = []
    after.forEach((s) => s.ids.forEach((id) => { if (!before.find((b) => b.key === s.key)?.ids.includes(id)) added.push({ id, label: s.label }) }))
    patch('cases', k.id, next)
    const name = (id: ID) => users.find((u) => u.id === id)?.name ?? ''
    if (added.length) log({ kind: 'note', caseId: k.id, text: `הצוות עודכן: ${added.map((a) => `${name(a.id)} (${a.label})`).join(', ')}` })
    else log({ kind: 'note', caseId: k.id, text: 'הצוות עודכן' })
    // התראה לכל מי שצורף (פעם אחת לאדם, עם כל התפקידים החדשים שלו)
    const byUser = new Map<ID, string[]>()
    added.forEach((a) => byUser.set(a.id, [...(byUser.get(a.id) ?? []), a.label]))
    byUser.forEach((labels, id) => id !== me && notify(id, `צורפת לתיק ${k.title} (${labels.join(', ')})`, `/cases/${k.id}`))
    toast.success(byUser.size ? `הצוות עודכן, ${byUser.size} קיבלו התראה` : 'הצוות עודכן')
    onClose()
  }

  return (
    <Modal title="צוות התיק" size="wide" onClose={onClose} footer={<><button className="btn" onClick={onClose}>ביטול</button><button className="btn primary" onClick={save}>שמירה</button></>}>
      <div className="col" style={{ gap: 16 }}>
        <div className="grid g3">
          <Field label="סוכן">
            <select className="select" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              <option value="">ללא סוכן (ההנהלה / מנהל הפרויקט אחראים)</option>
              {of(['agent', 'admin'], k.agentId).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
          <Field label="מהנדס">
            <select className="select" value={engineerId} onChange={(e) => setEngineerId(e.target.value)}>
              <option value="">ללא</option>
              {of(['engineer'], k.engineerId).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
          <Field label="מנהל התיק במשרד">
            <select className="select" value={managerId} onChange={(e) => setManagerId(e.target.value)}>
              <option value="">ללא</option>
              {of(['office', 'admin'], k.managerId).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
          <Field label="מנהל פרויקט">
            <select className="select" value={pm} onChange={(e) => setPm(e.target.value)}>
              <option value="">ללא</option>
              {fnFirst('project_manager').map((u) => <option key={u.id} value={u.id}>{u.name}{u.functions?.includes('project_manager') ? ' · מנהל פרויקטים' : ` · ${roleLabel[u.role]}`}</option>)}
            </select>
          </Field>
        </div>
        <div>
          <div className="label mb8">מנהלי מחלקה <span className="tiny muted">(כולם מקבלים את משימות התיק)</span></div>
          <PickUsers value={dept} set={setDept} pool={fnFirst('department_manager').filter((u) => u.role !== 'installer' || dept.includes(u.id))} hint={(u) => `${u.functions?.includes('department_manager') ? 'מנהל מחלקה · ' : ''}${u.title || roleLabel[u.role]}`} />
        </div>
        <div>
          <div className="label mb8">מתקינים</div>
          <PickUsers value={inst} set={setInst} pool={of(['installer']).concat(active.filter((u) => u.role !== 'installer' && inst.includes(u.id)))} />
        </div>
      </div>
    </Modal>
  )
}

function PickUsers({ value, set, pool, hint }: { value: ID[]; set: (v: ID[]) => void; pool: User[]; hint?: (u: User) => string }) {
  return (
    <div className="pick-list">
      {pool.map((u) => {
        const on = value.includes(u.id)
        return (
          <button key={u.id} type="button" className={`pick-user ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => set(on ? value.filter((x) => x !== u.id) : [...value, u.id])}>
            <span className={`tick ${on ? 'on' : ''}`}>✓</span>
            <span className="grow" style={{ textAlign: 'start', minWidth: 0 }}>
              <span className="small strong" style={{ display: 'block' }}>{u.name}</span>
              <span className="tiny muted">{hint?.(u) ?? (u.title || roleLabel[u.role])}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
