import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Columns3, List, Plus, Sparkles } from 'lucide-react'
import { useApp, useMe } from '../../lib/store'
import { Avatar, Badge, Card, Empty, PageHead } from '../../components/ui'
import { pipeline, projectTypeLabel, stageLabel, stageTone, syncTone, syncLabel } from '../../lib/labels'
import { daysBetween, money, relative } from '../../lib/format'
import { totals } from '../../lib/quote'
import { setStage } from '../../lib/actions'
import type { Case, CaseStage, ProjectType, Quote } from '../../lib/types'

const updatedText = (d: number) => (d <= 0 ? 'עודכן היום' : d === 1 ? 'עודכן אתמול' : `עודכן לפני ${d} ימים`)

export default function CasesPage() {
  const db = useApp((s) => s.db)
  const me = useMe()
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const [view, setView] = useState<'board' | 'table'>(() => (window.innerWidth < 700 ? 'table' : 'board'))
  const [q, setQ] = useState('')
  const [agent, setAgent] = useState(me.role === 'agent' ? me.id : '')
  const [type, setType] = useState<ProjectType | ''>('')
  const [showDone, setShowDone] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overStage, setOverStage] = useState<CaseStage | null>(null)
  const stageFilter = params.get('stage') as CaseStage | null

  const latest = useMemo(() => {
    const m = new Map<string, Quote>()
    for (const x of db.quotes) {
      const cur = m.get(x.caseId)
      if (!cur || x.version > cur.version) m.set(x.caseId, x)
    }
    return m
  }, [db.quotes])

  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    return db.cases
      .filter((k) => showDone || !['closed', 'lost'].includes(k.stage))
      .filter((k) => !agent || k.agentId === agent)
      .filter((k) => !type || k.projectType === type)
      .filter((k) => !stageFilter || k.stage === stageFilter)
      .filter((k) => {
        if (!t) return true
        const c = db.customers.find((x) => x.id === k.customerId)
        return [k.title, k.number, c?.name, c?.phone].some((s) => s?.toLowerCase().includes(t))
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }, [db.cases, db.customers, q, agent, type, showDone, stageFilter])

  const stages: CaseStage[] = showDone ? [...pipeline, 'lost'] : pipeline.slice(0, 7)
  const agents = db.users.filter((u) => u.role === 'agent' || u.role === 'admin')
  const val = (k: Case) => {
    const x = latest.get(k.id)
    return x ? totals(x).net : 0
  }

  return (
    <div>
      <PageHead
        title="תיקים ופרויקטים"
        sub={`${list.length} תיקים · ${money(list.reduce((s, k) => s + val(k), 0))} בהצעות`}
        actions={
          <>
            <div className="row" style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 10, padding: 3 }}>
              <button className={`btn sm ${view === 'board' ? 'dark' : 'ghost'}`} onClick={() => setView('board')}><Columns3 size={15} /> לוח</button>
              <button className={`btn sm ${view === 'table' ? 'dark' : 'ghost'}`} onClick={() => setView('table')}><List size={15} /> טבלה</button>
            </div>
            <Link className="btn primary" to="/cases/new"><Plus size={17} /> תיק חדש</Link>
          </>
        }
      />

      <div className="row wrap mb16">
        <input className="input sm" style={{ maxWidth: 260 }} placeholder="חיפוש לפי שם, מספר או טלפון" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select sm" style={{ width: 'auto' }} value={agent} onChange={(e) => setAgent(e.target.value)}>
          <option value="">כל הסוכנים</option>
          {agents.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select className="select sm" style={{ width: 'auto' }} value={type} onChange={(e) => setType(e.target.value as ProjectType | '')}>
          <option value="">כל סוגי הפרויקטים</option>
          {Object.entries(projectTypeLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {stageFilter && (
          <button className="chip on" onClick={() => { params.delete('stage'); setParams(params) }}>
            {stageLabel[stageFilter]} ✕
          </button>
        )}
        <label className="check small">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> כולל סגורים
        </label>
      </div>

      {list.length === 0 && <Card><Empty title="לא נמצאו תיקים">נסו לשנות את הסינון</Empty></Card>}

      {list.length > 0 && view === 'board' && (
        <div className="kanban">
          {stages.map((st) => {
            const items = list.filter((k) => k.stage === st)
            return (
              <div
                key={st}
                className={`kcol ${overStage === st ? 'drop' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setOverStage(st) }}
                onDragLeave={() => setOverStage(null)}
                onDrop={() => {
                  if (dragId) setStage(dragId, st)
                  setDragId(null)
                  setOverStage(null)
                }}
              >
                <div className="kcol-head">
                  <span>{stageLabel[st]}</span>
                  <span className="badge muted">{items.length}</span>
                </div>
                {items.map((k) => {
                  const c = db.customers.find((x) => x.id === k.customerId)
                  const a = db.users.find((u) => u.id === k.agentId)
                  const qv = latest.get(k.id)
                  return (
                    <Link
                      key={k.id}
                      to={`/cases/${k.id}`}
                      className="kcard"
                      draggable
                      onDragStart={() => setDragId(k.id)}
                      onDragEnd={() => setDragId(null)}
                    >
                      <div className="row between">
                        <span className="tiny muted num">{k.number}</span>
                        {k.priority !== 'normal' && <Badge tone={k.priority === 'urgent' ? 'danger' : 'warning'}>{k.priority === 'urgent' ? 'דחוף' : 'עדיפות גבוהה'}</Badge>}
                      </div>
                      <div className="strong small" style={{ lineHeight: 1.35 }}>{k.title}</div>
                      <div className="tiny muted">{c?.name} · {projectTypeLabel[k.projectType]}</div>
                      <div className="row between mt8">
                        {qv ? <span className="small strong num" title="סכום ההצעה האחרונה, לפני מע״מ">{money(totals(qv).net)}</span> : <span className="tiny muted">אין עדיין הצעה</span>}
                        <span className="row" style={{ gap: 6 }}>
                          {qv?.ai && <span title="טיוטה מ-AI"><Sparkles size={14} color="var(--brand)" /></span>}
                          <span className="tiny muted" title="מתי התיק עודכן לאחרונה">{updatedText(daysBetween(k.updatedAt, new Date()))}</span>
                          {a && <Avatar user={a} />}
                        </span>
                      </div>
                    </Link>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}

      {list.length > 0 && view === 'table' && (
        <Card>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>תיק</th>
                  <th>לקוח</th>
                  <th className="hide-mobile">סוג</th>
                  <th>שלב</th>
                  <th className="hide-mobile">סוכן</th>
                  <th className="end">שווי</th>
                  <th className="hide-mobile">Priority</th>
                  <th className="hide-mobile">עדכון</th>
                </tr>
              </thead>
              <tbody>
                {list.map((k) => {
                  const c = db.customers.find((x) => x.id === k.customerId)
                  const a = db.users.find((u) => u.id === k.agentId)
                  return (
                    <tr key={k.id} className="click" onClick={() => nav(`/cases/${k.id}`)}>
                      <td>
                        <div className="strong small">{k.title}</div>
                        <div className="tiny muted num">{k.number}</div>
                      </td>
                      <td className="small">{c?.name}{c?.temp && <> <Badge tone="warning">זמני</Badge></>}</td>
                      <td className="small hide-mobile">{projectTypeLabel[k.projectType]}</td>
                      <td><Badge tone={stageTone[k.stage]} dot>{stageLabel[k.stage]}</Badge></td>
                      <td className="hide-mobile">{a ? <span className="row" style={{ gap: 6 }}><Avatar user={a} /><span className="small">{a.name}</span></span> : <span className="muted small">—</span>}</td>
                      <td className="end num small strong">{val(k) ? money(val(k)) : '—'}</td>
                      <td className="hide-mobile">{c && <Badge tone={syncTone[c.sync.status]}>{syncLabel[c.sync.status]}</Badge>}</td>
                      <td className="tiny muted hide-mobile nowrap">{relative(k.updatedAt)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
