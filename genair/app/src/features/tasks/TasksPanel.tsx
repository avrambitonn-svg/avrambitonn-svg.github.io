// משימות של תיק
import { useMemo } from 'react'
import { useApp } from '../../lib/store'
import { Avatar, Card } from '../../components/ui'
import type { ID } from '../../lib/types'

export function TasksPanel({ caseId, compact = false }: { caseId: ID; compact?: boolean }) {
  const all = useApp((s) => s.db.tasks)
  const users = useApp((s) => s.db.users)
  const patch = useApp((s) => s.patch)
  const tasks = useMemo(() => all.filter((t) => t.caseId === caseId), [all, caseId])
  if (compact && tasks.length === 0) return null
  return (
    <Card title="משימות בתיק">
      <div className="list">
        {tasks.map((t) => (
          <label key={t.id} className="list-item check">
            <input type="checkbox" checked={t.done} onChange={() => patch('tasks', t.id, { done: !t.done })} />
            <span className="grow small" style={{ textDecoration: t.done ? 'line-through' : undefined }}>{t.title}</span>
            <Avatar user={users.find((u) => u.id === t.assigneeId)} />
          </label>
        ))}
      </div>
    </Card>
  )
}
