// שיחות בתיק: מול הלקוח (וואטסאפ / אזור אישי) ובתוך הצוות
import { useMemo, useState } from 'react'
import { MessageCircle, Users } from 'lucide-react'
import { useApp, useMe } from '../../lib/store'
import { Avatars, Card } from '../../components/ui'
import type { ID } from '../../lib/types'
import { caseThread, isCustUnread, isUnread, threadMembers } from './chat'
import { CustomerConversation, TeamConversation } from './parts'
import './chat.css'

type Sub = 'customer' | 'team'

export function CaseChat({ caseId, onCompose }: { caseId: ID; onCompose: () => void }) {
  const me = useMe()
  const messages = useApp((s) => s.db.messages)
  const chat = useApp((s) => s.db.chat)
  const cases = useApp((s) => s.db.cases)
  const users = useApp((s) => s.db.users)
  const threadId = caseThread(caseId)
  const custUnread = useMemo(() => messages.filter((m) => m.caseId === caseId && isCustUnread(m)).length, [messages, caseId])
  const teamUnread = useMemo(() => chat.filter((m) => m.threadId === threadId && isUnread(m, me.id)).length, [chat, threadId, me.id])
  const members = useMemo(() => threadMembers({ cases, chat }, threadId), [cases, chat, threadId])
  const [sub, setSub] = useState<Sub>(() => (teamUnread > 0 && custUnread === 0 ? 'team' : 'customer'))

  const tabs = (
    <div className="seg" role="tablist" aria-label="סוג שיחה">
      <button role="tab" aria-selected={sub === 'customer'} className={sub === 'customer' ? 'on' : ''} onClick={() => setSub('customer')}>
        לקוח {custUnread > 0 && <span className="cw-n" style={{ display: 'inline-grid', marginInlineStart: 4 }}>{custUnread}</span>}
      </button>
      <button role="tab" aria-selected={sub === 'team'} className={sub === 'team' ? 'on' : ''} onClick={() => setSub('team')}>
        פנימי {teamUnread > 0 && <span className="cw-n" style={{ display: 'inline-grid', marginInlineStart: 4 }}>{teamUnread}</span>}
      </button>
    </div>
  )

  return sub === 'customer' ? (
    <Card title={tabs} actions={<button className="btn sm wa" onClick={onCompose}><MessageCircle size={15} /> הודעה מתבנית</button>}>
      <div className="case-chat-box"><CustomerConversation caseId={caseId} /></div>
    </Card>
  ) : (
    <Card title={tabs} actions={<span className="row" style={{ gap: 6 }} title={members.map((id) => users.find((u) => u.id === id)?.name).join(', ')}><Users size={15} className="muted" /><Avatars users={members.slice(0, 6).map((id) => users.find((u) => u.id === id))} /></span>}>
      <div className="case-chat-box"><TeamConversation threadId={threadId} emptyText="כאן הצוות מדבר על התיק: ציוד, מועדים, שאלות. אפשר לאזכר עם @" /></div>
    </Card>
  )
}
