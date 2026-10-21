// כספי התיק ("ניהול פיננסי"): תקציב מול הוצאות, עמלות ותשלומים, מול ההצעה המאושרת
import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { BadgePercent, Banknote, Calculator, Coins, Download, FileText, LayoutGrid, List, Pencil, PiggyBank, Plus, Receipt, RefreshCw, Scale, Trash2, TrendingUp, Wallet } from 'lucide-react'
import { useApp } from '../../lib/store'
import { Badge, Callout, Card, Confirm, Empty, Field, Modal, Progress, Stat, toast } from '../../components/ui'
import { Dot } from '../case/controls'
import { date, money, pct, uid, ymd } from '../../lib/format'
import { totals, type QuoteTotals } from '../../lib/quote'
import { choices } from '../../lib/config'
import { commissionFor } from '../../lib/commission'
import { download } from '../../lib/integrations/links'
import type { CatalogItem, Config, ID, ListOption, MoneyLine, Quote, Supplier, User } from '../../lib/types'
import { MarkDepositPaid, depositText } from '../quotes/parts'
import '../../features/ops/ops.css'
import './money.css'

type Kind = MoneyLine['kind']
const kindLabel: Record<Kind, string> = { budget: 'סעיף תקציב', expense: 'הוצאה', commission: 'עמלה', payment: 'תשלום מהלקוח', invoice: 'חשבונית' }
const sectionTitle: Record<Kind, string> = { budget: 'סעיפי תקציב', expense: 'הוצאות', commission: 'עמלות', payment: 'תשלומים מהלקוח', invoice: 'חשבוניות מ-Priority' }
const sectionIcon: Record<Kind, ReactNode> = { budget: <PiggyBank size={17} />, expense: <Receipt size={17} />, commission: <BadgePercent size={17} />, payment: <Banknote size={17} />, invoice: <FileText size={17} /> }
const VIEW_KEY = 'genair-money-view'
const isPaid = (l: MoneyLine) => l.status === 'paid'
// חשבוניות וקבלות שהגיעו מ-Priority משתנות שם בלבד
const fromPriority = (l: MoneyLine) => l.source === 'priority'
const PriorityTag = () => <span className="badge brand nowrap" title="הגיע מ-Priority ומתעדכן משם"><RefreshCw size={11} /> Priority</span>

function readView(): 'table' | 'cards' {
  try {
    return localStorage.getItem(VIEW_KEY) === 'cards' ? 'cards' : 'table'
  } catch {
    return 'table'
  }
}

