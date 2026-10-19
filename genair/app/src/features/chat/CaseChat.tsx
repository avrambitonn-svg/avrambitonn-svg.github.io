// שיחות בתיק: מול הלקוח (וואטסאפ / פורטל) ובתוך הצוות
import { useMemo } from 'react'
import { MessageCircle } from 'lucide-react'
import { useApp } from '../../lib/store'
import { Card, Empty } from '../../components/ui'
import { date, dateTime } from '../../lib/format'
import type { ID } from '../../lib/types'

export function CaseChat({ caseId, onCompose }: { caseId: ID; onCompose: () => void }) {
  const db = useApp((s) => s.db)
  const k = db.cases.find((x) => x.id === caseId)
  const msgs = useMemo(() => db.messages.filter((m) => m.caseId === caseId).sort((a, b) => a.at.localeCompare(b.at)), [db.messages, caseId])
  return (
    <Card title="הודעות עם הלקוח" actions={<button className="btn sm wa" onClick={onCompose}><MessageCircle size={15} /> הודעה חדשה</button>}>
      {msgs.length === 0 ? (
        <Empty title="אין הודעות עדיין" />
      ) : (
        <div className="card-body col" style={{ gap: 10, background: '#efeae2', borderRadius: '0 0 14px 14px' }}>
          {msgs.map((m) => (
            <div key={m.id} style={{ alignSelf: m.direction === 'out' ? 'flex-start' : 'flex-end', maxWidth: '78%', background: m.direction === 'out' ? '#d9fdd3' : '#fff', borderRadius: 10, padding: '8px 12px', boxShadow: '0 1px 1px rgba(0,0,0,.06)' }}>
              <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{m.body.replace('{portal}', '🔗 קישור לאזור האישי').replace('{date}', date(k?.installWindow?.from ?? m.at))}</div>
              <div className="tiny muted" style={{ textAlign: 'end' }}>{dateTime(m.at)}{m.direction === 'out' && m.by ? ` · ${db.users.find((u) => u.id === m.by)?.name ?? ''}` : ''}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
