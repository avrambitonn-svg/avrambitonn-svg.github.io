// כל המשימות: שלי, ששותפו איתי, שיצרתי וכל הצוות. קיבוץ לפי מועד או לפי תיק
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CheckCircle2, FolderOpen, Plus, Search } from 'lucide-react'
import { useApp, useMe } from '../../lib/store'
import { Card, Empty, PageHead, Tabs } from '../../components/ui'
import type { ID, Task } from '../../lib/types'
import { dueGroup, dueGroupLabel, dueGroups, sortTasks, statusOf } from '../../features/tasks/tasks'
import { QuickAdd, TaskDialog, TaskRow } from '../../features/tasks/parts'

type TabId = 'mine' | 'shared' | 'created' | 'team'
type GroupBy = 'date' | 'case'

export default function Page() {
  const me = useMe()
  const tasks = useApp((s) => s.db.tasks)
  const users = useApp((s) => s.db.users)
  const cases = useApp((s) => s.db.cases)
  const cfg = useApp((s) => s.db.config)
  const [params, setParams] = useSearchParams()
  const canTeam = me.role === 'admin' || me.role === 'office'
  const tab0 = params.get('tab') as TabId | null
  const [tab, setTab] = useState<TabId>(tab0 && (tab0 !== 'team' || canTeam) ? tab0 : 'mine')
  const [prio, setPrio] = useState('')
  const [status, setStatus] = useState('')
  const [who, setWho] = useState<ID | ''>('')
  const [q, setQ] = useState('')
  const [groupBy, setGroupBy] = useState<GroupBy>('date')
  const [showDone, setShowDone] = useState(false)
  const [open, setOpen] = useState<Task | 'new' | null>(null)

  // קישור ישיר למשימה (מהתראה): /tasks?task=<id>
  const linked = params.get('task')
  useEffect(() => {
    if (!linked) return
    const t = tasks.find((x) => x.id === linked)
    if (t) setOpen(t)
    params.delete('task')
    setParams(params, { replace: true })
  }, [linked])

  const inTab = useMemo(() => {
    const pick: Record<TabId, (t: Task) => boolean> = {
      mine: (t) => t.assigneeId === me.id,
      shared: (t) => !!t.sharedWith?.includes(me.id) && t.assigneeId !== me.id,
      created: (t) => t.createdBy === me.id,
      team: () => true,
    }
    return (Object.keys(pick) as TabId[]).reduce((m, k) => ({ ...m, [k]: tasks.filter(pick[k]) }), {} as Record<TabId, Task[]>)
  }, [tasks, me.id])

  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    const caseText = (id?: ID) => {
      const k = id ? cases.find((x) => x.id === id) : undefined
      return k ? `${k.number} ${k.title}`.toLowerCase() : ''
    }
    return inTab[tab]
      .filter((x) => showDone || !x.done)
      .filter((x) => !prio || x.priority === prio)
      .filter((x) => !status || statusOf(x) === status)
      .filter((x) => !who || x.assigneeId === who || x.sharedWith?.includes(who))
      .filter((x) => !t || x.title.toLowerCase().includes(t) || (x.notes ?? '').toLowerCase().includes(t) || caseText(x.caseId).includes(t))
      .sort(sortTasks(cfg))
  }, [inTab, tab, showDone, prio, status, who, q, cases, cfg])

  const groups = useMemo(() => {
    if (groupBy === 'date') {
      return dueGroups.map((g) => ({ key: g, title: dueGroupLabel[g], tone: g, items: list.filter((t) => dueGroup(t) === g), caseId: undefined as ID | undefined })).filter((g) => g.items.length)
    }
    const m = new Map<string, Task[]>()
    list.forEach((t) => m.set(t.caseId ?? '', [...(m.get(t.caseId ?? '') ?? []), t]))
    return [...m.entries()]
      .map(([cid, items]) => {
        const k = cases.find((x) => x.id === cid)
        return { key: cid || 'none', title: k ? `${k.number} · ${k.title}` : 'בלי תיק', tone: '', items, caseId: k?.id }
      })
      .sort((a, b) => Number(!a.caseId) - Number(!b.caseId) || (a.items[0].due ?? '9999').localeCompare(b.items[0].due ?? '9999'))
  }, [groupBy, list, cases])

  const openCount = (k: TabId) => inTab[k].filter((t) => !t.done).length
  const late = inTab.mine.filter((t) => dueGroup(t) === 'overdue').length + inTab.shared.filter((t) => dueGroup(t) === 'overdue').length
  const tabs: { id: TabId; label: string; count: number }[] = [
    { id: 'mine', label: 'שלי', count: openCount('mine') },
    { id: 'shared', label: 'ששותפו איתי', count: openCount('shared') },
    { id: 'created', label: 'שיצרתי', count: openCount('created') },
    ...(canTeam ? [{ id: 'team' as TabId, label: 'כל הצוות', count: openCount('team') }] : []),
  ]

  return (
    <div className="col" style={{ gap: 16 }}>
      <PageHead
        title="משימות"
        sub={`${openCount('mine')} פתוחות אצלי${late ? ` · ${late} באיחור` : ''}${openCount('shared') ? ` · ${openCount('shared')} ששותפו איתי` : ''}`}
        actions={<button className="btn primary" onClick={() => setOpen('new')}><Plus size={16} /> משימה חדשה</button>}
      />
      <Card>
        <QuickAdd placeholder="מה צריך לעשות? (Enter להוספה)" />
      </Card>
      <Tabs value={tab} onChange={(v) => { setTab(v); setParams(v === 'mine' ? {} : { tab: v }, { replace: true }) }} items={tabs} />
      <div className="filters">
        <div className="search-box" style={{ flex: '1 1 200px' }}>
          <Search size={15} className="muted" />
          <input className="input sm" placeholder="חיפוש במשימות ובתיקים" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="select sm" value={prio} onChange={(e) => setPrio(e.target.value)} aria-label="עדיפות">
          <option value="">כל העדיפויות</option>
          {cfg.taskPriorities.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        <select className="select sm" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="סטטוס">
          <option value="">כל הסטטוסים</option>
          {cfg.taskStatuses.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        <select className="select sm" value={who} onChange={(e) => setWho(e.target.value)} aria-label="עובד">
          <option value="">כל העובדים</option>
          {users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <div className="seg">
          <button className={groupBy === 'date' ? 'on' : ''} onClick={() => setGroupBy('date')}>לפי מועד</button>
          <button className={groupBy === 'case' ? 'on' : ''} onClick={() => setGroupBy('case')}>לפי תיק</button>
        </div>
        <label className="check small"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> גם שהושלמו</label>
      </div>

      <Card>
        {groups.length === 0 ? (
          <Empty icon={<CheckCircle2 size={34} />} title={tab === 'shared' ? 'אין משימות ששותפו איתך' : tab === 'created' ? 'עוד לא יצרת משימות' : 'אין משימות פתוחות'}>
            {(prio || status || who || q) && 'נסו לנקות את הסינון'}
          </Empty>
        ) : (
          <div className="list">
            {groups.map((g) => (
              <div key={g.key}>
                <div className={`tk-group ${g.tone === 'overdue' ? 'overdue' : ''}`}>
                  {g.caseId ? <><FolderOpen size={14} /><Link to={`/cases/${g.caseId}`}>{g.title}</Link></> : g.title}
                  <span className="n">{g.items.length}</span>
                </div>
                {g.items.map((t) => <TaskRow key={t.id} t={t} showCase={groupBy === 'date'} onOpen={setOpen} />)}
              </div>
            ))}
          </div>
        )}
      </Card>
      {open && <TaskDialog task={open === 'new' ? undefined : tasks.find((t) => t.id === open.id) ?? open} onClose={() => setOpen(null)} />}
    </div>
  )
}
