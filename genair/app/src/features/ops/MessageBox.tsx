import { useEffect, useState, type ReactNode } from 'react'
import { MessageCircle } from 'lucide-react'
import { Field, Modal, toast } from '../../components/ui'
import { sendMessage, templates, type TemplateKey } from '../../lib/messaging'
import type { ID } from '../../lib/types'
import { phone as fmtPhone } from '../../lib/format'

interface Props {
  to?: string
  text: string
  templateKey?: TemplateKey
  caseId?: ID
  serviceCallId?: ID
  customerId?: ID
  extra?: ReactNode
  onSent?: () => void
  compact?: boolean
}

// הודעה מוכנה ללקוח: אפשר לערוך לפני השליחה. במצב "קישור" נפתח וואטסאפ עם הטקסט.
export function MessageBox({ to: to0, text, templateKey = 'free', caseId, serviceCallId, customerId, extra, onSent, compact }: Props) {
  const [to, setTo] = useState(to0 ?? '')
  const [body, setBody] = useState(text)
  const [sent, setSent] = useState(false)
  useEffect(() => setBody(text), [text])
  useEffect(() => setTo(to0 ?? ''), [to0])

  const send = async () => {
    if (!to.replace(/\D/g, '')) return toast.error('חסר מספר טלפון')
    if (!body.trim()) return toast.error('ההודעה ריקה')
    const m = await sendMessage({ to, body, templateKey, caseId, serviceCallId, customerId })
    setSent(true)
    if (m.status === 'failed') toast.error('השליחה נכשלה, נסו שוב')
    else toast.success(m.status === 'sent' ? 'ההודעה נשלחה' : 'וואטסאפ נפתח עם ההודעה')
    onSent?.()
  }

  return (
    <div className="col">
      {extra}
      {!compact && (
        <Field label="לטלפון">
          <input className="input ltr" style={{ textAlign: 'right' }} inputMode="tel" value={to} onChange={(e) => setTo(e.target.value)} placeholder="05X-XXXXXXX" />
        </Field>
      )}
      <Field label={compact ? `הודעה ל-${fmtPhone(to)}` : 'ההודעה'}>
        <textarea className="textarea" rows={compact ? 3 : 4} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      <div className="row between wrap">
        <span className="tiny muted">{templateKey !== 'free' ? `תבנית: ${templates[templateKey].label}` : 'אפשר לערוך את הנוסח לפני השליחה'}</span>
        <button className="btn wa" onClick={send}>
          <MessageCircle size={16} /> {sent ? 'שליחה שוב' : 'שליחה בוואטסאפ'}
        </button>
      </div>
    </div>
  )
}

export function MessageModal({ title = 'הודעה ללקוח', onClose, ...p }: Props & { title?: string; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose} size="narrow">
      <MessageBox {...p} onSent={() => { p.onSent?.(); onClose() }} />
    </Modal>
  )
}
