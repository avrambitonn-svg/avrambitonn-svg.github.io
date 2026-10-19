import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CheckCircle2, ChevronLeft, Inbox, PackageX, Plus, Search, Timer, Wrench } from 'lucide-react'
import { Avatar, Badge, Card, Empty, PageHead, Stat } from '../../components/ui'
import { useApp } from '../../lib/store'
import type { ServiceCall, ServiceStatus } from '../../lib/types'
import { serviceStatusLabel, serviceStatusTone } from '../../lib/labels'
import { addDays, dateShortDay, relative, time as fmtTime } from '../../lib/format'
import { NewServiceCallDialog } from '../../features/ops/NewServiceCallDialog'
import { openStatuses, symptomLabel, urgencyLabel, urgencyTone } from '../../features/ops/ops'
import '../../features/ops/ops.css'

const allStatuses: ServiceStatus[] = ['new', 'assigned', 'scheduled', 'in_progress', 'waiting_parts', 'done', 'cancelled']
const urgRank: Record<ServiceCall['urgency'], number> = { urgent: 0, high: 1, normal: 2, low: 3 }
const urgColor: Record<ServiceCall['urgency'], string> = { urgent: 'var(--danger)', high: 'var(--warning)', normal: 'var(--brand)', low: '#c5cdd5' }

function hoursLabel(h: number) {
  if (!Number.isFinite(h)) return '—'
  if (h < 1) return 'פחות משעה'
  if (h < 48) return `${Math.round(h)} שעות`
  return `${Math.round(h / 24)} ימים`
}

