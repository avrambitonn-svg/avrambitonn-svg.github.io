import { useMemo, useState } from 'react'
import { BadgeCheck, Clock, Download, Percent, Repeat, TrendingUp, Wrench } from 'lucide-react'
import { useApp } from '../../lib/store'
import { Avatar, Card, Empty, PageHead, Stat } from '../../components/ui'
import { pipeline, sourceLabel, stageLabel } from '../../lib/labels'
import { daysBetween, money, pct, addDays } from '../../lib/format'
import { totals } from '../../lib/quote'
import { download } from '../../lib/integrations/links'
import type { LeadSource } from '../../lib/types'

type Range = 'month' | '30' | 'quarter' | 'year'
const monthShort = new Intl.DateTimeFormat('he-IL', { month: 'short' })

function rangeStart(r: Range): Date {
  const now = new Date()
  if (r === 'month') return new Date(now.getFullYear(), now.getMonth(), 1)
  if (r === '30') return addDays(now, -30)
  if (r === 'quarter') return addDays(now, -91)
  return addDays(now, -365)
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

export default function ReportsPage() {
  const db = useApp((s) => s.db)
  const [range, setRange] = useState<Range>('year')
  const from = rangeStart(range).toISOString()

  const r = useMemo(() => {
    const inRange = (iso?: string) => !!iso && iso >= from
    const approved = db.quotes.filter((q) => q.status === 'approved' && inRange(q.decidedAt))
    const decided = db.quotes.filter((q) => (q.status === 'approved' || q.status === 'rejected') && inRange(q.decidedAt))
    const sent = db.quotes.filter((q) => inRange(q.sentAt))
    const revenue = approved.reduce((s, q) => s + totals(q, db.catalog).net, 0)
    const profit = approved.reduce((s, q) => s + totals(q, db.catalog).profit, 0)
    const caseOf = (id: string) => db.cases.find((k) => k.id === id)

    const leadToQuote = avg(db.quotes.filter((q) => q.sentAt && inRange(q.sentAt)).map((q) => daysBetween(caseOf(q.caseId)?.createdAt ?? q.createdAt, q.sentAt!)).filter((d) => d >= 0))
    const quoteToApprove = avg(approved.filter((q) => q.sentAt).map((q) => daysBetween(q.sentAt!, q.decidedAt!)))
    const openPipeline = db.cases.filter((k) => !['closed', 'lost', 'completed'].includes(k.stage))
    const latest = (caseId: string) => db.quotes.filter((q) => q.caseId === caseId).sort((a, b) => b.version - a.version)[0]
    const pipeValue = pipeline.slice(0, 6).map((st) => ({ st, v: openPipeline.filter((k) => k.stage === st).reduce((s, k) => s + (latest(k.id) ? totals(latest(k.id)!).net : 0), 0), n: openPipeline.filter((k) => k.stage === st).length }))

    // הכנסות לפי חודש: 12 חודשים אחרונים
    const months = Array.from({ length: 12 }, (_, i) => {
      const d = new Date()
      d.setDate(1)
      d.setMonth(d.getMonth() - (11 - i))
      return d
    })
    const byMonth = months.map((m) => {
      const key = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`
      return { label: monthShort.format(m), v: db.quotes.filter((q) => q.status === 'approved' && q.decidedAt?.startsWith(key)).reduce((s, q) => s + totals(q).net, 0) }
    })

    const sources = (Object.keys(sourceLabel) as LeadSource[]).map((s) => {
      const ks = db.cases.filter((k) => k.source === s && inRange(k.createdAt))
      const won = ks.filter((k) => db.quotes.some((q) => q.caseId === k.id && q.status === 'approved'))
      return { s, n: ks.length, won: won.length }
    }).filter((x) => x.n > 0)

    const lostReasons = Object.entries(
      db.cases.filter((k) => k.stage === 'lost' && inRange(k.updatedAt)).reduce<Record<string, number>>((m, k) => ({ ...m, [k.lostReason ?? 'לא צוין']: (m[k.lostReason ?? 'לא צוין'] ?? 0) + 1 }), {}),
    )

    const agents = db.users.filter((u) => u.role === 'agent').map((u) => {
      const ks = db.cases.filter((k) => k.agentId === u.id)
      const qs = db.quotes.filter((q) => ks.some((k) => k.id === q.caseId))
      const won = qs.filter((q) => q.status === 'approved' && inRange(q.decidedAt))
      const lost = qs.filter((q) => q.status === 'rejected' && inRange(q.decidedAt))
      return {
        u, cases: ks.filter((k) => inRange(k.createdAt)).length, sent: qs.filter((q) => inRange(q.sentAt)).length, won: won.length,
        value: won.reduce((s, q) => s + totals(q).net, 0), conv: won.length + lost.length ? (won.length / (won.length + lost.length)) * 100 : 0,
        commission: db.money.filter((m) => m.kind === 'commission' && m.userId === u.id && m.at >= from.slice(0, 10)).reduce((s, m) => s + m.amount, 0),
      }
    })

    const installers = db.users.filter((u) => u.role === 'installer').map((u) => {
      const jobs = db.appointments.filter((a) => a.userIds.includes(u.id) && a.status === 'done' && inRange(a.start))
      const hours = jobs.reduce((s, a) => s + (new Date(a.end).getTime() - new Date(a.start).getTime()) / 3600000, 0)
      const calls = db.serviceCalls.filter((c) => c.assigneeId === u.id && c.status === 'done' && inRange(c.closedAt))
      return { u, jobs: jobs.length, hours, calls: calls.length }
    })

    const doneCalls = db.serviceCalls.filter((c) => c.status === 'done' && c.closedAt && inRange(c.closedAt))
    const service = {
      open: db.serviceCalls.filter((c) => !['done', 'cancelled'].includes(c.status)).length,
      closed: doneCalls.length,
      avgHours: avg(doneCalls.map((c) => (new Date(c.closedAt!).getTime() - new Date(c.createdAt).getTime()) / 3600000)),
      warranty: doneCalls.length ? (doneCalls.filter((c) => c.underWarranty).length / doneCalls.length) * 100 : 0,
      revenue: doneCalls.reduce((s, c) => s + (c.charge ?? 0), 0),
    }
    const recurring = db.contracts.filter((c) => c.status === 'active' || c.status === 'expiring').reduce((s, c) => s + c.pricePerYear, 0)

    return { approved, decided, sent, revenue, profit, leadToQuote, quoteToApprove, pipeValue, byMonth, sources, lostReasons, agents, installers, service, recurring }
  }, [db, from])

  const conv = r.decided.length ? (r.approved.length / r.decided.length) * 100 : 0
  const maxMonth = Math.max(1, ...r.byMonth.map((m) => m.v))
  const maxPipe = Math.max(1, ...r.pipeValue.map((p) => p.v))

  function exportCsv() {
    const rows = [['מספר הצעה', 'תיק', 'לקוח', 'סטטוס', 'נשלחה', 'הוחלט', 'לפני מע"מ', 'כולל מע"מ']]
    for (const q of db.quotes) {
      const k = db.cases.find((x) => x.id === q.caseId)
      const c = db.customers.find((x) => x.id === k?.customerId)
      const t = totals(q)
      rows.push([q.number, k?.number ?? '', c?.name ?? '', q.status, q.sentAt?.slice(0, 10) ?? '', q.decidedAt?.slice(0, 10) ?? '', String(t.net), String(t.total)])
    }
    const csv = '﻿' + rows.map((r) => r.map((x) => `"${x.replace(/"/g, '""')}"`).join(',')).join('\n')
    download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `genair-quotes-${new Date().toISOString().slice(0, 10)}.csv`)
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      <PageHead
        title="דוחות"
        sub="המספרים מחושבים מהנתונים במערכת, בלי הזנה ידנית"
        actions={
          <>
            {(['month', '30', 'quarter', 'year'] as Range[]).map((x) => (
              <button key={x} className={`chip ${range === x ? 'on' : ''}`} onClick={() => setRange(x)}>{x === 'month' ? 'החודש' : x === '30' ? '30 יום' : x === 'quarter' ? 'רבעון' : 'שנה'}</button>
            ))}
            <button className="btn sm" onClick={exportCsv}><Download size={15} /> ייצוא ל-Excel</button>
          </>
        }
      />

      <div className="grid g4">
        <Stat icon={<BadgeCheck size={20} />} tone="success" label="הכנסות מאושרות (לפני מע״מ)" value={money(r.revenue)} delta={`${r.approved.length} עסקאות · רווח גולמי ${money(r.profit)}`} />
        <Stat icon={<Percent size={20} />} label="יחס סגירה" value={pct(conv)} delta={`${r.approved.length} מתוך ${r.decided.length} הצעות שהוכרעו`} />
        <Stat icon={<Clock size={20} />} tone="warning" label="מהירות העסקה" value={`${r.leadToQuote.toFixed(1)} + ${r.quoteToApprove.toFixed(1)}`} delta="ימים: מליד להצעה, ומהצעה לאישור" />
        <Stat icon={<Repeat size={20} />} tone="violet" label="הכנסה חוזרת מחוזים" value={money(r.recurring)} delta="לשנה, חוזים פעילים" />
      </div>

      <div className="grid g2">
        <Card title={<div className="row"><TrendingUp size={17} /><h2>הכנסות שאושרו לפי חודש</h2></div>} pad>
          <div className="bar-chart">
            {r.byMonth.map((m, i) => (
              <div key={i} className="bar" title={money(m.v)}>
                {m.v > 0 && <span className="num" style={{ fontSize: 10.5 }}>{Math.round(m.v / 1000)}K</span>}
                <div style={{ height: `${(m.v / maxMonth) * 100}%`, opacity: i === 11 ? 1 : 0.65 }} />
                <span>{m.label}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card title="ערך הצנרת הפתוחה לפי שלב" pad>
          {r.pipeValue.map((p) => (
            <div key={p.st} className="funnel-row">
              <span className="small">{stageLabel[p.st]}</span>
              <div style={{ background: 'var(--line-2)', borderRadius: 8 }}><div className="fill" style={{ width: `${(p.v / maxPipe) * 100}%`, minWidth: p.v ? 20 : 0 }} /></div>
              <span className="small num" style={{ textAlign: 'end' }}>{p.v ? `${Math.round(p.v / 1000)}K` : p.n}</span>
            </div>
          ))}
        </Card>
      </div>

      <div className="grid g2">
        <Card title="מאיפה מגיעים הלקוחות">
          {r.sources.length === 0 ? <Empty title="אין נתונים בטווח" /> : (
            <div className="table-wrap">
            <table className="table">
                <thead><tr><th>מקור</th><th>פניות</th><th>נסגרו</th><th>המרה</th></tr></thead>
                <tbody>{r.sources.sort((a, b) => b.n - a.n).map((s) => <tr key={s.s}><td className="small">{sourceLabel[s.s]}</td><td className="small num">{s.n}</td><td className="small num">{s.won}</td><td className="small num">{pct((s.won / s.n) * 100)}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="למה הפסדנו עסקאות">
          {r.lostReasons.length === 0 ? <Empty title="אין עסקאות שהפסדנו בטווח" /> : (
            <div className="list">{r.lostReasons.map(([reason, n]) => <div key={reason} className="list-item"><span className="grow small">{reason}</span><b className="num">{n}</b></div>)}</div>
          )}
        </Card>
      </div>

      <Card title="ביצועי סוכנים">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>סוכן</th><th>תיקים חדשים</th><th>הצעות שנשלחו</th><th>נסגרו</th><th>יחס סגירה</th><th className="end">ערך</th><th className="end">עמלות</th></tr></thead>
            <tbody>
              {r.agents.map((a) => (
                <tr key={a.u.id}>
                  <td><span className="row"><Avatar user={a.u} /><span className="small strong">{a.u.name}</span></span></td>
                  <td className="small num">{a.cases}</td><td className="small num">{a.sent}</td><td className="small num">{a.won}</td><td className="small num">{pct(a.conv)}</td>
                  <td className="end small num strong">{money(a.value)}</td><td className="end small num">{money(a.commission)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid g2">
        <Card title="צוותי שטח">
          <div className="table-wrap">
          <table className="table">
            <thead><tr><th>שם</th><th>התקנות / ביקורים</th><th>שעות בשטח</th><th>קריאות שטופלו</th></tr></thead>
            <tbody>{r.installers.map((x) => <tr key={x.u.id}><td><span className="row"><Avatar user={x.u} /><span className="small">{x.u.name}</span></span></td><td className="small num">{x.jobs}</td><td className="small num">{x.hours.toFixed(1)}</td><td className="small num">{x.calls}</td></tr>)}</tbody>
          </table>
          </div>
        </Card>
        <Card title={<div className="row"><Wrench size={17} /><h2>שירות</h2></div>} pad>
          <div className="grid g2">
            <div><div className="tiny muted">פתוחות עכשיו</div><div className="strong num" style={{ fontSize: 22 }}>{r.service.open}</div></div>
            <div><div className="tiny muted">טופלו בטווח</div><div className="strong num" style={{ fontSize: 22 }}>{r.service.closed}</div></div>
            <div><div className="tiny muted">זמן טיפול ממוצע</div><div className="strong num" style={{ fontSize: 22 }}>{r.service.avgHours ? `${Math.round(r.service.avgHours)} ש׳` : '—'}</div></div>
            <div><div className="tiny muted">באחריות</div><div className="strong num" style={{ fontSize: 22 }}>{pct(r.service.warranty)}</div></div>
          </div>
          <div className="small mt12">הכנסות משירות בטווח: <b className="num">{money(r.service.revenue)}</b></div>
        </Card>
      </div>
    </div>
  )
}
