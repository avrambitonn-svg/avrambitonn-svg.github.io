// משימות של תיק. בתצוגה המקוצרת (סקירה) רק הפתוחות שאינן בשלב הנוכחי של הפלואו (אלה מוצגות בפלואו)
import { useMemo, useState } from 'react'
import { useApp } from '../../lib/store'
import { Card, Empty } from '../../components/ui'
import type { ID, Task } from '../../lib/types'
import { sortTasks } from './tasks'
import { QuickAdd, TaskDialog, TaskRow } from './parts'
import { flowView } from '../flow/engine'

export function TasksPanel({ caseId, compact = false }: { caseId: ID; compact?: boolean }) {
  const all = useApp((s) => s.db.tasks)
  const cfg = useApp((s) => s.db.config)
  const k = useApp((s) => s.db.cases.find((x) => x.id === caseId))
  const [open, setOpen] = useState<Task | 'new' | null>(null)
  const [showDone, setShowDone] = useState(false)
  const tasks = useMemo(() => all.filter((t) => t.caseId === caseId).sort(sortTasks(cfg)), [all, caseId, cfg])
  const current = k ? flowView({ config: cfg, tasks: all }, k).current : undefined
  const openList = tasks.filter((t) => !t.done)
  const done = tasks.filter((t) => t.done)
  const dialog = open && <TaskDialog task={open === 'new' ? undefined : all.find((t) => t.id === open.id) ?? open} caseId={caseId} onClose={() => setOpen(null)} />

  if (compact) {
    const rest = openList.filter((t) => !current || t.flowStageId !== current.id)
    if (rest.length === 0) return null
    return (
      <Card title={`משימות פתוחות בתיק (${rest.length})`}>
        <div className="list">{rest.slice(0, 6).map((t) => <TaskRow key={t.id} t={t} showCase={false} onOpen={setOpen} />)}</div>
        {rest.length > 6 && <div className="tk-more muted">ועוד {rest.length - 6} בלשונית "משימות"</div>}
        {dialog}
      </Card>
    )
  }

  return (
    <Card
      title={`משימות בתיק${openList.length ? ` · ${openList.length} פתוחות` : ''}`}
      actions={<button className="btn sm" onClick={() => setOpen('new')}>משימה מפורטת</button>}
    >
      <QuickAdd caseId={caseId} placeholder="משימה חדשה בתיק..." />
      {tasks.length === 0 ? (
        <Empty title="אין משימות בתיק" />
      ) : (
        <div className="list">
          {openList.map((t) => <TaskRow key={t.id} t={t} showCase={false} onOpen={setOpen} />)}
          {done.length > 0 && (
            <button className="tk-group" style={{ border: 0, width: '100%', cursor: 'pointer', font: 'inherit' }} onClick={() => setShowDone((v) => !v)}>
              הושלמו <span className="n">{done.length}</span> <span className="muted" style={{ fontWeight: 400 }}>{showDone ? 'הסתרה' : 'הצגה'}</span>
            </button>
          )}
          {showDone && done.map((t) => <TaskRow key={t.id} t={t} showCase={false} onOpen={setOpen} />)}
        </div>
      )}
      {dialog}
    </Card>
  )
}
