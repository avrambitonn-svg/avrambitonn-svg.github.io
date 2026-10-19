import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  AlertTriangle, ArrowLeft, BadgeCheck, CalendarClock, CheckCircle2, CircleDollarSign, Eye, FileText, HardHat, Inbox, Plus, RefreshCw, ShieldAlert, Wrench, Boxes, PhoneCall,
} from 'lucide-react'
import { TasksCard } from '../features/tasks/TasksCard'
import { useApp, useMe } from '../lib/store'
import { Avatars, Badge, Card, Empty, Stat } from '../components/ui'
import { appointmentStatusLabel, appointmentTypeColor, appointmentTypeLabel, pipeline, stageLabel } from '../lib/labels'
import { daysBetween, money, relative, sameDay, time, ymd } from '../lib/format'
import { totals } from '../lib/quote'
import type { Case, Quote } from '../lib/types'

const hebDate = new Intl.DateTimeFormat('he-u-ca-hebrew', { day: 'numeric', month: 'long', year: 'numeric' })
const gregDate = new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })

function greeting() {
  const h = new Date().getHours()
  if (h < 5) return 'לילה טוב'
  if (h < 12) return 'בוקר טוב'
  if (h < 17) return 'צהריים טובים'
  if (h < 21) return 'ערב טוב'
  return 'לילה טוב'
}

interface Alert { key: string; icon: React.ReactNode; text: string; sub?: string; to: string; tone: 'danger' | 'warning' | 'info' }