export default function ServicePage() {
  const calls = useApp((s) => s.db.serviceCalls)
  const customers = useApp((s) => s.db.customers)
  const users = useApp((s) => s.db.users)
  const appts = useApp((s) => s.db.appointments)
  const nav = useNavigate()
  const [status, setStatus] = useState<'open' | 'all' | ServiceStatus>('open')
  const [urgency, setUrgency] = useState<'' | ServiceCall['urgency']>('')
  const [assignee, setAssignee] = useState('')
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)

  const visitOf = useMemo(() => {
    const m: Record<string, { start: string; done: boolean }[]> = {}
    appts.filter((a) => a.serviceCallId && a.status !== 'cancelled').forEach((a) => (m[a.serviceCallId!] ??= []).push({ start: a.start, done: a.status === 'done' }))
    Object.values(m).forEach((l) => l.sort((a, b) => a.start.localeCompare(b.start)))
    return m
  }, [appts])

  const stats = useMemo(() => {
    const weekAgo = addDays(new Date(), -7).toISOString()
    const resp = calls
      .filter((c) => c.status !== 'cancelled')
      .map((c) => {
        const first = visitOf[c.id]?.[0]?.start ?? c.closedAt
        return first ? (new Date(first).getTime() - new Date(c.createdAt).getTime()) / 3600_000 : NaN
      })
      .filter((h) => Number.isFinite(h) && h >= 0)
    return {
      new: calls.filter((c) => c.status === 'new').length,
      active: calls.filter((c) => ['assigned', 'scheduled', 'in_progress'].includes(c.status)).length,
      parts: calls.filter((c) => c.status === 'waiting_parts').length,
      doneWeek: calls.filter((c) => c.status === 'done' && c.closedAt && c.closedAt >= weekAgo).length,
      avg: resp.length ? resp.reduce((a, b) => a + b, 0) / resp.length : NaN,
      urgentOpen: calls.filter((c) => openStatuses.includes(c.status) && c.urgency === 'urgent').length,
    }
  }, [calls, visitOf])

  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    const digits = t.replace(/\D/g, '')
    return calls
      .filter((c) => (status === 'all' ? true : status === 'open' ? openStatuses.includes(c.status) : c.status === status))
      .filter((c) => !urgency || c.urgency === urgency)
      .filter((c) => !assignee || (assignee === 'none' ? !c.assigneeId : c.assigneeId === assignee))
      .filter((c) => {
        if (!t) return true
        const cu = customers.find((x) => x.id === c.customerId)
        return c.number.toLowerCase().includes(t) || c.description.toLowerCase().includes(t) || !!cu?.name.toLowerCase().includes(t) || (digits.length >= 3 && !!cu?.phone.replace(/\D/g, '').includes(digits)) || (c.errorCode ?? '').toLowerCase() === t
      })
      .sort((a, b) => {
        const ao = openStatuses.includes(a.status) ? 0 : 1
        const bo = openStatuses.includes(b.status) ? 0 : 1
        return ao - bo || (ao === 0 ? urgRank[a.urgency] - urgRank[b.urgency] : 0) || b.createdAt.localeCompare(a.createdAt)
      })
  }, [calls, customers, status, urgency, assignee, q])

  const techs = users.filter((u) => u.active && (u.role === 'installer' || calls.some((c) => c.assigneeId === u.id)))
  const filtered = status !== 'open' || urgency || assignee || q.trim()
  const nextVisit = (c: ServiceCall) => visitOf[c.id]?.find((v) => !v.done)

  return (
    <div className="col" style={{ gap: 16 }}>
      <PageHead
        title="קריאות שירות"
        sub={stats.urgentOpen ? `${stats.urgentOpen} קריאות דחופות פתוחות` : 'תקלות, ביקורי טכנאי ותיקונים באחריות'}
        actions={<button className="btn primary" onClick={() => setCreating(true)}><Plus size={16} /> קריאה חדשה</button>}
      />

      <div className="stat-row">
        <Stat icon={<Inbox size={20} />} label="חדשות" value={stats.new} tone="brand" delta={stats.new ? 'ממתינות לשיבוץ' : 'הכל שובץ'} onClick={() => setStatus('new')} />
        <Stat icon={<Wrench size={20} />} label="בטיפול" value={stats.active} tone="violet" delta="שובצו או בעבודה" onClick={() => setStatus('open')} />
        <Stat icon={<PackageX size={20} />} label="ממתינות לחלק" value={stats.parts} tone={stats.parts ? 'danger' : 'success'} onClick={() => setStatus('waiting_parts')} />
        <Stat icon={<CheckCircle2 size={20} />} label="טופלו בשבוע האחרון" value={stats.doneWeek} tone="success" onClick={() => setStatus('done')} />
        <Stat icon={<Timer size={20} />} label="זמן תגובה ממוצע" value={<span style={{ fontSize: 22 }}>{hoursLabel(stats.avg)}</span>} tone="warning" delta="מפתיחה ועד הביקור" />
      </div>

      <Card>
        <div className="filters" style={{ padding: '12px 14px', borderBottom: '1px solid var(--line-2)' }}>
          <div className="search-box grow" style={{ minWidth: 200 }}>
            <Search size={16} className="muted" />
            <input className="input sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder="מספר, לקוח, טלפון או תקלה" aria-label="חיפוש" />
          </div>
          <select className="select sm" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="סטטוס">
            <option value="open">פתוחות</option>
            <option value="all">כל הקריאות</option>
            {allStatuses.map((s) => <option key={s} value={s}>{serviceStatusLabel[s]}</option>)}
          </select>
          <select className="select sm" value={urgency} onChange={(e) => setUrgency(e.target.value as typeof urgency)} aria-label="דחיפות">
            <option value="">כל הדחיפויות</option>
            {(['urgent', 'high', 'normal', 'low'] as const).map((u) => <option key={u} value={u}>{urgencyLabel[u]}</option>)}
          </select>
          <select className="select sm" value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="טכנאי">
            <option value="">כל הטכנאים</option>
            <option value="none">לא שובץ</option>
            {techs.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          {filtered && <button className="btn sm ghost" onClick={() => { setStatus('open'); setUrgency(''); setAssignee(''); setQ('') }}>ניקוי</button>}
        </div>

        {list.length === 0 ? (
          <Empty icon={<Wrench size={36} />} title={filtered ? 'אין קריאות שמתאימות לסינון' : 'אין קריאות פתוחות'}>
            {filtered ? 'נסו לשנות את הסינון' : 'כל הקריאות טופלו. קריאה חדשה נפתחת מהכפתור למעלה.'}
          </Empty>
        ) : (
          <>
            <div className="table-wrap hide-mobile">
              <table className="table">
                <thead>
                  <tr>
                    <th>מס׳</th>
                    <th>לקוח</th>
                    <th>תקלה</th>
                    <th>דחיפות</th>
                    <th>סטטוס</th>
                    <th>טכנאי</th>
                    <th>ביקור</th>
                    <th>נפתחה</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((c) => {
                    const cu = customers.find((x) => x.id === c.customerId)
                    const u = users.find((x) => x.id === c.assigneeId)
                    const v = nextVisit(c)
                    return (
                      <tr key={c.id} className="click" onClick={() => nav(`/service/${c.id}`)}>
                        <td className="num strong nowrap">{c.number}</td>
                        <td>
                          <div className="strong">{cu?.name}</div>
                          {c.underWarranty && <span className="tiny txt-success">באחריות</span>}
                        </td>
                        <td style={{ maxWidth: 320 }}>
                          <div className="truncate">{c.description}</div>
                          <span className="tiny muted">{c.symptom ? symptomLabel[c.symptom] : ''}{c.errorCode ? ` · קוד ${c.errorCode}` : ''}</span>
                        </td>
                        <td><Badge tone={urgencyTone[c.urgency]}>{urgencyLabel[c.urgency]}</Badge></td>
                        <td><Badge tone={serviceStatusTone[c.status]} dot>{serviceStatusLabel[c.status]}</Badge></td>
                        <td>{u ? <span className="row" style={{ gap: 8 }}><Avatar user={u} /><span className="small nowrap">{u.name}</span></span> : <span className="muted small">—</span>}</td>
                        <td className="small nowrap">{v ? `${dateShortDay(v.start)} ${fmtTime(v.start)}` : <span className="muted">—</span>}</td>
                        <td className="small muted nowrap">{relative(c.createdAt)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="svc-cards show-mobile">
              {list.map((c) => {
                const cu = customers.find((x) => x.id === c.customerId)
                const u = users.find((x) => x.id === c.assigneeId)
                const v = nextVisit(c)
                return (
                  <Link key={c.id} to={`/service/${c.id}`} className="svc-card">
                    <div className="row" style={{ alignItems: 'stretch', gap: 10 }}>
                      <span className="urg-bar" style={{ background: urgColor[c.urgency] }} />
                      <div className="grow col" style={{ gap: 4 }}>
                        <div className="row between">
                          <span className="strong">{cu?.name}</span>
                          <span className="tiny muted num">{c.number}</span>
                        </div>
                        <div className="small">{c.description}</div>
                        <div className="row wrap" style={{ gap: 6 }}>
                          <Badge tone={serviceStatusTone[c.status]} dot>{serviceStatusLabel[c.status]}</Badge>
                          {c.urgency !== 'normal' && <Badge tone={urgencyTone[c.urgency]}>{urgencyLabel[c.urgency]}</Badge>}
                          {c.underWarranty && <Badge tone="success">באחריות</Badge>}
                        </div>
                        <div className="tiny muted">
                          {u ? u.name : 'לא שובץ'} · {v ? `ביקור ${dateShortDay(v.start)} ${fmtTime(v.start)}` : `נפתחה ${relative(c.createdAt)}`}
                        </div>
                      </div>
                      <ChevronLeft size={16} className="muted" style={{ alignSelf: 'center' }} />
                    </div>
                  </Link>
                )
              })}
            </div>
          </>
        )}
      </Card>

      {creating && <NewServiceCallDialog onClose={() => setCreating(false)} />}
    </div>
  )
}
