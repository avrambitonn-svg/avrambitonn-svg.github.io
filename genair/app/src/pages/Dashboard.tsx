import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  AlertTriangle, ArrowLeft, BadgeCheck, CalendarClock, CheckCircle2, CircleDollarSign, Eye, FileText, HardHat, Inbox, Plus, RefreshCw, ShieldAlert, Wrench, Boxes, PhoneCall, PlayCircle,
} from 'lucide-react'
import { AreaChart, BarList, CountUp, Donut, KpiTile, Legend, Ring, Trend, compactMoney } from '../components/charts'
import { countByMonth, lastMonths, revenueByMonth } from '../lib/metrics'
import './dashboard.css'
import { TasksCard } from '../features/tasks/TasksCard'
import { startDemo } from '../features/demo/DemoPlayer'
import { useApp, useMe } from '../lib/store'
import { Avatars, Badge, Card, Empty } from '../components/ui'
import { appointmentStatusLabel, appointmentTypeColor, appointmentTypeLabel, pipeline, projectTypeColor, projectTypeLabel, stageLabel, stageTone } from '../lib/labels'
import { addDays, daysBetween, money, relative, sameDay, time, ymd } from '../lib/format'
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

  const recent = useMemo(() => [...db.cases].sort((x, y) => y.createdAt.localeCompare(x.createdAt)).slice(0, 5), [db.cases])
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

  // מגמות: 12 חודשים אחורה, ומספרים להשוואה מול התקופה הקודמת
  const months = useMemo(() => lastMonths(12), [])
  const trends = useMemo(() => {
    const ids = new Set(cases.map((k) => k.id))
    const mine = (caseId: string) => ids.has(caseId)
    const rev = revenueByMonth(db, months, (q) => mine(q.caseId))
    const inRange = (iso: string | undefined, from: Date, to: Date) => !!iso && iso >= from.toISOString() && iso <= to.toISOString()
    const approvedIn = (from: Date, to: Date) => db.quotes.filter((q) => q.status === 'approved' && mine(q.caseId) && inRange(q.decidedAt, from, to))
    const sumNet = (qs: Quote[]) => qs.reduce((s, q) => s + totals(q).net, 0)
    const y = today.getFullYear()
    const ytd = sumNet(approvedIn(new Date(y, 0, 1), today))
    const ytdPrev = sumNet(approvedIn(new Date(y - 1, 0, 1), new Date(y - 1, today.getMonth(), today.getDate(), 23, 59)))
    // החודש עד היום, מול אותם ימים בחודש הקודם
    const monthNow = approvedIn(new Date(y, today.getMonth(), 1), today)
    const monthPrev = sumNet(approvedIn(new Date(y, today.getMonth() - 1, 1), new Date(y, today.getMonth() - 1, today.getDate(), 23, 59)))
    const d30 = addDays(today, -30)
    const d60 = addDays(today, -60)
    const created30 = cases.filter((k) => inRange(k.createdAt, d30, today)).length
    const createdPrev30 = cases.filter((k) => inRange(k.createdAt, d60, d30)).length
    const decided90 = db.quotes.filter((q) => mine(q.caseId) && (q.status === 'approved' || q.status === 'rejected') && inRange(q.decidedAt, addDays(today, -90), today))
    const won90 = decided90.filter((q) => q.status === 'approved').length
    const byType = new Map<string, number>()
    for (const k of cases) if (inRange(k.createdAt, addDays(today, -365), today)) byType.set(k.projectType, (byType.get(k.projectType) ?? 0) + 1)
    return {
      revenue: rev.revenue,
      profit: rev.profit,
      ytd, ytdPrev,
      monthNow: sumNet(monthNow), monthCount: monthNow.length, monthPrev,
      created30, createdPrev30,
      createdByMonth: countByMonth(cases, (k) => k.createdAt, months),
      sentByMonth: countByMonth(db.quotes.filter((q) => mine(q.caseId)), (q) => q.sentAt, months),
      serviceByMonth: countByMonth(db.serviceCalls, (c) => c.createdAt, months),
      close90: decided90.length ? (won90 / decided90.length) * 100 : 0, won90, decided90: decided90.length,
      byType: [...byType.entries()].sort((a, b) => b[1] - a[1]).map(([key, value]) => ({ key, label: projectTypeLabel[key as Case['projectType']] ?? key, value, color: projectTypeColor(key) })),
    }
  }, [db, cases, months])

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
  const pipeValue = funnel.reduce((s, f) => s + f.v, 0)

  const feed = useMemo(() => db.activities.filter((a) => !mineOnly || cases.some((k) => k.id === a.caseId)).slice(0, 9), [db.activities, mineOnly, cases])

  const toneColor = { danger: 'var(--danger)', warning: 'var(--warning)', info: 'var(--info)' }

  return (
    <div className="col enter dash" style={{ gap: 18 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1>{greeting()}, {me.name.split(' ')[0]}</h1>
          <div className="sub">{gregDate.format(today)} · {hebDate.format(today)}</div>
        </div>
        <div className="row wrap">
          {me.role === 'installer' && <Link className="btn primary" to="/field"><HardHat size={17} /> היום שלי</Link>}
          {me.role !== 'installer' && <Link className="btn primary" to="/cases/new"><Plus size={17} /> תיק חדש</Link>}
          <button className="btn" onClick={() => startDemo()}><PlayCircle size={17} /> הדגמה מודרכת</button>
          <Link className="btn" to="/service"><Wrench size={17} /> קריאת שירות</Link>
        </div>
      </div>

      <div className="grid g4 stagger" style={{ '--r': 1 } as React.CSSProperties}>
        <KpiTile icon={<BadgeCheck size={18} />} tone="success" label="הכנסות החודש" value={trends.monthNow} format={money}
          trend={<Trend cur={trends.monthNow} prev={trends.monthPrev} suffix="מול אותם ימים בחודש שעבר" />} sub={`${trends.monthCount} עסקאות אושרו`} spark={trends.revenue} />
        <KpiTile icon={<Inbox size={18} />} label="פניות חדשות ב-30 יום" value={trends.created30}
          trend={<Trend cur={trends.created30} prev={trends.createdPrev30} suffix="מול 30 הימים שלפני" />} sub={`${stats.leads} ממתינים לשיחה ראשונה`} spark={trends.createdByMonth} onClick={() => nav('/cases?stage=lead')} />
        <KpiTile icon={<FileText size={18} />} tone="violet" label="הצעות פתוחות" value={stats.openQuotes} sub={`${money(stats.openQuotesValue)} לפני מע״מ`} spark={trends.sentByMonth} onClick={() => nav('/cases?stage=quote')} />
        <KpiTile icon={<Wrench size={18} />} tone={stats.urgent ? 'danger' : 'warning'} label="קריאות שירות פתוחות" value={stats.service} sub={stats.urgent ? `${stats.urgent} דחופות` : 'אין דחופות'} spark={trends.serviceByMonth} onClick={() => nav('/service')} />
      </div>

      {me.role !== 'installer' && (
        <div className="grid dash-hero stagger" style={{ '--r': 2 } as React.CSSProperties}>
          <Card title={<div><h2>הכנסות ורווח גולמי</h2><div className="tiny muted">12 החודשים האחרונים · לפי תאריך אישור ההצעה · לפני מע״מ</div></div>} actions={<Link className="btn sm ghost" to="/reports">לכל הדוחות</Link>} pad>
            <div className="dash-hero-fig">
              <div>
                <div className="tiny muted">מתחילת השנה</div>
                <div className="dash-big"><CountUp value={trends.ytd} format={money} /></div>
                <Trend cur={trends.ytd} prev={trends.ytdPrev} suffix="לעומת התקופה המקבילה אשתקד" />
              </div>
              <Legend line series={[{ key: 'rev', label: 'הכנסות', color: 'var(--brand)' }, { key: 'profit', label: 'רווח גולמי', color: 'var(--violet)' }]} />
            </div>
            <AreaChart partialLast labels={months.map((m) => m.label)} format={money} axisFormat={compactMoney} height={230}
              series={[{ key: 'rev', label: 'הכנסות', color: 'var(--brand)' }, { key: 'profit', label: 'רווח גולמי', color: 'var(--violet)' }]}
              data={[trends.revenue, trends.profit]} />
          </Card>
          <Card title={<div><h2>צנרת מכירות</h2><div className="tiny muted">תיקים פתוחים לפי שלב</div></div>} actions={<Link className="btn sm ghost" to="/cases">לתיקים</Link>} pad>
            <BarList ramp labelWidth={104} rows={funnel.map((f) => ({ key: f.st, label: stageLabel[f.st], value: f.n, display: <span>{f.n}{f.v > 0 && <span className="tiny muted"> · {compactMoney(f.v)}</span>}</span> }))} />
            <div className="dash-pipe-foot">
              <Ring value={trends.close90} label="יחס סגירה" sub={`${trends.won90} מתוך ${trends.decided90} הצעות · 90 יום`} />
              <div>
                <div className="tiny muted">שווי הצנרת</div>
                <div className="strong" style={{ fontSize: 20 }}><CountUp value={pipeValue} format={money} /></div>
              </div>
            </div>
          </Card>
        </div>
      )}

      <div className="grid g-side stagger" style={{ '--r': 3 } as React.CSSProperties}>
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

          <Card title="תיקים אחרונים" actions={<Link className="btn sm ghost" to="/cases">לכל התיקים</Link>}>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>מספר</th><th>שם</th><th className="hide-mobile">לקוח</th><th>סטטוס</th></tr></thead>
                <tbody>
                  {recent.map((k) => (
                    <tr key={k.id} className="click" onClick={() => nav(`/cases/${k.id}`)}>
                      <td className="num small nowrap">{k.number}</td>
                      <td className="small strong">{k.title}</td>
                      <td className="small hide-mobile">{db.customers.find((c) => c.id === k.customerId)?.name ?? <span className="muted">ללא לקוח</span>}</td>
                      <td><Badge tone={stageTone[k.stage]} dot>{stageLabel[k.stage]}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

        </div>

        <div className="col" style={{ gap: 16 }}>
          <TasksCard />

          {me.role !== 'installer' && trends.byType.length > 0 && (
            <Card title={<div><h2>פניות לפי סוג פרויקט</h2><div className="tiny muted">12 החודשים האחרונים</div></div>} pad>
              <Donut parts={trends.byType} centerLabel="פניות" size={150} />
            </Card>
          )}

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
