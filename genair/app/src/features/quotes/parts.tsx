// רכיבים קטנים שמשותפים לעורך ההצעה ולחלון ה-AI
import { useEffect, useRef, useState } from 'react'
import { Bot, Calculator, CircleHelp, Lightbulb } from 'lucide-react'
import type { AiMeta, SyncState } from '../../lib/types'
import { Badge } from '../../components/ui'
import { syncLabel, syncTone } from '../../lib/labels'
import { dateTime } from '../../lib/format'
import { confidenceLabel, confidenceTone } from './util'

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

export function PrioritySyncBadge({ sync }: { sync: SyncState }) {
  const tip = [sync.priorityId && `מספר ב-Priority: ${sync.priorityId}`, sync.lastSync && `עודכן ${dateTime(sync.lastSync)}`, sync.error].filter(Boolean).join(' · ')
  return (
    <span title={tip || undefined}>
      <Badge tone={syncTone[sync.status]} dot>
        Priority: {syncLabel[sync.status]}{sync.priorityId ? ` · ${sync.priorityId}` : ''}
      </Badge>
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
