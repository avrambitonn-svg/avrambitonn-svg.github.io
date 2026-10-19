// "המשימות שלי" בדשבורד
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useApp, useMe } from '../../lib/store'
import { Badge, Card, Empty } from '../../components/ui'
import { nowIso, uid, ymd } from '../../lib/format'

export function TasksCard() {
  const me = useMe()
  const tasks = useApp((s) => s.db.tasks)
  const cases = useApp((s) => s.db.cases)
  const upsert = useApp((s) => s.upsert)
  const patch = useApp((s) => s.patch)
  const [newTask, setNewTask] = useState('')
  const myTasks = useMemo(() => tasks.filter((t) => t.assigneeId === me.id).sort((a, b) => Number(a.done) - Number(b.done) || (a.due ?? '').localeCompare(b.due ?? '')), [tasks, me.id])
  return (
    <Card title="המשימות שלי">
      <form
        className="row"
        style={{ padding: '12px 18px', borderBottom: '1px solid var(--line-2)' }}
        onSubmit={(e) => {
          e.preventDefault()
          if (!newTask.trim()) return
          upsert('tasks', { id: uid('t'), title: newTask.trim(), assigneeId: me.id, createdBy: me.id, done: false, priority: 'normal', due: ymd(), createdAt: nowIso() })
          setNewTask('')
        }}
      >
        <input className="input sm" placeholder="משימה חדשה..." value={newTask} onChange={(e) => setNewTask(e.target.value)} />
        <button className="btn sm primary" type="submit"><Plus size={15} /></button>
      </form>
      {myTasks.length === 0 ? (
        <Empty title="אין משימות" />
      ) : (
        <div className="list">
          {myTasks.slice(0, 7).map((t) => {
            const k = cases.find((x) => x.id === t.caseId)
            return (
              <div key={t.id} className="list-item" style={{ opacity: t.done ? 0.55 : 1 }}>
                <label className="check">
                  <input type="checkbox" checked={t.done} onChange={() => patch('tasks', t.id, { done: !t.done })} />
                </label>
                <div className="grow">
                  <div className="small" style={{ textDecoration: t.done ? 'line-through' : undefined, fontWeight: t.priority === 'high' ? 700 : 500 }}>{t.title}</div>
                  {k && <Link className="tiny" to={`/cases/${k.id}`}>{k.number}</Link>}
                </div>
                {t.priority === 'high' && !t.done && <Badge tone="danger">דחוף</Badge>}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
