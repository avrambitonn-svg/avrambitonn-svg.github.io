// דוחות: טווח תאריכים עם השוואה לתקופה הקודמת, תיקים, תקציב והוצאות, סוכנים, לקוחות מובילים, מתקינים, וייצוא ל-PDF
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowDown, ArrowUp, BadgeCheck, CheckSquare, Clock, Download, FileDown, FolderCheck, FolderPlus, Minus, Percent, PiggyBank, Receipt, Repeat, Scale, TrendingUp, Wrench,
} from 'lucide-react'
import { useApp } from '../../lib/store'
import { Avatar, Card, Empty, PageHead, Progress, Stat } from '../../components/ui'
import { pipeline, sourceLabel, stageColor, stageLabel } from '../../lib/labels'
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
const monthShort = new Intl.DateTimeFormat('he-IL', { month: 'short' })
const monthYear = new Intl.DateTimeFormat('he-IL', { month: 'short', year: '2-digit' })

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

function Delta({ cur, prev, goodUp = true, isMoney }: { cur: number; prev: number; goodUp?: boolean; isMoney?: boolean }) {
  if (!cur && !prev) return <span className="rp-delta flat"><Minus size={12} /> ללא שינוי</span>
  if (!prev) return <span className={`rp-delta ${goodUp ? 'good' : 'bad'}`}><ArrowUp size={12} /> חדש בתקופה</span>
  const d = ((cur - prev) / Math.abs(prev)) * 100
  const flat = Math.abs(d) < 0.5
  const up = d > 0
  const good = flat ? 'flat' : up === goodUp ? 'good' : 'bad'
  return (
    <span className={`rp-delta ${good}`} title={`בתקופה הקודמת: ${isMoney ? money(prev) : prev}`}>
      {flat ? <Minus size={12} /> : up ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
      <span className="ltr">{flat ? '0%' : `${up ? '+' : ''}${Math.round(d)}%`}</span> לעומת התקופה הקודמת
    </span>
  )
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

    // תיקים שנפתחו לפי חודש ולפי סוג פרויקט (לפחות 6 חודשים, עד סוף הטווח)
    const end = new Date(range.to + 'T00:00:00')
    const start = new Date(range.from + 'T00:00:00')
    const span = Math.max(6, (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth() + 1)
    const openedMonths = Array.from({ length: Math.min(span, 24) }, (_, i) => {
      const d = new Date(end.getFullYear(), end.getMonth() - (Math.min(span, 24) - 1 - i), 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const ks = db.cases.filter((k) => dayOf(k.createdAt).startsWith(key))
      const by: Record<string, number> = {}
      ks.forEach((k) => (by[k.projectType] = (by[k.projectType] ?? 0) + 1))
      const mEnd = ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0))
      return { key, label: (span > 12 ? monthYear : monthShort).format(d), by, n: ks.length, inside: mEnd >= range.from && `${key}-01` <= range.to }
    })
    const usedTypes = db.config.projectTypes.filter((t) => openedMonths.some((m) => m.by[t.key]))

    // תיקים לפי סטטוס (שנפתחו בטווח)
    const opened = db.cases.filter((k) => inRange(k.createdAt))
    const byStage = ([...pipeline, 'lost'] as CaseStage[]).map((st) => ({ st, n: opened.filter((k) => k.stage === st).length })).filter((x) => x.n > 0)

    return { approved, decided, sent, revenue, profit, leadToQuote, quoteToApprove, pipeValue, byMonth, sources, lostReasons, agents, agentRows, topCustomers, installers, service, recurring, openedMonths, usedTypes, byStage, openedCount: opened.length, dayCost }
  }, [db, range.from, range.to])

  const cur = useMemo(() => kpis(db, range), [db, range.from, range.to])
  const before = useMemo(() => kpis(db, prev), [db, prev.from, prev.to])
  const conv = r.decided.length ? (r.approved.length / r.decided.length) * 100 : 0
  const maxMonth = Math.max(1, ...r.byMonth.map((m) => m.v))
  const maxPipe = Math.max(1, ...r.pipeValue.map((p) => p.v))
  const maxOpened = Math.max(1, ...r.openedMonths.map((m) => m.n))

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
    <div className="col reports" style={{ gap: 16 }}>
      <div className="rp-print-head">
        <div><b className="rp-brand"><span>G</span>ENAIR</b> · דוח ניהולי</div>
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

      <div className="rp-kpis">
        <Stat icon={<FolderPlus size={20} />} label="תיקים שנפתחו" value={cur.opened} delta={<Delta cur={cur.opened} prev={before.opened} />} />
        <Stat icon={<FolderCheck size={20} />} tone="success" label="תיקים שנסגרו" value={cur.closed} delta={<Delta cur={cur.closed} prev={before.closed} />} />
        <Stat icon={<PiggyBank size={20} />} tone="violet" label="סה״כ תקציב" value={<span className="rp-mv">{money(cur.budget)}</span>} delta={<Delta cur={cur.budget} prev={before.budget} isMoney />} />
        <Stat icon={<Receipt size={20} />} tone="warning" label="סה״כ הוצאות" value={<span className="rp-mv">{money(cur.expenses)}</span>} delta={<Delta cur={cur.expenses} prev={before.expenses} goodUp={false} isMoney />} />
        <Stat icon={<Scale size={20} />} tone={cur.balance < 0 ? 'danger' : 'success'} label="יתרה" value={<span className="rp-mv">{money(cur.balance)}</span>} delta={<Delta cur={cur.balance} prev={before.balance} isMoney />} />
        <Stat icon={<CheckSquare size={20} />} label="משימות שהושלמו" value={cur.tasks} delta={<Delta cur={cur.tasks} prev={before.tasks} />} />
      </div>

      <div className="grid g4">
        <Stat icon={<BadgeCheck size={20} />} tone="success" label="הכנסות מאושרות (לפני מע״מ)" value={money(r.revenue)} delta={`${r.approved.length} עסקאות · רווח גולמי ${money(r.profit)}`} />
        <Stat icon={<Percent size={20} />} label="יחס סגירה" value={pct(conv)} delta={`${r.approved.length} מתוך ${r.decided.length} הצעות שהוכרעו`} />
        <Stat icon={<Clock size={20} />} tone="warning" label="מהירות העסקה" value={`${r.leadToQuote.toFixed(1)} + ${r.quoteToApprove.toFixed(1)}`} delta="ימים: מליד להצעה, ומהצעה לאישור" />
        <Stat icon={<Repeat size={20} />} tone="violet" label="הכנסה חוזרת מחוזים" value={money(r.recurring)} delta="לשנה, חוזים פעילים" />
      </div>

      <div className="grid g2 rp-pair">
        <Card title="תיקים שנפתחו לפי חודש וסוג פרויקט" pad>
          {r.openedMonths.every((m) => !m.n) ? <Empty title="אין תיקים בתקופה" /> : (
            <>
              <div className="rp-stack" role="img" aria-label="תיקים שנפתחו לפי חודש">
                {r.openedMonths.map((m) => (
                  <div key={m.key} className={`rp-col ${m.inside ? '' : 'out'}`} title={`${m.label}: ${m.n} תיקים`}>
                    {m.n > 0 && <span className="rp-n num">{m.n}</span>}
                    <div className="rp-bar" style={{ height: `${(m.n / maxOpened) * 100}%` }}>
                      {r.usedTypes.filter((t) => m.by[t.key]).map((t) => <div key={t.key} style={{ flexGrow: m.by[t.key], background: t.color ?? '#94a3b8' }} title={`${t.label}: ${m.by[t.key]}`} />)}
                    </div>
                    <span className="rp-lbl">{m.label}</span>
                  </div>
                ))}
              </div>
              <div className="rp-legend">{r.usedTypes.map((t) => <span key={t.key}><i style={{ background: t.color ?? '#94a3b8' }} />{t.label}</span>)}</div>
            </>
          )}
        </Card>
        <Card title="תיקים לפי סטטוס" pad>
          {!r.byStage.length ? <Empty title="אין תיקים בתקופה" /> : <Donut parts={r.byStage.map((x) => ({ key: x.st, label: stageLabel[x.st], n: x.n, color: stageColor(x.st) }))} total={r.openedCount} />}
        </Card>
      </div>

      <div className="grid g2 rp-pair">
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

      <Card title="ביצועי סוכנים">
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

      <div className="grid g2 rp-pair">
        <Card title="לקוחות מובילים">
          {r.topCustomers.length === 0 ? <Empty title="אין פעילות לקוחות בתקופה" /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>לקוח</th><th>תיקים</th><th className="end">תקציב</th><th className="end">הוצאות</th><th className="end hide-mobile">הכנסות</th></tr></thead>
                <tbody>
                  {r.topCustomers.map((x, i) => (
                    <tr key={x.c.id}>
                      <td className="small"><span className="rp-rank num">{i + 1}</span><Link to={`/customers/${x.c.id}`} className="strong">{x.c.name}</Link></td>
                      <td className="small num">{x.cases}{x.active ? <span className="tiny muted"> · {x.active} פעילים</span> : null}</td>
                      <td className="end small num">{money(x.budget)}</td>
                      <td className="end small num">{money(x.expenses)}</td>
                      <td className="end small num hide-mobile">{money(x.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="מכירות לפי סוכן">
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>סוכן</th><th>תיקים חדשים</th><th>הצעות</th><th>נסגרו</th><th>יחס סגירה</th><th className="end">ערך</th></tr></thead>
              <tbody>
                {r.agents.map((a) => (
                  <tr key={a.u.id}>
                    <td><span className="row"><Avatar user={a.u} /><span className="small strong">{a.u.name}</span></span></td>
                    <td className="small num">{a.cases}</td><td className="small num">{a.sent}</td><td className="small num">{a.won}</td><td className="small num">{pct(a.conv)}</td>
                    <td className="end small num strong">{money(a.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

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

      <Card title={<div className="row"><Wrench size={17} /><h2>שירות</h2></div>} pad>
        <div className="grid g4">
          <div><div className="tiny muted">פתוחות עכשיו</div><div className="strong num" style={{ fontSize: 22 }}>{r.service.open}</div></div>
          <div><div className="tiny muted">טופלו בטווח</div><div className="strong num" style={{ fontSize: 22 }}>{r.service.closed}</div></div>
          <div><div className="tiny muted">זמן טיפול ממוצע</div><div className="strong num" style={{ fontSize: 22 }}>{r.service.avgHours ? `${Math.round(r.service.avgHours)} ש׳` : '—'}</div></div>
          <div><div className="tiny muted">באחריות</div><div className="strong num" style={{ fontSize: 22 }}>{pct(r.service.warranty)}</div></div>
        </div>
        <div className="small mt12">הכנסות משירות בטווח: <b className="num">{money(r.service.revenue)}</b></div>
      </Card>
      <div className="tiny muted no-print">נתוני הטווח מתחילים ב-{date(from)}. תקציב והוצאות לפי תאריך התנועה בכספי התיק.</div>
    </div>
  )
}

function Donut({ parts, total }: { parts: { key: string; label: string; n: number; color: string }[]; total: number }) {
  const R = 54
  const C = 2 * Math.PI * R
  const sum = parts.reduce((s, p) => s + p.n, 0) || 1
  let acc = 0
  return (
    <div className="rp-donut">
      <svg viewBox="0 0 140 140" width="160" height="160" role="img" aria-label={`תיקים לפי סטטוס, ${total} תיקים`}>
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--line-2)" strokeWidth="20" />
        {parts.map((p) => {
          const len = (p.n / sum) * C
          const el = <circle key={p.key} cx="70" cy="70" r={R} fill="none" stroke={p.color} strokeWidth="20" strokeDasharray={`${Math.max(0, len - (parts.length > 1 ? 1.5 : 0))} ${C}`} strokeDashoffset={-acc} transform="rotate(-90 70 70)"><title>{`${p.label}: ${p.n}`}</title></circle>
          acc += len
          return el
        })}
        <text x="70" y="66" textAnchor="middle" className="rp-donut-n">{total}</text>
        <text x="70" y="86" textAnchor="middle" className="rp-donut-l">תיקים</text>
      </svg>
      <div className="rp-dlegend">
        {parts.map((p) => (
          <div key={p.key} className="row small" style={{ gap: 8 }}>
            <i style={{ background: p.color }} />
            <span className="grow">{p.label}</span>
            <b className="num">{p.n}</b>
            <span className="tiny muted num" style={{ width: 36, textAlign: 'end' }}>{pct((p.n / sum) * 100)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
