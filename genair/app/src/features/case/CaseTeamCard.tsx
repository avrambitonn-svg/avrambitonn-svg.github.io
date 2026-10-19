// צוות התיק: סוכן, מהנדס, מנהל, מתקינים
import { useApp } from '../../lib/store'
import { Avatar, Card } from '../../components/ui'
import { roleLabel } from '../../lib/labels'
import type { ID } from '../../lib/types'

export function CaseTeamCard({ caseId }: { caseId: ID }) {
  const db = useApp((s) => s.db)
  const k = db.cases.find((x) => x.id === caseId)
  if (!k) return null
  const team = [k.agentId, k.engineerId, k.managerId, ...k.installerIds].filter(Boolean).map((u) => db.users.find((x) => x.id === u)).filter((u, i, arr) => u && arr.indexOf(u) === i)
  return (
    <Card title="צוות" pad>
      <div className="col" style={{ gap: 8 }}>
        {team.length === 0 && <div className="small muted">לא שובץ צוות</div>}
        {team.map((u) => u && (
          <div key={u.id} className="row">
            <Avatar user={u} />
            <div className="grow">
              <div className="small strong">{u.name}</div>
              <div className="tiny muted">{roleLabel[u.role]}</div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}