export default function Dashboard() {
  const me = useMe()
  const db = useApp((s) => s.db)
  const nav = useNavigate()

  const latestQuote = useMemo(() => {
    const m = new Map<string, Quote>()
    for (const q of db.quotes) {
      const cur = m.get(q.caseId)
      if (!cur || q.version > cur.version || q.createdAt > cur.createdAt) m.set(q.caseId, q)
    }
    return m
  }, [db.quotes])

  const value = (k: Case) => {
    const q = latestQuote.get(k.id)
    return q ? totals(q).net : 0
  }

  const mineOnly = me.role === 'agent'
  const cases = useMemo(() => db.cases.filter((k) => !mineOnly || k.agentId === me.id), [db.cases, mineOnly, me.id])
  const open = cases.filter((k) => !['closed', 'lost'].includes(k.stage))
  const today = new Date()
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString()

  const stats = useMemo(() => {
    const leads = open.filter((k) => k.stage === 'lead')
    const openQuotes = db.quotes.filter((q) => ['sent', 'viewed'].includes(q.status) && cases.some((k) => k.id === q.caseId))
    const approvedMonth = db.quotes.filter((q) => q.status === 'approved' && (q.decidedAt ?? '') >= monthStart && cases.some((k) => k.id === q.caseId))
    const weekEnd = new Date(today.getTime() + 7 * 86400000).toISOString()
    const installs = db.appointments.filter((a) => a.type === 'installation' && a.start >= ymd(today) && a.start <= weekEnd && a.status !== 'cancelled')
    const service = db.serviceCalls.filter((s) => !['done', 'cancelled'].includes(s.status))
    return {
      leads: leads.length,
      openQuotes: openQuotes.length,
      openQuotesValue: openQuotes.reduce((s, q) => s + totals(q).net, 0),
      approvedMonth: approvedMonth.reduce((s, q) => s + totals(q).net, 0),
      approvedCount: approvedMonth.length,
      installs: installs.length,
      service: service.length,
      urgent: service.filter((s) => s.urgency === 'urgent' || s.urgency === 'high').length,
    }
  }, [open, db.quotes, db.appointments, db.serviceCalls, cases, monthStart])

  // מה דורש טיפול עכשיו: נגזר מהנתונים, בלי הגדרה ידנית
  const alerts = useMemo(() => {
    const out: Alert[] = []
    for (const q of db.quotes) {
      const k = cases.find((x) => x.id === q.caseId)
      if (!k) continue
      if (q.status === 'viewed' && q.viewedAt && daysBetween(q.viewedAt, new Date()) >= 0)
        out.push({ key: 'v' + q.id, icon: <Eye size={17} />, text: `${k.title}: הלקוח צפה בהצעה ועוד לא אישר`, sub: `נצפתה ${relative(q.viewedAt)} · זה הזמן להתקשר`, to: `/cases/${k.id}`, tone: 'warning' })
      if (q.status === 'sent' && q.sentAt && daysBetween(q.sentAt, new Date()) >= 3)
        out.push({ key: 's' + q.id, icon: <FileText size={17} />, text: `${k.title}: ההצעה נשלחה ולא נפתחה`, sub: `נשלחה ${relative(q.sentAt)} · לשלוח תזכורת`, to: `/cases/${k.id}`, tone: 'info' })
    }
    for (const k of open) {
      if (k.stage === 'approved' && !db.appointments.some((a) => a.caseId === k.id && a.type === 'installation' && a.status !== 'cancelled'))
        out.push({ key: 'a' + k.id, icon: <CalendarClock size={17} />, text: `${k.title}: אושר וממתין לתיאום התקנה`, to: `/cases/${k.id}`, tone: 'danger' })
      if (k.stage === 'lead' && daysBetween(k.createdAt, new Date()) >= 0 && !db.messages.some((m) => m.caseId === k.id && m.direction === 'out'))
        out.push({ key: 'l' + k.id, icon: <PhoneCall size={17} />, text: `ליד חדש: ${k.title}`, sub: `נכנס ${relative(k.createdAt)} · עוד לא חזרו אליו`, to: `/cases/${k.id}`, tone: 'warning' })
      if (k.stage === 'completed') out.push({ key: 'c' + k.id, icon: <CircleDollarSign size={17} />, text: `${k.title}: הותקן, לסגור חשבון ולבקש חוות דעת`, to: `/cases/${k.id}`, tone: 'info' })
    }
    if (!mineOnly) {
      for (const s of db.serviceCalls.filter((x) => x.status === 'new'))
        out.push({ key: 'sc' + s.id, icon: <Wrench size={17} />, text: `קריאת שירות חדשה: ${s.description}`, sub: `${db.customers.find((c) => c.id === s.customerId)?.name ?? ''} · ${relative(s.createdAt)}`, to: `/service/${s.id}`, tone: s.urgency === 'urgent' || s.urgency === 'high' ? 'danger' : 'warning' })
      for (const c of db.contracts.filter((x) => x.status === 'expiring'))
        out.push({ key: 'ct' + c.id, icon: <ShieldAlert size={17} />, text: `חוזה מסתיים: ${c.title}`, sub: `${db.customers.find((x) => x.id === c.customerId)?.name ?? ''} · עד ${c.endDate.split('-').reverse().join('.')}`, to: '/contracts', tone: c.type === 'smoke_annual' ? 'danger' : 'warning' })
      for (const u of db.users)
        for (const cert of u.certifications ?? [])
          if (daysBetween(new Date(), cert.expires) <= 30)
            out.push({ key: 'cert' + u.id + cert.type, icon: <HardHat size={17} />, text: `אישור "${cert.type}" של ${u.name} פג בעוד ${Math.max(0, daysBetween(new Date(), cert.expires))} ימים`, to: '/settings', tone: 'warning' })
      const errs = db.customers.filter((c) => c.sync.status === 'error').length + db.quotes.filter((q) => q.sync.status === 'error').length
      if (errs) out.push({ key: 'sync', icon: <RefreshCw size={17} />, text: `${errs} רשומות לא הסתנכרנו ל-Priority`, to: '/settings/priority', tone: 'danger' })
      const low = db.stock.filter((s) => s.qty < s.min).length
      if (low) out.push({ key: 'stock', icon: <Boxes size={17} />, text: `${low} פריטים במלאי מתחת למינימום`, to: '/inventory', tone: 'info' })
    }
    const order = { danger: 0, warning: 1, info: 2 }
    return out.sort((a, b) => order[a.tone] - order[b.tone])
  }, [db, cases, open, mineOnly])

  const todays = useMemo(
    () => db.appointments.filter((a) => sameDay(a.start, today) && a.status !== 'cancelled').sort((a, b) => a.start.localeCompare(b.start)),
    [db.appointments],
  )


  const funnel = useMemo(() => {
    const stages = pipeline.slice(0, 7)
    return stages.map((st) => {
      const ks = open.filter((k) => k.stage === st)
      return { st, n: ks.length, v: ks.reduce((s, k) => s + value(k), 0) }
    })
  }, [open, latestQuote])
  const maxN = Math.max(1, ...funnel.map((f) => f.n))

  const feed = useMemo(() => db.activities.filter((a) => !mineOnly || cases.some((k) => k.id === a.caseId)).slice(0, 9), [db.activities, mineOnly, cases])

  const toneColor = { danger: 'var(--danger)', warning: 'var(--warning)', info: 'var(--info)' }

  return (
    <div className="col" style={{ gap: 18 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1>{greeting()}, {me.name.split(' ')[0]}</h1>
          <div className="sub">{gregDate.format(today)} · {hebDate.format(today)}</div>
        </div>
        <div className="row wrap">
          {me.role === 'installer' && <Link className="btn primary" to="/field"><HardHat size={17} /> היום שלי</Link>}
          {me.role !== 'installer' && <Link className="btn primary" to="/cases/new"><Plus size={17} /> תיק חדש</Link>}
          <Link className="btn" to="/service"><Wrench size={17} /> קריאת שירות</Link>
        </div>
      </div>

      <div className="grid g4">
        <Stat icon={<Inbox size={20} />} label="לידים חדשים" value={stats.leads} delta="ממתינים לשיחה ראשונה" onClick={() => nav('/cases?stage=lead')} />
        <Stat icon={<FileText size={20} />} tone="violet" label="הצעות פתוחות" value={stats.openQuotes} delta={`${money(stats.openQuotesValue)} לפני מע״מ`} onClick={() => nav('/cases?stage=quote')} />
        <Stat icon={<BadgeCheck size={20} />} tone="success" label="נסגר החודש" value={money(stats.approvedMonth)} delta={`${stats.approvedCount} הצעות אושרו`} />
        <Stat icon={<Wrench size={20} />} tone={stats.urgent ? 'danger' : 'warning'} label="קריאות שירות פתוחות" value={stats.service} delta={stats.urgent ? `${stats.urgent} דחופות` : 'אין דחופות'} onClick={() => nav('/service')} />
      </div>

      <div className="grid g-side">
        <div className="col" style={{ gap: 16 }}>
          <Card title={<div className="row"><AlertTriangle size={17} color="var(--warning)" /><h2>דורש טיפול עכשיו</h2></div>} actions={<span className="badge muted">{alerts.length}</span>}>
            {alerts.length === 0 ? (
              <Empty icon={<CheckCircle2 size={34} />} title="הכל מטופל">אין כרגע משהו שמחכה לך</Empty>
            ) : (
              <div className="list">
                {alerts.slice(0, 8).map((a) => (
                  <Link key={a.key} to={a.to} className="list-item">
                    <span style={{ color: toneColor[a.tone] }}>{a.icon}</span>
                    <div className="grow">
                      <div className="small strong">{a.text}</div>
                      {a.sub && <div className="tiny muted">{a.sub}</div>}
                    </div>
                    <ArrowLeft size={16} className="muted" />
                  </Link>
                ))}
              </div>
            )}
          </Card>

          <Card title="היום בשטח" actions={<Link className="btn sm ghost" to="/calendar">ללוח הזמנים</Link>}>
            {todays.length === 0 ? (
              <Empty title="אין משימות היום" />
            ) : (
              <div className="list">
                {todays.map((a) => {
                  const c = db.customers.find((x) => x.id === a.customerId)
                  return (
                    <Link key={a.id} to={`/field/${a.id}`} className="list-item">
                      <div style={{ width: 4, alignSelf: 'stretch', borderRadius: 4, background: appointmentTypeColor[a.type] }} />
                      <div className="grow">
                        <div className="tiny num strong"><span className="ltr">{time(a.start)}–{time(a.end)}</span></div>
                        <div className="small strong clamp2">{a.title}</div>
                        <div className="tiny muted">{appointmentTypeLabel[a.type]} · {c?.name}</div>
                      </div>
                      <div className="col-end">
                        <Avatars users={a.userIds.map((u) => db.users.find((x) => x.id === u))} />
                        <Badge tone={a.status === 'in_progress' ? 'warning' : a.status === 'done' ? 'success' : a.status === 'on_the_way' ? 'brand' : 'muted'}>{appointmentStatusLabel[a.status]}</Badge>
                      </div>
                    </Link>
                  )
                })}
              </div>
            )}
          </Card>

          <Card title="צנרת מכירות" actions={<Link className="btn sm ghost" to="/cases">לכל התיקים</Link>} pad>
            {funnel.map((f) => (
              <div key={f.st} className="funnel-row">
                <span className="small">{stageLabel[f.st]}</span>
                <div style={{ background: 'var(--line-2)', borderRadius: 8 }}>
                  <div className="fill" style={{ width: `${(f.n / maxN) * 100}%`, minWidth: f.n ? 26 : 0 }} />
                </div>
                <span className="small num" style={{ textAlign: 'end' }}>
                  <b>{f.n}</b>
                  {f.v > 0 && <div className="tiny muted">{money(f.v)}</div>}
                </span>
              </div>
            ))}
          </Card>
        </div>

        <div className="col" style={{ gap: 16 }}>
          <TasksCard />

          <Card title="פעילות אחרונה">
            <div className="card-body">
              <div className="timeline">
                {feed.map((a) => {
                  const k = db.cases.find((x) => x.id === a.caseId)
                  return (
                    <div key={a.id} className="tl-item">
                      <div className="small">{a.text}</div>
                      <div className="when">
                        {relative(a.at)}
                        {k && <> · <Link to={`/cases/${k.id}`}>{k.number}</Link></>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
