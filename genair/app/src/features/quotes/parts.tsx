// רכיבים קטנים שמשותפים לעורך ההצעה ולחלון ה-AI
import { useEffect, useRef, useState } from 'react'
import { BadgeCheck, Bot, Calculator, CircleHelp, Lightbulb } from 'lucide-react'
import type { AiMeta, PriorityOrder, Quote, SyncState } from '../../lib/types'
import { Badge, Confirm, toast } from '../../components/ui'
import { syncLabel, syncTone } from '../../lib/labels'
import { dateTime, money } from '../../lib/format'
import { useMe } from '../../lib/store'
import { depositPending, markDepositPaid } from '../../lib/actions'
import { confidenceLabel, confidenceTone, depositMethodLabel } from './util'

/** מצב המקדמה: שולמה (אומתה), או ממתינה לאימות במשרד */
export function depositText(q: Pick<Quote, 'deposit'>): string {
  const d = q.deposit
  if (!d) return 'לא נרשמה מקדמה'
  const via = d.method ? ` (${depositMethodLabel[d.method]})` : ''
  return d.paidAt ? `מקדמה של ${money(d.amount)} התקבלה${via}` : `מקדמה של ${money(d.amount)} ממתינה לאימות${via}`
}

export function DepositBadge({ q }: { q: Pick<Quote, 'deposit'> }) {
  if (!q.deposit) return null
  return q.deposit.paidAt ? <Badge tone="success">מקדמה שולמה</Badge> : <Badge tone="warning">מקדמה ממתינה לאימות</Badge>
}

/** משרד והנהלה: אחרי שבדקו שהכסף התקבל בפועל, מסמנים כשולמה (נרשם תקבול "מקדמה" בכספי התיק) */
export function MarkDepositPaid({ q }: { q: Quote }) {
  const me = useMe()
  const [ask, setAsk] = useState(false)
  if (!depositPending(q) || !(me.role === 'admin' || me.role === 'office')) return null
  return (
    <>
      <button type="button" className="btn sm" onClick={() => setAsk(true)}><BadgeCheck size={15} /> סימון המקדמה כשולמה</button>
      {ask && (
        <Confirm
          title="סימון המקדמה כשולמה"
          text={`לסמן רק אחרי שבדקתם שהתשלום של ${money(q.deposit!.amount)} התקבל בפועל (בחברת הסליקה, ב-Bit או בבנק). התקבול יירשם בכספי התיק.`}
          confirmLabel="סימון כשולמה"
          onConfirm={() => { markDepositPaid(q.id); toast.success('המקדמה סומנה כשולמה') }}
          onClose={() => setAsk(false)}
        />
      )}
    </>
  )
}

// שדה מספר שלא "קופץ" בזמן הקלדה (1. / ריק)
export function NumInput({
  value, onChange, min = 0, className = '', disabled, label, suffix,
}: { value: number; onChange: (n: number) => void; min?: number; className?: string; disabled?: boolean; label: string; suffix?: string }) {
  const [text, setText] = useState(String(value))
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setText(String(value))
  }, [value])
  const input = (
    <input
      className={`input sm num ${className}`}
      inputMode="decimal"
      aria-label={label}
      title={label}
      value={text}
      disabled={disabled}
      onFocus={(e) => {
        focused.current = true
        e.target.select()
      }}
      onBlur={() => {
        focused.current = false
        setText(String(value))
      }}
      onChange={(e) => {
        const t = e.target.value.replace(/[^\d.,-]/g, '').replace(',', '.')
        setText(t)
        const n = parseFloat(t)
        if (Number.isFinite(n) && n >= min) onChange(Math.round(n * 100) / 100)
      }}
    />
  )
  if (!suffix) return input
  return (
    <span className="qx-suffix">
      {input}
      <i>{suffix}</i>
    </span>
  )
}

export function ConfidenceBadge({ value }: { value: AiMeta['confidence'] }) {
  return <Badge tone={confidenceTone[value]} dot>{confidenceLabel[value]}</Badge>
}

export function SourceBadge({ meta }: { meta: Pick<AiMeta, 'source' | 'model'> }) {
  return meta.source === 'claude' ? (
    <Badge tone="brand"><Bot size={13} /> Claude{meta.model ? ` · ${meta.model.replace(/^claude-/, '')}` : ''}</Badge>
  ) : (
    <Badge tone="muted"><Calculator size={13} /> מנוע חישוב מקומי</Badge>
  )
}

export function PrioritySyncBadge({ sync, order }: { sync: SyncState; order?: PriorityOrder }) {
  const tip = [sync.priorityId && `מספר ב-Priority: ${sync.priorityId}`, sync.lastSync && `עודכן ${dateTime(sync.lastSync)}`, sync.error].filter(Boolean).join(' · ')
  return (
    <span title={tip || undefined}>
      <Badge tone={syncTone[sync.status]} dot>
        {syncLabel[sync.status]} ב-Priority{sync.priorityId && <> · <span className="ltr">{sync.priorityId}</span></>}
      </Badge>
      {order?.status && <> <Badge tone={order.closed ? 'success' : 'brand'} >{order.status}{order.closed ? ' · סגורה' : ''}</Badge></>}
    </span>
  )
}

// סיכום, הנחות ושאלות פתוחות של טיוטת AI
export function AiInsights({ meta, compact }: { meta: AiMeta; compact?: boolean }) {
  return (
    <div className={`qx-ai ${compact ? 'compact' : ''}`}>
      <div className="row wrap" style={{ gap: 6 }}>
        <SourceBadge meta={meta} />
        <ConfidenceBadge value={meta.confidence} />
      </div>
      {meta.summary && <p className="qx-ai-summary">{meta.summary}</p>}
      {meta.assumptions.length > 0 && (
        <div>
          <div className="qx-ai-h"><Lightbulb size={15} /> הנחות</div>
          <ul className="qx-ai-list">
            {meta.assumptions.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </div>
      )}
      {meta.questions.length > 0 && (
        <div>
          <div className="qx-ai-h warn"><CircleHelp size={15} /> לבדוק לפני שליחה</div>
          <ul className="qx-ai-list q">
            {meta.questions.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}
