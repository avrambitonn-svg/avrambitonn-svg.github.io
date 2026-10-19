import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Flag, Navigation, Play } from 'lucide-react'
import { Badge } from '../../components/ui'
import { app, useApp } from '../../lib/store'
import { setStage } from '../../lib/actions'
import type { Appointment, AppointmentStatus } from '../../lib/types'
import { fill, templates } from '../../lib/messaging'
import { firstName, jobContext, joinHe, messageVars } from './ops'
import { MessageModal } from './MessageBox'

const logText: Partial<Record<AppointmentStatus, string>> = {
  on_the_way: 'הצוות יצא לדרך',
  in_progress: 'הצוות הגיע לאתר והתחיל לעבוד',
}

export function setJobStatus(ap: Appointment, status: AppointmentStatus) {
  const s = app()
  s.patch('appointments', ap.id, { status })
  const t = logText[status]
  if (t) s.log({ kind: ap.serviceCallId ? 'service' : 'appointment', caseId: ap.caseId, serviceCallId: ap.serviceCallId, customerId: ap.customerId, text: `${t}: ${ap.title}` })
  if (status === 'in_progress') {
    const k = ap.caseId ? s.db.cases.find((x) => x.id === ap.caseId) : undefined
    if (k && ap.type === 'installation' && ['approved', 'scheduled'].includes(k.stage)) setStage(k.id, 'installing')
    const call = ap.serviceCallId ? s.db.serviceCalls.find((x) => x.id === ap.serviceCallId) : undefined
    if (call && !['done', 'cancelled', 'in_progress'].includes(call.status)) s.patch('serviceCalls', call.id, { status: 'in_progress' })
  }
}

// כפתור הפעולה הבאה: יצאתי לדרך ← התחלתי לעבוד ← סיום ומסירה
export function StatusFlow({ ap, big, onFinish }: { ap: Appointment; big?: boolean; onFinish?: () => void }) {
  const [eta, setEta] = useState(false)
  const cls = big ? 'btn lg block' : 'btn'
  if (ap.status === 'done') return <Badge tone="success"><CheckCircle2 size={14} /> בוצע</Badge>
  if (ap.status === 'cancelled') return <Badge tone="danger">בוטל</Badge>
  return (
    <>
      {(ap.status === 'planned' || ap.status === 'confirmed') && (
        <button className={`${cls} primary`} onClick={() => { setJobStatus(ap, 'on_the_way'); setEta(true) }}>
          <Navigation size={17} /> יצאתי לדרך
        </button>
      )}
      {ap.status === 'on_the_way' && (
        <button className={`${cls} primary`} onClick={() => setJobStatus(ap, 'in_progress')}>
          <Play size={17} /> התחלתי לעבוד
        </button>
      )}
      {ap.status === 'in_progress' &&
        (onFinish ? (
          <button className={`${cls} success`} onClick={onFinish}><Flag size={17} /> לסיום ומסירה</button>
        ) : (
          <Link className={`${cls} success`} to={`/field/${ap.id}`} state={{ finish: true }}><Flag size={17} /> לסיום ומסירה</Link>
        ))}
      {eta && <OnTheWayModal ap={ap} onClose={() => setEta(false)} />}
    </>
  )
}

export function OnTheWayModal({ ap, onClose }: { ap: Appointment; onClose: () => void }) {
  const db = useApp((s) => s.db)
  const ctx = jobContext(db, ap)
  const [eta, setEta] = useState(20)
  const text = fill(templates.on_the_way.text, { ...messageVars(ctx, ap), team: joinHe(ctx.team.map((u) => firstName(u.name))), eta })
  if (!ctx.phone) return null
  return (
    <MessageModal
      title="לעדכן את הלקוח שאתם בדרך?"
      to={ctx.phone}
      text={text}
      templateKey="on_the_way"
      caseId={ap.caseId}
      serviceCallId={ap.serviceCallId}
      customerId={ctx.customer?.id}
      onClose={onClose}
      extra={
        <div>
          <div className="label mb8">זמן הגעה משוער</div>
          <div className="row wrap" style={{ gap: 6 }}>
            {[10, 15, 20, 30, 45, 60].map((m) => (
              <button key={m} type="button" className={`chip ${eta === m ? 'on' : ''}`} onClick={() => setEta(m)}>{m} דק׳</button>
            ))}
          </div>
        </div>
      }
    />
  )
}
