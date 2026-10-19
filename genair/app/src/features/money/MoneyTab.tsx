// כספי התיק: תקציב, הוצאות, עמלות ותשלומים מול ההצעה המאושרת
import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useApp } from '../../lib/store'
import { Badge, Card, Empty } from '../../components/ui'
import { date, money, uid, ymd } from '../../lib/format'
import { totals } from '../../lib/quote'
import type { ID, MoneyLine } from '../../lib/types'

export function MoneyTab({ caseId }: { caseId: ID }) {
  const all = useApp((s) => s.db.money)
  const quotes = useApp((s) => s.db.quotes)
  const catalog = useApp((s) => s.db.catalog)
  const upsert = useApp((s) => s.upsert)
  const remove = useApp((s) => s.remove)
  const lines = useMemo(() => all.filter((m) => m.caseId === caseId), [all, caseId])
  const approved = quotes.find((q) => q.caseId === caseId && q.status === 'approved')
  const quoteTotal = approved ? totals(approved, catalog) : undefined
  const [draft, setDraft] = useState<{ kind: MoneyLine['kind']; category: string; description: string; amount: string }>({ kind: 'expense', category: 'ציוד', description: '', amount: '' })
  const sumOf = (k: MoneyLine['kind']) => lines.filter((l) => l.kind === k).reduce((s, l) => s + l.amount, 0)
  const paid = sumOf('payment')
  const expenses = sumOf('expense')
  const commission = sumOf('commission')
  const budget = sumOf('budget')
  const kindLabel: Record<MoneyLine['kind'], string> = { budget: 'תקציב', expense: 'הוצאה', commission: 'עמלה', payment: 'תשלום מהלקוח' }
  return (
    <div className="grid g-side">
      <Card title="תנועות">
        <form className="row wrap" style={{ padding: '12px 18px', borderBottom: '1px solid var(--line-2)' }} onSubmit={(e) => {
          e.preventDefault()
          if (!draft.amount || !draft.description) return
          upsert('money', { id: uid('mn'), caseId, kind: draft.kind, category: draft.category, description: draft.description, amount: Number(draft.amount), at: ymd() })
          setDraft({ ...draft, description: '', amount: '' })
        }}>
          <select className="select sm" style={{ width: 'auto' }} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as MoneyLine['kind'] })}>
            {Object.entries(kindLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input className="input sm" style={{ width: 110 }} placeholder="קטגוריה" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} />
          <input className="input sm grow" placeholder="תיאור" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          <input className="input sm" style={{ width: 110 }} type="number" placeholder="₪" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
          <button className="btn sm primary" type="submit"><Plus size={15} /></button>
        </form>
        {lines.length === 0 ? <Empty title="אין תנועות" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>תאריך</th><th>סוג</th><th>תיאור</th><th className="end">סכום</th><th /></tr></thead>
              <tbody>
                {[...lines].sort((a, b) => b.at.localeCompare(a.at)).map((l) => (
                  <tr key={l.id}>
                    <td className="small nowrap">{date(l.at)}</td>
                    <td><Badge tone={l.kind === 'payment' ? 'success' : l.kind === 'expense' ? 'warning' : l.kind === 'commission' ? 'brand' : 'muted'}>{kindLabel[l.kind]}</Badge></td>
                    <td className="small">{l.category} · {l.description}</td>
                    <td className="end num small strong">{money(l.amount)}</td>
                    <td><button className="icon-btn" onClick={() => remove('money', l.id)} aria-label="מחיקה"><Trash2 size={15} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="מאזן התיק" pad>
        {quoteTotal ? (
          <>
            <div className="money-line"><span>הצעה מאושרת (לפני מע״מ)</span><b className="num">{money(quoteTotal.net)}</b></div>
            <div className="money-line"><span>כולל מע״מ</span><span className="num">{money(quoteTotal.total)}</span></div>
            <div className="money-line"><span>שולם עד כה</span><span className="num" style={{ color: 'var(--success)' }}>{money(paid)}</span></div>
            <div className="money-line total"><span>יתרה לגבייה</span><span className="num">{money(Math.max(0, quoteTotal.total - paid))}</span></div>
            <hr className="hr" />
            <div className="money-line"><span>תקציב</span><span className="num">{money(budget)}</span></div>
            <div className="money-line"><span>הוצאות בפועל</span><span className="num">{money(expenses)}</span></div>
            <div className="money-line"><span>עמלות</span><span className="num">{money(commission)}</span></div>
            <div className="money-line total"><span>רווח משוער</span><span className="num" style={{ color: quoteTotal.net - expenses - commission > 0 ? 'var(--success)' : 'var(--danger)' }}>{money(quoteTotal.net - (expenses || quoteTotal.cost) - commission)}</span></div>
            {!expenses && <div className="tiny muted">אין עדיין הוצאות בפועל: הרווח חושב לפי עלות הקטלוג</div>}
          </>
        ) : (
          <Empty title="אין הצעה מאושרת">המאזן יחושב אחרי אישור הלקוח</Empty>
        )}
      </Card>
    </div>
  )
}
