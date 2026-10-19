// דוחות: טווח תאריכים עם השוואה לתקופה הקודמת, תיקים, תקציב והוצאות, סוכנים, לקוחות מובילים, מתקינים, וייצוא ל-PDF
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CheckSquare, Clock, Download, FileDown, FolderCheck, FolderPlus, PiggyBank, Receipt, Repeat, Scale, TrendingUp, Wrench,
} from 'lucide-react'
import { useApp } from '../../lib/store'
import { Avatar, Card, Empty, PageHead, Progress } from '../../components/ui'
import { AreaChart, BarList, Columns, CountUp, Donut, KpiTile, Legend, Ring, Trend, compactMoney, type Series } from '../../components/charts'
import { countByMonth, lastMonths, revenueByMonth, sumByMonth } from '../../lib/metrics'
import { pipeline, projectTypeColor, projectTypeLabel, sourceLabel, stageLabel } from '../../lib/labels'
import { addDays, date, daysBetween, money, pct, ymd } from '../../lib/format'
import { totals } from '../../lib/quote'
import { download } from '../../lib/integrations/links'
import { setConfig } from '../../lib/config'
import { CommitInput } from '../../features/case/controls'
import type { CaseStage, DB, LeadSource, MoneyLine } from '../../lib/types'
import './reports.css'
import { brand } from '../../brand'

type Preset = 'month' | 'prev' | 'quarter' | 'year' | 'custom'
interface Range { from: string; to: string }
const presetLabel: Record<Exclude<Preset, 'custom'>, string> = { month: 'חודש נוכחי', prev: 'חודש קודם', quarter: 'רבעון נוכחי', year: 'שנה נוכחית' }

function presetRange(p: Exclude<Preset, 'custom'>, now = new Date()): Range {
  const y = now.getFullYear()
  const m = now.getMonth()
  if (p === 'month') return { from: ymd(new Date(y, m, 1)), to: ymd(now) }
  if (p === 'prev') return { from: ymd(new Date(y, m - 1, 1)), to: ymd(new Date(y, m, 0)) }
  if (p === 'quarter') return { from: ymd(new Date(y, Math.floor(m / 3) * 3, 1)), to: ymd(now) }
  return { from: ymd(new Date(y, 0, 1)), to: ymd(now) }
}
// התקופה הקודמת באותו אורך, שמסתיימת יום לפני תחילת הטווח
function prevRange(r: Range): Range {
  const len = daysBetween(r.from, r.to) + 1
  const to = addDays(r.from, -1)
  return { from: ymd(addDays(to, -(len - 1))), to: ymd(to) }
}
const dayOf = (iso?: string) => (!iso ? '' : iso.length > 10 ? ymd(iso) : iso)
const inR = (r: Range, iso?: string) => {
  const d = dayOf(iso)
  return !!d && d >= r.from && d <= r.to
}
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const sumAmt = (xs: MoneyLine[]) => xs.reduce((s, l) => s + l.amount, 0)

// מדדי הסיכום לטווח (לחישוב השינוי מול התקופה הקודמת)
function kpis(db: DB, r: Range) {
  const budget = sumAmt(db.money.filter((m) => m.kind === 'budget' && inR(r, m.at)))
  const expenses = sumAmt(db.money.filter((m) => m.kind === 'expense' && inR(r, m.at)))
  return {
    opened: db.cases.filter((k) => inR(r, k.createdAt)).length,
    closed: db.cases.filter((k) => inR(r, k.closedAt)).length,
    budget,
    expenses,
    balance: budget - expenses,
    tasks: db.tasks.filter((t) => t.done && inR(r, t.doneAt ?? t.createdAt)).length,
  }
}

