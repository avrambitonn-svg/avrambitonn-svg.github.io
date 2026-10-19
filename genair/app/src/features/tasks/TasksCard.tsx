// "המשימות שלי" בדשבורד: הוספה מהירה והמשימות הפתוחות (שלי ושל שותפו איתי)
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { useApp, useMe } from '../../lib/store'
import { Card, Empty } from '../../components/ui'
import type { Task } from '../../lib/types'
import { dueGroup, isMine, sortTasks } from './tasks'
import { QuickAdd, TaskDialog, TaskRow } from './parts'

const SHOW = 7

export function TasksCard() {
  const me = useMe()
  const tasks = useApp((s) => s.db.tasks)
  const cfg = useApp((s) => s.db.config)
  const [open, setOpen] = useState<Task | null>(null)
  const mine = useMemo(() => tasks.filter((t) => !t.done && isMine(t, me.id)).sort(sortTasks(cfg)), [tasks, me.id, cfg])
  const late = mine.filter((t) => dueGroup(t) === 'overdue').length
  return (
    <Card
      title={<h2>המשימות שלי{late > 0 && <span className="badge danger" style={{ marginInlineStart: 8 }}>{late} באיחור</span>}</h2>}
      actions={<Link className="btn sm ghost" to="/tasks">לכל המשימות</Link>}
    >
      <QuickAdd />
      {mine.length === 0 ? (
        <Empty icon={<CheckCircle2 size={34} />} title="אין משימות פתוחות" />
      ) : (
        <div className="list">
          {mine.slice(0, SHOW).map((t) => <TaskRow key={t.id} t={t} onOpen={setOpen} />)}
        </div>
      )}
      <div className="row between" style={{ padding: '8px 18px', borderTop: '1px solid var(--line-2)' }}>
        <Link className="small" to="/tasks?tab=created">צפייה במשימות שיצרתי</Link>
        {mine.length > SHOW && <Link className="small strong" to="/tasks">ועוד {mine.length - SHOW}</Link>}
      </div>
      {open && <TaskDialog task={tasks.find((t) => t.id === open.id) ?? open} onClose={() => setOpen(null)} />}
    </Card>
  )
}