export function MoneyTab({ caseId }: { caseId: ID }) {
  const all = useApp((s) => s.db.money)
  const quotes = useApp((s) => s.db.quotes)
  const catalog = useApp((s) => s.db.catalog)
  const k = useApp((s) => s.db.cases.find((x) => x.id === caseId))
  const users = useApp((s) => s.db.users)
  const suppliers = useApp((s) => s.db.suppliers)
  const pos = useApp((s) => s.db.purchaseOrders)
  const cfg = useApp((s) => s.db.config)
  const patch = useApp((s) => s.patch)
  const remove = useApp((s) => s.remove)
  const upsert = useApp((s) => s.upsert)
  const [view, setViewState] = useState<'table' | 'cards'>(readView)
  const [edit, setEdit] = useState<{ kind: Kind; line?: MoneyLine; preset?: Partial<MoneyLine> } | null>(null)
  const [budgetOpen, setBudgetOpen] = useState(false)
  const [del, setDel] = useState<MoneyLine | null>(null)
  const setView = (v: 'table' | 'cards') => {
    setViewState(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      /* בלי זיכרון */
    }
  }

  const lines = useMemo(() => all.filter((m) => m.caseId === caseId).sort((a, b) => b.at.localeCompare(a.at)), [all, caseId])
  const approved = useMemo(() => quotes.filter((q) => q.caseId === caseId && q.status === 'approved').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0], [quotes, caseId])
  const qt = useMemo(() => (approved ? totals(approved, catalog) : undefined), [approved, catalog])
  const by = (kind: Kind) => lines.filter((l) => l.kind === kind)
  const sum = (xs: MoneyLine[]) => xs.reduce((s, l) => s + l.amount, 0)
  const budget = sum(by('budget'))
  const expenses = sum(by('expense'))
  const commissions = sum(by('commission'))
  const pending = sum(by('commission').filter((l) => !isPaid(l)))
  const paid = sum(by('payment'))
  const invoiced = sum(by('invoice'))
  const util = budget ? (expenses / budget) * 100 : 0
  const left = budget - expenses
  // רווח: מההצעה המאושרת פחות הוצאות (או התקציב, אם עוד אין הוצאות) ועמלות
  const plannedCost = expenses || budget || qt?.cost || 0
  const profit = qt ? qt.net - plannedCost - commissions : 0
  const profitPct = qt?.net ? (profit / qt.net) * 100 : 0
  const due = qt ? Math.max(0, qt.total - paid) : 0
  const suggested = k && qt ? commissionFor(k, qt) : null
  const hasRuleCommission = by('commission').some((l) => l.agentId === k?.agentId || l.userId === k?.agentId)

  if (!k) return null
  const ctx: Ctx = { cfg, users, suppliers, pos }

  const exportCsv = () => {
    const rows = [['סוג', 'תאריך', 'קטגוריה / סוג סעיף', 'תיאור', 'ספק', 'סוכן', 'אמצעי תשלום', 'סטטוס', 'סכום']]
    for (const l of lines) rows.push([kindLabel[l.kind], l.at, catText(l, cfg), l.description, suppliers.find((s) => s.id === l.supplierId)?.name ?? '', users.find((u) => u.id === (l.agentId ?? l.userId))?.name ?? '', optLabel(cfg.paymentMethods, l.method), l.kind === 'commission' ? (isPaid(l) ? 'שולם' : 'ממתין') : '', String(l.amount)])
    rows.push([], ['תקציב', '', '', '', '', '', '', '', String(budget)], ['הוצאות', '', '', '', '', '', '', '', String(expenses)], ['עמלות', '', '', '', '', '', '', '', String(commissions)], ['תשלומים', '', '', '', '', '', '', '', String(paid)])
    const csv = '﻿' + rows.map((r) => r.map((x) => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${k.number}-finance-${ymd()}.csv`)
  }

  return (
    <div className="col money" style={{ gap: 16 }}>
      <div className="stat-row money-kpis">
        <Stat icon={<PiggyBank size={20} />} label="תקציב" value={<span className="mv">{money(budget)}</span>} delta={by('budget').length ? `${by('budget').length} סעיפים` : 'עוד לא נבנה'} />
        <Stat icon={<Receipt size={20} />} tone="warning" label="הוצאות" value={<span className="mv">{money(expenses)}</span>} delta={`${by('expense').length} תנועות`} />
        <Stat icon={<Scale size={20} />} tone={left < 0 ? 'danger' : 'success'} label="יתרה בתקציב" value={<span className={`mv ${left < 0 ? 'txt-danger' : ''}`}>{money(left)}</span>} delta={left < 0 ? 'חריגה מהתקציב' : budget ? 'נשאר לנצל' : '—'} />
        <Stat icon={<Calculator size={20} />} tone={util > 100 ? 'danger' : util > 85 ? 'warning' : 'brand'} label="ניצול תקציב" value={<span className="mv">{budget ? pct(util) : '—'}</span>} delta={budget ? <Progress value={util} /> : 'אין תקציב'} />
        <Stat icon={<TrendingUp size={20} />} tone={profit >= 0 ? 'success' : 'danger'} label={expenses ? 'רווח' : 'רווח צפוי'} value={<span className="mv">{qt ? pct(profitPct) : '—'}</span>} delta={qt ? money(profit) : 'אין הצעה מאושרת'} />
        <Stat icon={<BadgePercent size={20} />} tone="violet" label="עמלות ממתינות" value={<span className="mv">{money(pending)}</span>} delta={commissions ? `מתוך ${money(commissions)}` : 'אין עמלות'} />
        <Stat icon={<Wallet size={20} />} tone={due > 0 ? 'warning' : 'success'} label="שולם / יתרה לגבייה" value={<span className="mv">{money(paid)}</span>} delta={qt ? (due > 0 ? `נשאר לגבות ${money(due)}` : 'שולם במלואו') : 'אין הצעה מאושרת'} />
        {invoiced > 0 && <Stat icon={<FileText size={20} />} tone="brand" label="חויב ב-Priority" value={<span className="mv">{money(invoiced)}</span>} delta={`${by('invoice').length} חשבוניות`} />}
      </div>

      <div className="row between wrap money-bar">
        <div className="row wrap" style={{ gap: 6 }}>
          {approved ? (
            <button className="btn sm primary" onClick={() => setBudgetOpen(true)}><Calculator size={15} /> {by('budget').length ? 'עדכון תקציב מההצעה' : 'יצירת תקציב'}</button>
          ) : <span className="small muted">התקציב נבנה מהצעת מחיר מאושרת</span>}
          {approved && <span className="tiny muted">הצעה מאושרת <Link to={`/quotes/${approved.id}`} className="ltr">{approved.number}</Link> · {money(qt!.net)} לפני מע״מ</span>}
        </div>
        <div className="row wrap" style={{ gap: 6 }}>
          <div className="seg" role="group" aria-label="תצוגה">
            <button className={view === 'table' ? 'on' : ''} onClick={() => setView('table')} aria-label="טבלה"><List size={15} /></button>
            <button className={view === 'cards' ? 'on' : ''} onClick={() => setView('cards')} aria-label="כרטיסים"><LayoutGrid size={15} /></button>
          </div>
          <button className="btn sm" onClick={exportCsv} disabled={!lines.length}><Download size={15} /> CSV</button>
        </div>
      </div>

      {(['budget', 'expense', 'commission', 'payment', 'invoice'] as Kind[]).map((kind) => {
        const list = by(kind)
        if (kind === 'invoice' && !list.length) return null
        return (
          <Card
            key={kind}
            title={<div className="row" style={{ gap: 8 }}><span className="money-ico">{sectionIcon[kind]}</span><h2>{sectionTitle[kind]}</h2><Badge tone="muted">{list.length}</Badge><span className="small strong num">{money(sum(list))}</span></div>}
            actions={kind === 'invoice' ? <span className="tiny muted">מתעדכן אוטומטית מ-Priority</span> : <button className="btn sm" onClick={() => setEdit({ kind })}><Plus size={15} /> {kind === 'budget' ? 'סעיף' : kind === 'expense' ? 'הוצאה' : kind === 'commission' ? 'עמלה' : 'תשלום'}</button>}
          >
            {kind === 'payment' && approved?.deposit && !approved.deposit.paidAt && (
              <div className="card-body" style={{ paddingBottom: 0 }}>
                <Callout tone="warning">
                  <div className="row between wrap" style={{ gap: 8 }}>
                    <span>{depositText(approved)} (הצעה <span className="ltr">{approved.number}</span>). התקבול נרשם כאן רק אחרי שמסמנים אותה כשולמה.</span>
                    <MarkDepositPaid q={approved} />
                  </div>
                </Callout>
              </div>
            )}
            {kind === 'commission' && suggested && !hasRuleCommission && (
              <div className="card-body" style={{ paddingBottom: 0 }}>
                <Callout>
                  <div className="row between wrap" style={{ gap: 8 }}>
                    <span>לפי הכלל "{suggested.ruleName}": {users.find((u) => u.id === k.agentId)?.name} מקבל {suggested.label} — <b className="num">{money(suggested.amount)}</b></span>
                    <button className="btn sm primary" onClick={() => upsert('money', { id: uid('mn'), caseId, kind: 'commission', category: 'עמלת סוכן', description: `${users.find((u) => u.id === k.agentId)?.name ?? ''} — ${suggested.label}`, amount: suggested.amount, at: ymd(), userId: k.agentId, agentId: k.agentId, status: 'pending' })}>
                      <Plus size={15} /> רישום העמלה
                    </button>
                  </div>
                </Callout>
              </div>
            )}
            {kind === 'commission' && !k.agentId && !list.length && <div className="card-body small muted">לתיק אין סוכן, ולכן לא מחושבת עמלה אוטומטית.</div>}
            {list.length === 0 ? (
              kind === 'budget' && approved ? <Empty title="עוד אין תקציב"><button className="btn sm primary mt8" onClick={() => setBudgetOpen(true)}><Calculator size={15} /> יצירת תקציב מההצעה</button></Empty> : <Empty title={`אין ${sectionTitle[kind]}`} />
            ) : view === 'table' ? (
              <LinesTable kind={kind} list={list} total={sum(list)} budget={budget} ctx={ctx} onEdit={(l) => setEdit({ kind, line: l })} onDelete={setDel} onTogglePaid={(l) => patch('money', l.id, { status: isPaid(l) ? 'pending' : 'paid' })} />
            ) : (
              <div className="money-cards">
                {list.map((l) => <LineCard key={l.id} l={l} ctx={ctx} onEdit={() => setEdit({ kind, line: l })} onDelete={() => setDel(l)} onTogglePaid={() => patch('money', l.id, { status: isPaid(l) ? 'pending' : 'paid' })} />)}
              </div>
            )}
          </Card>
        )
      })}

      {edit && <LineDialog caseId={caseId} kind={edit.kind} line={edit.line} agentId={k.agentId} projectType={k.projectType} qt={qt} onClose={() => setEdit(null)} />}
      {budgetOpen && approved && <BudgetDialog caseId={caseId} quote={approved} catalog={catalog} types={cfg.budgetItemTypes} existing={by('budget')} onClose={() => setBudgetOpen(false)} />}
      {del && <Confirm title="מחיקת שורה" text={`למחוק את "${del.description}" (${money(del.amount)})?`} confirmLabel="מחיקה" danger onConfirm={() => remove('money', del.id)} onClose={() => setDel(null)} />}
    </div>
  )
}

interface Ctx { cfg: Config; users: User[]; suppliers: Supplier[]; pos: { id: ID; number: string }[] }
const optLabel = (list: ListOption[], key?: string) => (key ? list.find((o) => o.key === key)?.label ?? key : '')
const optColor = (list: ListOption[], key?: string) => (key ? list.find((o) => o.key === key)?.color : undefined)
function catText(l: MoneyLine, cfg: Config) {
  if (l.kind === 'budget') return l.budgetType ? optLabel(cfg.budgetItemTypes, l.budgetType) : l.category
  if (l.kind === 'expense') return optLabel(cfg.expenseCategories, l.category)
  return l.category
}
const catColor = (l: MoneyLine, cfg: Config) => (l.kind === 'budget' ? optColor(cfg.budgetItemTypes, l.budgetType) : l.kind === 'expense' ? optColor(cfg.expenseCategories, l.category) : undefined)

function LinesTable({ kind, list, total, budget, ctx, onEdit, onDelete, onTogglePaid }: { kind: Kind; list: MoneyLine[]; total: number; budget: number; ctx: Ctx; onEdit: (l: MoneyLine) => void; onDelete: (l: MoneyLine) => void; onTogglePaid: (l: MoneyLine) => void }) {
  const { cfg, users, suppliers, pos } = ctx
  return (
    <div className="table-wrap">
      <table className="table money-table">
        <thead>
          <tr>
            {kind !== 'budget' && <th>תאריך</th>}
            {kind === 'budget' && <th>סוג סעיף</th>}
            {kind === 'expense' && <th>קטגוריה</th>}
            {kind === 'expense' && <th>ספק</th>}
            {kind === 'commission' && <th>סוכן</th>}
            <th>תיאור</th>
            {(kind === 'expense' || kind === 'payment') && <th className="hide-mobile">אמצעי תשלום</th>}
            {kind === 'commission' && <th>סטטוס</th>}
            {kind === 'budget' && <th className="hide-mobile">חלק מהתקציב</th>}
            <th className="end">סכום</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.map((l) => {
            const sup = suppliers.find((s) => s.id === l.supplierId)
            const po = pos.find((p) => p.id === l.purchaseOrderId)
            const agent = users.find((u) => u.id === (l.agentId ?? l.userId))
            return (
              <tr key={l.id}>
                {kind !== 'budget' && <td className="small nowrap">{date(l.at)}</td>}
                {(kind === 'budget' || kind === 'expense') && <td className="small nowrap"><Dot color={catColor(l, cfg)} /> {catText(l, cfg)}</td>}
                {kind === 'expense' && <td className="small">{sup ? <Link to={`/suppliers?id=${sup.id}`}>{sup.name}</Link> : <span className="muted">—</span>}</td>}
                {kind === 'commission' && <td className="small nowrap">{agent?.name ?? '—'}</td>}
                <td className="small">{l.description}{po && <> <Link to={`/suppliers?po=${po.id}`} className="badge brand ltr">{po.number}</Link></>}</td>
                {(kind === 'expense' || kind === 'payment') && <td className="small hide-mobile">{optLabel(cfg.paymentMethods, l.method) || '—'}</td>}
                {kind === 'commission' && <td><button className={`badge ${isPaid(l) ? 'success' : 'warning'} money-status`} onClick={() => onTogglePaid(l)} disabled={fromPriority(l)} title="החלפת סטטוס">{isPaid(l) ? 'שולם' : 'ממתין'}</button></td>}
                {kind === 'budget' && <td className="small hide-mobile num" style={{ minWidth: 120 }}><span className="row" style={{ gap: 6 }}><span className="grow"><Progress value={budget ? (l.amount / budget) * 100 : 0} /></span>{budget ? pct((l.amount / budget) * 100) : ''}</span></td>}
                <td className="end num small strong nowrap">{money(l.amount)}</td>
                <td className="end nowrap">
                  {fromPriority(l) ? <PriorityTag /> : <>
                    <button className="icon-btn sm" onClick={() => onEdit(l)} aria-label="עריכה"><Pencil size={15} /></button>
                    <button className="icon-btn sm" onClick={() => onDelete(l)} aria-label="מחיקה"><Trash2 size={15} /></button>
                  </>}
                </td>
              </tr>
            )
          })}
          <tr className="money-total"><td colSpan={kind === 'expense' ? 5 : kind === 'budget' ? 3 : kind === 'commission' ? 4 : kind === 'invoice' ? 2 : 3} className="small strong">סה״כ</td><td className="end num strong nowrap">{money(total)}</td><td /></tr>
        </tbody>
      </table>
    </div>
  )
}

function LineCard({ l, ctx, onEdit, onDelete, onTogglePaid }: { l: MoneyLine; ctx: Ctx; onEdit: () => void; onDelete: () => void; onTogglePaid: () => void }) {
  const { cfg, users, suppliers } = ctx
  const sup = suppliers.find((s) => s.id === l.supplierId)
  const agent = users.find((u) => u.id === (l.agentId ?? l.userId))
  return (
    <div className="money-card" style={{ borderInlineStartColor: catColor(l, cfg) ?? 'var(--line)' }}>
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <div className="small strong">{l.description}</div>
          <div className="tiny muted">{[l.kind !== 'budget' ? date(l.at) : '', catText(l, cfg), sup?.name, l.kind === 'commission' ? agent?.name : '', optLabel(cfg.paymentMethods, l.method)].filter(Boolean).join(' · ')}</div>
        </div>
        <b className="num nowrap">{money(l.amount)}</b>
      </div>
      <div className="row between mt8">
        {l.kind === 'commission' ? <button className={`badge ${isPaid(l) ? 'success' : 'warning'} money-status`} onClick={onTogglePaid}>{isPaid(l) ? 'שולם' : 'ממתין'}</button> : <span />}
        {fromPriority(l) ? <PriorityTag /> : (
          <span className="row" style={{ gap: 2 }}>
            <button className="icon-btn sm" onClick={onEdit} aria-label="עריכה"><Pencil size={15} /></button>
            <button className="icon-btn sm" onClick={onDelete} aria-label="מחיקה"><Trash2 size={15} /></button>
          </span>
        )}
      </div>
    </div>
  )
}

function LineDialog({ caseId, kind, line, agentId, projectType, qt, onClose }: { caseId: ID; kind: Kind; line?: MoneyLine; agentId?: ID; projectType: string; qt?: QuoteTotals; onClose: () => void }) {
  const cfg = useApp((s) => s.db.config)
  const users = useApp((s) => s.db.users)
  const suppliers = useApp((s) => s.db.suppliers)
  const upsert = useApp((s) => s.upsert)
  const firstKey = (l: ListOption[]) => l.find((o) => o.active)?.key ?? ''
  const [f, setF] = useState<MoneyLine>(() => line ?? {
    id: uid('mn'), caseId, kind, amount: 0, at: ymd(), description: '',
    category: kind === 'expense' ? firstKey(cfg.expenseCategories) : kind === 'commission' ? 'עמלת סוכן' : kind === 'payment' ? 'תשלום' : '',
    ...(kind === 'budget' ? { budgetType: firstKey(cfg.budgetItemTypes) } : {}),
    ...(kind === 'commission' ? { agentId, userId: agentId, status: 'pending' as const } : {}),
  })
  const [amount, setAmount] = useState(line ? String(line.amount) : '')
  const set = (p: Partial<MoneyLine>) => setF((x) => ({ ...x, ...p }))
  const agents = users.filter((u) => u.active && (u.role === 'agent' || u.role === 'admin' || u.id === f.agentId))
  const rule = kind === 'commission' && f.agentId && qt ? commissionFor({ agentId: f.agentId, projectType }, qt) : null
  const activeSup = suppliers.filter((s) => s.active || s.id === f.supplierId).sort((a, b) => a.name.localeCompare(b.name, 'he'))
  const n = Number(amount)
  const ok = f.description.trim() && Number.isFinite(n) && n > 0
  const save = () => {
    const budgetLabel = cfg.budgetItemTypes.find((o) => o.key === f.budgetType)?.label
    upsert('money', { ...f, amount: Math.round(n * 100) / 100, description: f.description.trim(), ...(kind === 'budget' ? { category: budgetLabel ?? f.category } : {}), ...(kind === 'commission' ? { userId: f.agentId } : {}) })
    toast.success(line ? 'עודכן' : `נוסף: ${kindLabel[kind]}`)
    onClose()
  }
  return (
    <Modal title={`${line ? 'עריכת' : 'הוספת'} ${kindLabel[kind]}`} size="narrow" onClose={onClose} footer={<><button className="btn" onClick={onClose}>ביטול</button><button className="btn primary" disabled={!ok} onClick={save}>שמירה</button></>}>
      <div className="col" style={{ gap: 12 }}>
        {kind === 'budget' && (
          <Field label="סוג סעיף">
            <select className="select" value={f.budgetType ?? ''} onChange={(e) => set({ budgetType: e.target.value })}>
              {choices(cfg.budgetItemTypes, f.budgetType).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </Field>
        )}
        {kind === 'expense' && (
          <div className="grid g2" style={{ gap: 10 }}>
            <Field label="קטגוריה">
              <select className="select" value={f.category} onChange={(e) => set({ category: e.target.value })}>
                {choices(cfg.expenseCategories, f.category).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                {!cfg.expenseCategories.some((o) => o.key === f.category) && f.category && <option value={f.category}>{f.category}</option>}
              </select>
            </Field>
            <Field label="ספק">
              <select className="select" value={f.supplierId ?? ''} onChange={(e) => set({ supplierId: e.target.value || undefined })}>
                <option value="">בלי ספק</option>
                {activeSup.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          </div>
        )}
        {kind === 'commission' && (
          <div className="grid g2" style={{ gap: 10 }}>
            <Field label="סוכן">
              <select className="select" value={f.agentId ?? ''} onChange={(e) => set({ agentId: e.target.value || undefined })}>
                <option value="">בחירה...</option>
                {agents.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Field>
            <Field label="סטטוס">
              <select className="select" value={f.status ?? 'pending'} onChange={(e) => set({ status: e.target.value as MoneyLine['status'] })}>
                <option value="pending">ממתין לתשלום</option>
                <option value="paid">שולם</option>
              </select>
            </Field>
          </div>
        )}
        {rule && (
          <div className="tiny">
            לפי הכלל "{rule.ruleName}": {rule.label} = <b className="num">{money(rule.amount)}</b>{' '}
            <button className="btn sm ghost" onClick={() => { setAmount(String(rule.amount)); if (!f.description) set({ description: `${users.find((u) => u.id === f.agentId)?.name ?? ''} — ${rule.label}` }) }}>להשתמש</button>
          </div>
        )}
        <Field label="תיאור *"><input className="input" autoFocus value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder={kind === 'expense' ? 'חשבונית ספק, עבודה, הובלה...' : kind === 'payment' ? 'מקדמה, תשלום שני, יתרה...' : ''} /></Field>
        <div className="grid g2" style={{ gap: 10 }}>
          <Field label="סכום (₪) *"><input className="input num" type="number" inputMode="decimal" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          {kind !== 'budget' && <Field label="תאריך"><input className="input" type="date" value={f.at} onChange={(e) => set({ at: e.target.value || ymd() })} /></Field>}
        </div>
        {(kind === 'expense' || kind === 'payment') && (
          <Field label="אמצעי תשלום">
            <select className="select" value={f.method ?? ''} onChange={(e) => set({ method: e.target.value || undefined })}>
              <option value="">לא צוין</option>
              {choices(cfg.paymentMethods, f.method).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </Field>
        )}
      </div>
    </Modal>
  )
}

// תקציב מההצעה המאושרת: סעיף אחד לכל סוג, לפי עלות הקטלוג
const typeByCategory: Record<CatalogItem['category'], string> = { unit: 'equipment', heating: 'equipment', ventilation: 'equipment', accessory: 'equipment', material: 'equipment', labor: 'labor', service: 'services' }

function BudgetDialog({ caseId, quote, catalog, types, existing, onClose }: { caseId: ID; quote: Quote; catalog: CatalogItem[]; types: ListOption[]; existing: MoneyLine[]; onClose: () => void }) {
  const upsert = useApp((s) => s.upsert)
  const remove = useApp((s) => s.remove)
  const activeTypes = types.filter((t) => t.active)
  const fallback = activeTypes.find((t) => t.key === 'services')?.key ?? activeTypes[0]?.key ?? 'equipment'
  const [rows, setRows] = useState(() => {
    const factor = 1 - (quote.discountPct || 0) / 100
    const m = new Map<string, { amount: number; n: number; sale: number }>()
    for (const l of quote.lines) {
      const item = catalog.find((c) => c.id === l.itemId)
      let t = item ? typeByCategory[item.category] : fallback
      if (!activeTypes.some((x) => x.key === t)) t = fallback
      const cost = l.qty * (item?.cost ?? l.unitPrice * 0.6)
      const cur = m.get(t) ?? { amount: 0, n: 0, sale: 0 }
      m.set(t, { amount: cur.amount + cost, n: cur.n + 1, sale: cur.sale + l.qty * l.unitPrice * factor })
    }
    return activeTypes.filter((t) => m.has(t.key) || t.key === 'contingency').map((t) => {
      const v = m.get(t.key)
      const base = [...m.values()].reduce((s, x) => s + x.amount, 0)
      return { key: t.key, label: t.label, color: t.color, on: !!v || false, amount: Math.round(v ? v.amount : base * 0.05), note: v ? `${v.n} שורות בהצעה · מכירה ${money(v.sale)}` : 'בלתי צפוי: 5% מהעלות' }
    })
  })
  const [replace, setReplace] = useState(existing.length > 0)
  const total = rows.filter((r) => r.on).reduce((s, r) => s + r.amount, 0)
  const save = () => {
    if (replace) existing.forEach((l) => remove('money', l.id))
    rows.filter((r) => r.on && r.amount > 0).forEach((r) => upsert('money', { id: uid('mn'), caseId, kind: 'budget', budgetType: r.key, category: r.label, description: `${r.label} — לפי הצעה ${quote.number}`, amount: r.amount, at: ymd() }))
    toast.success(`נבנה תקציב של ${money(total)}`)
    onClose()
  }
  return (
    <Modal title={`יצירת תקציב מהצעה ${quote.number}`} onClose={onClose} footer={<><span className="grow small">סה״כ תקציב: <b className="num">{money(total)}</b></span><button className="btn" onClick={onClose}>ביטול</button><button className="btn primary" disabled={total <= 0} onClick={save}>שמירת התקציב</button></>}>
      <div className="col" style={{ gap: 12 }}>
        <div className="small muted">סעיף לכל סוג, לפי עלות הקטלוג של השורות בהצעה המאושרת. אפשר לשנות סכומים לפני השמירה.</div>
        <div className="list" style={{ border: '1px solid var(--line-2)', borderRadius: 12 }}>
          {rows.map((r, i) => (
            <div key={r.key} className={`list-item budget-row ${r.on ? '' : 'off'}`}>
              <input type="checkbox" checked={r.on} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} aria-label={`לכלול ${r.label}`} />
              <span className="grow">
                <span className="small strong" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Dot color={r.color} /> {r.label}</span>
                <span className="tiny muted">{r.note}</span>
              </span>
              <input className="input sm num" style={{ width: 110 }} type="number" min={0} value={r.amount} disabled={!r.on} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, amount: Math.max(0, Math.round(Number(e.target.value) || 0)) } : x)))} aria-label={`סכום ${r.label}`} />
            </div>
          ))}
        </div>
        {existing.length > 0 && <label className="check small"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> להחליף את {existing.length} הסעיפים הקיימים (אחרת יתווספו)</label>}
        <div className="tiny muted"><Coins size={12} /> סוגי הסעיפים מוגדרים בהגדרות ← רשימות ← סוגי סעיפי תקציב.</div>
      </div>
    </Modal>
  )
}