export default function ReportsPage() {
  const db = useApp((s) => s.db)
  const [preset, setPreset] = useState<Preset>('year')
  const [custom, setCustom] = useState<Range>(() => presetRange('month'))
  const range = preset === 'custom' ? (custom.from <= custom.to ? custom : { from: custom.to, to: custom.from }) : presetRange(preset)
  const prev = prevRange(range)
  const rangeText = `${date(range.from)} – ${date(range.to)}`
  const from = range.from

  const r = useMemo(() => {
    const inRange = (iso?: string) => inR(range, iso)
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
        commission: db.money.filter((m) => m.kind === 'commission' && (m.agentId ?? m.userId) === u.id && inRange(m.at)).reduce((s, m) => s + m.amount, 0),
      }
    })

    // ביצועי סוכנים: תיקים, תקציב מול הוצאות ועמלות (כולל שורת "ללא סוכן")
    const moneyOf = (caseIds: Set<string>, kind: MoneyLine['kind']) => sumAmt(db.money.filter((m) => m.kind === kind && caseIds.has(m.caseId) && inRange(m.at)))
    const agentRows = [...db.users.filter((u) => u.role === 'agent' || db.cases.some((k) => k.agentId === u.id)).map((u) => ({ id: u.id, u })), { id: '', u: undefined }].map(({ id, u }) => {
      const ks = db.cases.filter((k) => (k.agentId ?? '') === id)
      const ids = new Set(ks.map((k) => k.id))
      const budget = moneyOf(ids, 'budget')
      const expenses = moneyOf(ids, 'expense')
      const commission = db.money.filter((m) => m.kind === 'commission' && inRange(m.at) && (id ? (m.agentId ?? m.userId) === id : !(m.agentId ?? m.userId))).reduce((s, m) => s + m.amount, 0)
      return { id, u, opened: ks.filter((k) => inRange(k.createdAt)).length, closed: ks.filter((k) => inRange(k.closedAt)).length, budget, expenses, commission, util: budget ? (expenses / budget) * 100 : 0 }
    }).filter((a) => a.u || a.opened || a.closed || a.budget || a.expenses)

    // לקוחות מובילים: תיקים בטווח, תקציב והוצאות
    const topCustomers = db.customers.map((c) => {
      const ks = db.cases.filter((k) => k.customerId === c.id)
      const ids = new Set(ks.map((k) => k.id))
      const budget = moneyOf(ids, 'budget')
      const expenses = moneyOf(ids, 'expense')
      const revenue = db.quotes.filter((q) => ids.has(q.caseId) && q.status === 'approved' && inRange(q.decidedAt)).reduce((s, q) => s + totals(q).net, 0)
      return { c, cases: ks.filter((k) => inRange(k.createdAt)).length, active: ks.filter((k) => !['closed', 'lost'].includes(k.stage)).length, budget, expenses, revenue }
    }).filter((x) => x.cases || x.budget || x.expenses || x.revenue).sort((a, b) => b.budget + b.revenue - (a.budget + a.revenue) || b.cases - a.cases).slice(0, 8)

    // תפוקת מתקינים
    const dayCost = db.config.installerDayCost ?? 1100
    const installers = db.users.filter((u) => u.role === 'installer').map((u) => {
      const jobs = db.appointments.filter((a) => a.userIds.includes(u.id) && a.status === 'done' && inRange(a.start))
      const hours = jobs.reduce((s, a) => s + (new Date(a.end).getTime() - new Date(a.start).getTime()) / 3600000, 0)
      const calls = db.serviceCalls.filter((c) => c.assigneeId === u.id && c.status === 'done' && inRange(c.closedAt))
      const tasks = db.tasks.filter((t) => t.assigneeId === u.id && t.done && inRange(t.doneAt ?? t.createdAt))
      const days = new Set([...jobs.map((a) => dayOf(a.start)), ...calls.map((c) => dayOf(c.closedAt))]).size
      return { u, jobs: jobs.length, hours, calls: calls.length, tasks: tasks.length, days, cost: days * dayCost, perDay: days ? (jobs.length + calls.length) / days : 0 }
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

    // גרפים לפי חודש: לפחות 12 חודשים שמסתיימים בסוף הטווח, והחודשים שמחוץ לטווח מעומעמים
    const end = new Date(range.to + 'T00:00:00')
    const start = new Date(range.from + 'T00:00:00')
    const span = (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth() + 1
    const months = lastMonths(Math.min(24, Math.max(12, span)), end)
    const outside = months.map((m) => m.to < range.from || m.from > range.to)
    const rev = revenueByMonth(db, months)
    // סוגי פרויקט: ארבעת הנפוצים בצבע שלהם, והשאר מקובצים ל"אחר"
    const order = ['apartment', 'replacement', 'luxury', 'commercial', 'institution', 'residential_building', 'underfloor_heating', 'smoke_ventilation', 'other']
    const casesIn = db.cases.filter((k) => months.some((m) => dayOf(k.createdAt).startsWith(m.key)))
    const typeCount = new Map<string, number>()
    casesIn.forEach((k) => typeCount.set(k.projectType, (typeCount.get(k.projectType) ?? 0) + 1))
    const top = [...typeCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t]) => t)
      .sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
    const typeSeries: Series[] = [...top.map((t) => ({ key: t, label: projectTypeLabel[t as keyof typeof projectTypeLabel] ?? t, color: projectTypeColor(t) })), ...(typeCount.size > top.length ? [{ key: '__other', label: 'אחר', color: '#94a3b8' }] : [])]
    const typeData = typeSeries.map((sr) => countByMonth(casesIn.filter((k) => (sr.key === '__other' ? !top.includes(k.projectType) : k.projectType === sr.key)), (k) => k.createdAt, months))
    const spark = {
      opened: countByMonth(db.cases, (k) => k.createdAt, months),
      closed: countByMonth(db.cases.filter((k) => k.closedAt), (k) => k.closedAt, months),
      budget: sumByMonth(db.money.filter((m) => m.kind === 'budget'), (m) => m.at, (m) => m.amount, months),
      expenses: sumByMonth(db.money.filter((m) => m.kind === 'expense'), (m) => m.at, (m) => m.amount, months),
      tasks: countByMonth(db.tasks.filter((t) => t.done), (t) => t.doneAt ?? t.createdAt, months),
      service: countByMonth(db.serviceCalls, (c) => c.createdAt, months),
    }

    // תיקים לפי סטטוס (שנפתחו בטווח)
    const opened = db.cases.filter((k) => inRange(k.createdAt))
    // סטטוס בארבע קבוצות, כדי שהעוגה תהיה קריאה: נסגרו בעסקה, בביצוע, בשלב המכירה, לא נסגרו
    const bucket = (st: CaseStage) => (st === 'closed' || st === 'completed' ? 'won' : st === 'lost' ? 'lost' : ['approved', 'scheduled', 'installing'].includes(st) ? 'doing' : 'selling')
    const bucketInfo = { won: ['נסגרו בעסקה', '#16a34a'], doing: ['אושרו ובביצוע', '#00aeef'], selling: ['בסקר ובהצעה', '#7c3aed'], lost: ['לא נסגרו', '#94a3b8'] } as const
    const byStage = (['won', 'doing', 'selling', 'lost'] as const).map((b) => ({ key: b, label: bucketInfo[b][0], color: bucketInfo[b][1], value: opened.filter((k) => bucket(k.stage) === b).length })).filter((x) => x.value > 0)

    return { approved, decided, sent, revenue, profit, leadToQuote, quoteToApprove, pipeValue, sources, lostReasons, agents, agentRows, topCustomers, installers, service, recurring, months, outside, rev, typeSeries, typeData, spark, byStage, openedCount: opened.length, dayCost }
  }, [db, range.from, range.to])

  const cur = useMemo(() => kpis(db, range), [db, range.from, range.to])
  const before = useMemo(() => kpis(db, prev), [db, prev.from, prev.to])
  const conv = r.decided.length ? (r.approved.length / r.decided.length) * 100 : 0
  const revPrev = useMemo(() => db.quotes.filter((q) => q.status === 'approved' && inR(prev, q.decidedAt)).reduce((s, q) => s + totals(q).net, 0), [db, prev.from, prev.to])
  const balanceSpark = r.spark.budget.map((b, i) => b - r.spark.expenses[i])
  const prevText = `בתקופה הקודמת`

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

  // PDF: גיליון הדפסה ב-A4; שם הקובץ נלקח משם המסמך
  function exportPdf() {
    const prevTitle = document.title
    document.title = `דוח ${brand.name} ${range.from} עד ${range.to}`
    document.body.classList.add('print-report')
    const done = () => {
      document.body.classList.remove('print-report')
      document.title = prevTitle
      window.removeEventListener('afterprint', done)
    }
    window.addEventListener('afterprint', done)
    window.print()
    setTimeout(done, 1500)
  }

  return (
    <div className="col reports enter" style={{ gap: 16 }}>
      <div className="rp-print-head">
        <div><b className="rp-brand"><span>{brand.nameEn.slice(0, 1)}</span>{brand.nameEn.slice(1)}</b> · דוח ניהולי</div>
        <div>תקופה: {rangeText} · הופק {date(new Date())}</div>
      </div>
      <PageHead
        title="דוחות"
        sub={<>המספרים מחושבים מהנתונים במערכת · <span className="ltr">{rangeText}</span> · השוואה ל-<span className="ltr">{date(prev.from)} – {date(prev.to)}</span></>}
        actions={
          <>
            <button className="btn sm" onClick={exportCsv}><Download size={15} /> ייצוא ל-Excel</button>
            <button className="btn sm primary" onClick={exportPdf}><FileDown size={15} /> ייצוא PDF</button>
          </>
        }
      />
      <div className="row wrap rp-range no-print">
        {(Object.keys(presetLabel) as Exclude<Preset, 'custom'>[]).map((x) => (
          <button key={x} className={`chip ${preset === x ? 'on' : ''}`} onClick={() => setPreset(x)}>{presetLabel[x]}</button>
        ))}
        <button className={`chip ${preset === 'custom' ? 'on' : ''}`} onClick={() => { if (preset !== 'custom') setCustom(range); setPreset('custom') }}>טווח אחר</button>
        {preset === 'custom' && (
          <span className="row wrap rp-dates">
            <label className="row small" style={{ gap: 6 }}>מ-<input className="input sm" type="date" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })} /></label>
            <label className="row small" style={{ gap: 6 }}>עד<input className="input sm" type="date" value={custom.to} min={custom.from} onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })} /></label>
          </span>
        )}
      </div>

      <div className="rp-kpis stagger" style={{ '--r': 1 } as React.CSSProperties}>
        <KpiTile icon={<FolderPlus size={18} />} label="תיקים שנפתחו" value={cur.opened} trend={<Trend cur={cur.opened} prev={before.opened} title={`${prevText}: ${before.opened}`} />} spark={r.spark.opened} />
        <KpiTile icon={<FolderCheck size={18} />} tone="success" label="תיקים שנסגרו" value={cur.closed} trend={<Trend cur={cur.closed} prev={before.closed} title={`${prevText}: ${before.closed}`} />} spark={r.spark.closed} />
        <KpiTile icon={<PiggyBank size={18} />} tone="violet" label="סה״כ תקציב" value={cur.budget} format={money} trend={<Trend cur={cur.budget} prev={before.budget} title={`${prevText}: ${money(before.budget)}`} />} spark={r.spark.budget} />
        <KpiTile icon={<Receipt size={18} />} tone="warning" label="סה״כ הוצאות" value={cur.expenses} format={money} trend={<Trend cur={cur.expenses} prev={before.expenses} goodUp={false} title={`${prevText}: ${money(before.expenses)}`} />} spark={r.spark.expenses} />
        <KpiTile icon={<Scale size={18} />} tone={cur.balance < 0 ? 'danger' : 'success'} label="יתרה" value={cur.balance} format={money} trend={<Trend cur={cur.balance} prev={before.balance} title={`${prevText}: ${money(before.balance)}`} />} spark={balanceSpark} />
        <KpiTile icon={<CheckSquare size={18} />} label="משימות שהושלמו" value={cur.tasks} trend={<Trend cur={cur.tasks} prev={before.tasks} title={`${prevText}: ${before.tasks}`} />} spark={r.spark.tasks} />
      </div>

      <div className="grid rp-hero stagger" style={{ '--r': 2 } as React.CSSProperties}>
        <Card title={<div className="row"><TrendingUp size={17} /><div><h2>הכנסות ורווח גולמי לפי חודש</h2><div className="tiny muted">הצעות שאושרו · לפני מע״מ</div></div></div>} pad>
          <div className="rp-hero-fig">
            <div>
              <div className="tiny muted">הכנסות בטווח</div>
              <div className="rp-big"><CountUp value={r.revenue} format={money} /></div>
              <Trend cur={r.revenue} prev={revPrev} title={`${prevText}: ${money(revPrev)}`} />
            </div>
            <div>
              <div className="tiny muted">רווח גולמי</div>
              <div className="rp-mid"><CountUp value={r.profit} format={money} /></div>
              <div className="tiny muted">{r.approved.length} עסקאות</div>
            </div>
            <Legend line series={[{ key: 'rev', label: 'הכנסות', color: 'var(--brand)' }, { key: 'profit', label: 'רווח גולמי', color: 'var(--violet)' }]} />
          </div>
          <AreaChart partialLast={r.months[r.months.length - 1].to > ymd(new Date())} labels={r.months.map((m) => m.label)} format={money} axisFormat={compactMoney} height={250}
            series={[{ key: 'rev', label: 'הכנסות', color: 'var(--brand)' }, { key: 'profit', label: 'רווח גולמי', color: 'var(--violet)' }]}
            data={[r.rev.revenue, r.rev.profit]} />
        </Card>
        <Card title="יעילות מכירות" pad>
          <div className="rp-eff">
            <Ring value={conv} label="יחס סגירה" sub={`${r.approved.length} מתוך ${r.decided.length} הצעות שהוכרעו`} />
            <Ring value={r.revenue ? (r.profit / r.revenue) * 100 : 0} color="var(--violet)" label="שיעור רווח גולמי" sub="מתוך ההכנסות בטווח" />
            <div className="rp-eff-row">
              <Clock size={18} className="muted" />
              <div className="grow">
                <div className="small strong">מהירות העסקה</div>
                <div className="tiny muted">ימים מליד להצעה, ומהצעה לאישור</div>
              </div>
              <b className="rp-mid num"><CountUp value={r.leadToQuote} decimals={1} /> + <CountUp value={r.quoteToApprove} decimals={1} /></b>
            </div>
            <div className="rp-eff-row">
              <Repeat size={18} className="muted" />
              <div className="grow">
                <div className="small strong">הכנסה חוזרת מחוזים</div>
                <div className="tiny muted">לשנה, חוזים פעילים</div>
              </div>
              <b className="rp-mid"><CountUp value={r.recurring} format={money} /></b>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid rp-hero stagger" style={{ '--r': 3 } as React.CSSProperties}>
        <Card title={<div><h2>תיקים שנפתחו לפי חודש וסוג פרויקט</h2><div className="tiny muted">החודשים שמחוץ לטווח מעומעמים</div></div>} pad>
          {r.typeData.every((d) => d.every((v) => !v)) ? <Empty title="אין תיקים בתקופה" /> : (
            <>
              <Columns labels={r.months.map((m) => m.label)} series={r.typeSeries} data={r.typeData} dim={r.outside} totalLabel="תיקים" height={250} />
              <Legend series={r.typeSeries} />
            </>
          )}
        </Card>
        <Card title={<div><h2>תיקים לפי סטטוס</h2><div className="tiny muted">תיקים שנפתחו בטווח</div></div>} pad>
          {!r.byStage.length ? <Empty title="אין תיקים בתקופה" /> : <Donut parts={r.byStage} centerLabel="תיקים" size={156} />}
        </Card>
      </div>

      <div className="grid g2 rp-pair stagger" style={{ '--r': 4 } as React.CSSProperties}>
        <Card title={<div><h2>ערך הצנרת הפתוחה לפי שלב</h2><div className="tiny muted">סכום ההצעה האחרונה בכל תיק פתוח</div></div>} pad>
          <BarList ramp labelWidth={110} format={compactMoney} rows={r.pipeValue.map((p) => ({ key: p.st, label: stageLabel[p.st], value: p.v || 0, display: <span>{p.v ? compactMoney(p.v) : '—'} <span className="tiny muted">· {p.n} תיקים</span></span> }))} />
        </Card>
        <Card title={<div><h2>מאיפה מגיעים הלקוחות</h2><div className="tiny muted">פניות בטווח, ואחוז ההמרה לעסקה</div></div>} pad>
          {r.sources.length === 0 ? <Empty title="אין נתונים בטווח" /> : (
            <BarList labelWidth={110} rows={[...r.sources].sort((a, b) => b.n - a.n).map((x) => ({ key: x.s, label: sourceLabel[x.s], value: x.n, display: <span>{x.n} <span className="tiny muted">· {pct((x.won / x.n) * 100)} המרה</span></span> }))} />
          )}
        </Card>
      </div>

      <div className="grid g2 rp-pair stagger" style={{ '--r': 5 } as React.CSSProperties}>
        <Card title={<div><h2>לקוחות מובילים</h2><div className="tiny muted">לפי הכנסות ותקציב בטווח</div></div>} pad>
          {r.topCustomers.length === 0 ? <Empty title="אין פעילות לקוחות בתקופה" /> : (
            <BarList labelWidth={150} format={money} rows={r.topCustomers.map((x) => ({
              key: x.c.id, label: <Link to={`/customers/${x.c.id}`} className="strong">{x.c.name}</Link>, value: Math.max(x.revenue, x.budget),
              sub: `${x.cases} תיקים${x.active ? ` (${x.active} פעילים)` : ''} · תקציב ${compactMoney(x.budget)} · הוצאות ${compactMoney(x.expenses)}`,
            }))} />
          )}
        </Card>
        <Card title={<div><h2>מכירות לפי סוכן</h2><div className="tiny muted">ערך העסקאות שאושרו בטווח</div></div>} pad>
          <BarList labelWidth={130} format={money} rows={[...r.agents].sort((a, b) => b.value - a.value).map((a) => ({
            key: a.u.id, label: <span className="row" style={{ gap: 8 }}><Avatar user={a.u} /><span className="small strong">{a.u.name}</span></span>, value: a.value,
            sub: `${a.cases} תיקים חדשים · ${a.sent} הצעות`, display: <span>{money(a.value)} <span className="tiny muted">· {a.won} עסקאות · {pct(a.conv)}</span></span>,
          }))} />
        </Card>
      </div>

      <Card title="ביצועי סוכנים" className="rp-table">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>סוכן</th><th>נפתחו</th><th>נסגרו</th><th className="end">תקציב</th><th className="end">הוצאות</th><th>ניצול תקציב</th><th className="end">עמלות</th></tr></thead>
            <tbody>
              {r.agentRows.map((a) => (
                <tr key={a.id || 'none'}>
                  <td>{a.u ? <span className="row"><Avatar user={a.u} /><span className="small strong">{a.u.name}</span></span> : <span className="small muted">ללא סוכן</span>}</td>
                  <td className="small num">{a.opened}</td>
                  <td className="small num">{a.closed}</td>
                  <td className="end small num">{money(a.budget)}</td>
                  <td className="end small num">{money(a.expenses)}</td>
                  <td className="small num" style={{ minWidth: 110 }}>{a.budget ? <span className="row" style={{ gap: 6 }}><span className="grow"><Progress value={a.util} /></span><span className={a.util > 100 ? 'txt-danger' : ''}>{pct(a.util)}</span></span> : <span className="muted">—</span>}</td>
                  <td className="end small num">{money(a.commission)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="תפוקת מתקינים"
        actions={<span className="row small no-print" style={{ gap: 6 }}>עלות יום עבודה <CommitInput className="input sm num" style={{ width: 84 }} type="number" value={String(r.dayCost)} ariaLabel="עלות יום עבודה" onCommit={(v) => setConfig({ installerDayCost: Math.max(0, Number(v) || 0) })} /> ₪</span>}
      >
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>שם</th><th>עבודות שהושלמו</th><th>קריאות שירות</th><th>משימות</th><th>ימי עבודה</th><th className="hide-mobile">שעות בשטח</th><th className="end">עלות כוללת</th><th>ממוצע ליום</th></tr></thead>
            <tbody>
              {r.installers.map((x) => (
                <tr key={x.u.id}>
                  <td><span className="row"><Avatar user={x.u} /><span className="small">{x.u.name}</span></span></td>
                  <td className="small num">{x.jobs}</td>
                  <td className="small num">{x.calls}</td>
                  <td className="small num">{x.tasks}</td>
                  <td className="small num">{x.days}</td>
                  <td className="small num hide-mobile">{x.hours.toFixed(1)}</td>
                  <td className="end small num">{money(x.cost)}</td>
                  <td className="small num">{x.days ? `${x.perDay.toFixed(1)} עבודות` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card-body tiny muted">ימי עבודה: ימים שבהם הושלמה התקנה, ביקור או קריאת שירות. העלות לפי עלות יום עבודה (<span className="ltr">{money(r.dayCost)}</span>).</div>
      </Card>

      <div className="grid g2 rp-pair">
        <Card title={<div className="row"><Wrench size={17} /><div><h2>שירות</h2><div className="tiny muted">קריאות שירות לפי חודש</div></div></div>} pad>
          <div className="rp-service">
            <div><div className="tiny muted">פתוחות עכשיו</div><div className="rp-mid"><CountUp value={r.service.open} /></div></div>
            <div><div className="tiny muted">טופלו בטווח</div><div className="rp-mid"><CountUp value={r.service.closed} /></div></div>
            <div><div className="tiny muted">זמן טיפול ממוצע</div><div className="rp-mid">{r.service.avgHours ? <><CountUp value={Math.round(r.service.avgHours)} /> ש׳</> : '—'}</div></div>
            <div><div className="tiny muted">הכנסות משירות</div><div className="rp-mid"><CountUp value={r.service.revenue} format={money} /></div></div>
          </div>
          <Columns labels={r.months.map((m) => m.label)} series={[{ key: 'calls', label: 'קריאות', color: 'var(--brand)' }]} data={[r.spark.service]} dim={r.outside} totalLabel="קריאות" height={170} />
          <div className="mt12"><Ring value={r.service.warranty} label="באחריות" sub="מהקריאות שטופלו בטווח" size={60} /></div>
        </Card>
        <Card title={<div><h2>למה הפסדנו עסקאות</h2><div className="tiny muted">תיקים שנסגרו בלי עסקה בטווח</div></div>} pad>
          {r.lostReasons.length === 0 ? <Empty title="אין עסקאות שהפסדנו בטווח" /> : (
            <BarList labelWidth={170} color="var(--text-3)" rows={[...r.lostReasons].sort((a, b) => b[1] - a[1]).map(([reason, n]) => ({ key: reason, label: reason, value: n }))} />
          )}
        </Card>
      </div>
      <div className="tiny muted no-print">נתוני הטווח מתחילים ב-{date(from)}. תקציב והוצאות לפי תאריך התנועה בכספי התיק.</div>
    </div>
  )
}
