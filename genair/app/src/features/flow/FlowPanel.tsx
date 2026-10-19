// שלבי הפלואו של התיק (תבנית ← שלבים ← משימות אוטומטיות)
import { useMemo, useState, type CSSProperties } from 'react'
import { Check, FastForward, Play, Replace, Workflow } from 'lucide-react'
import { useApp } from '../../lib/store'
import { Avatar, Callout, Card, Confirm, Field, Modal, Progress, toast } from '../../components/ui'
import { date, relative } from '../../lib/format'
import { stageLabel } from '../../lib/labels'
import type { ID } from '../../lib/types'
import { finishStage, flowView, restartFlow, skipStage, startFlow } from './engine'
import { toggleDone } from '../tasks/tasks'
import { dueText } from '../tasks/parts'
import './flow.css'

export function FlowPanel({ caseId }: { caseId: ID }) {
  const k = useApp((s) => s.db.cases.find((x) => x.id === caseId))
  const cfg = useApp((s) => s.db.config)
  const allTasks = useApp((s) => s.db.tasks)
  const users = useApp((s) => s.db.users)
  const [sel, setSel] = useState<number | null>(null)
  const [ask, setAsk] = useState<'finish' | 'skip' | null>(null)
  const [switching, setSwitching] = useState(false)
  const view = useMemo(() => (k ? flowView({ config: cfg, tasks: allTasks }, k) : null), [k, cfg, allTasks])
  if (!k || !view || !view.tpl || !view.stages.length) return null
  const { tpl, stages, flow, tasks } = view

  if (!flow) {
    if (k.stage === 'closed' || k.stage === 'lost') return null
    return (
      <Card>
        <div className="card-body row between wrap">
          <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
            <Workflow size={20} className="txt-brand" style={{ marginTop: 2, color: 'var(--brand-700)' }} />
            <div>
              <div className="strong">תהליך עבודה: {tpl.name}</div>
              <div className="small muted">{stages.map((s) => s.name).join(' ← ')}</div>
              <div className="tiny muted mt8">בהפעלה נוצרות משימות לצוות התיק לפי השלב שבו התיק נמצא.</div>
            </div>
          </div>
          <button className="btn primary sm" onClick={() => { startFlow(k.id, tpl.id); toast.success('הפלואו הופעל') }}><Play size={15} /> הפעלת פלואו</button>
        </div>
      </Card>
    )
  }

  const doneCount = flow.doneAt ? stages.length : flow.log.filter((e) => e.doneAt && stages.some((s) => s.id === e.stageId)).length
  const curIdx = flow.doneAt ? -1 : flow.stageIdx
  const shown = sel ?? (flow.doneAt ? stages.length - 1 : flow.stageIdx)
  const st = stages[shown]
  const entry = st && [...flow.log].reverse().find((e) => e.stageId === st.id)
  const stTasks = st ? tasks.filter((t) => t.flowStageId === st.id) : []
  const isCur = shown === curIdx
  const name = (id?: ID) => users.find((u) => u.id === id)

  return (
    <Card
      title={<div className="fl-head"><Workflow size={17} color="var(--brand-700)" /><h2>פלואו · {tpl.name}</h2></div>}
      actions={<button className="btn sm ghost" onClick={() => setSwitching(true)}><Replace size={15} /> החלפת תבנית</button>}
    >
      <div className="fl-prog">
        <Progress value={(doneCount / stages.length) * 100} />
        <span className="tiny muted nowrap">{doneCount}/{stages.length} שלבים</span>
      </div>
      <div className="fl-steps" role="list">
        {stages.map((s, i) => {
          const done = flow.doneAt ? true : i < flow.stageIdx || !!flow.log.find((e) => e.stageId === s.id && e.doneAt && i <= flow.stageIdx)
          return (
            <button
              key={s.id + i}
              role="listitem"
              className={`fl-step ${done ? 'done' : ''} ${i === curIdx ? 'cur' : ''} ${i === shown ? 'sel' : ''}`}
              style={{ '--fc': s.color } as CSSProperties}
              onClick={() => setSel(i === sel ? null : i)}
              title={s.caseStage ? `${s.name} · נסגר כשהתיק מגיע ל"${stageLabel[s.caseStage]}"` : s.name}
            >
              <span className="fl-dot">{done ? <Check size={15} strokeWidth={3} /> : i + 1}</span>
              <span className="fl-name">{s.name}</span>
            </button>
          )
        })}
      </div>

      {flow.doneAt && sel === null ? (
        <div className="card-body"><Callout tone="success">כל שלבי הפלואו הושלמו · {date(flow.doneAt)}</Callout></div>
      ) : st ? (
        <div className="fl-cur">
          <div className="fl-cur-head">
            <span className="t"><span className="dotc" style={{ background: st.color ?? 'var(--brand)', width: 10, height: 10 }} />{isCur ? 'שלב נוכחי: ' : ''}{st.name}</span>
            <span className="tiny muted">
              {entry?.doneAt ? `הושלם ${relative(entry.doneAt)}` : entry ? `התחיל ${relative(entry.startedAt)}` : 'עוד לא התחיל'}
              {isCur && st.caseStage ? ` · ייסגר לבד כשהתיק יגיע ל"${stageLabel[st.caseStage]}"` : ''}
            </span>
          </div>
          {stTasks.length === 0 ? (
            <div className="small muted" style={{ padding: '6px 18px 10px' }}>{entry ? 'אין משימות בשלב הזה' : `${st.tasks.length} משימות ייווצרו כשהשלב יתחיל`}</div>
          ) : (
            <div className="list">
              {stTasks.map((t) => {
                const u = name(t.assigneeId)
                return (
                  <label key={t.id} className={`fl-task ${t.done ? 'done' : ''}`}>
                    <input type="checkbox" checked={t.done} onChange={() => toggleDone(t)} />
                    <span className="grow">
                      <span className="small strong" style={{ display: 'block' }}>{t.title}</span>
                      <span className="tiny muted">{u?.name}{t.due && !t.done ? ` · ${dueText(t.due)}` : ''}</span>
                    </span>
                    <Avatar user={u} />
                  </label>
                )
              })}
            </div>
          )}
          {isCur && (
            <div className="fl-actions">
              <button className="btn sm primary" onClick={() => setAsk('finish')}><Check size={15} /> סיום שלב</button>
              <button className="btn sm" onClick={() => setAsk('skip')}><FastForward size={15} /> דילוג</button>
            </div>
          )}
        </div>
      ) : null}

      {ask && st && (
        <Confirm
          title={ask === 'finish' ? `לסיים את השלב "${st.name}"?` : `לדלג על השלב "${st.name}"?`}
          text={ask === 'finish'
            ? `${stTasks.filter((t) => !t.done).length ? 'המשימות הפתוחות בשלב יסומנו כבוצעו. ' : ''}${stages[shown + 1] ? `השלב הבא, "${stages[shown + 1].name}", יתחיל עם המשימות שלו.` : 'זה השלב האחרון בפלואו.'}`
            : `${stTasks.filter((t) => !t.done).length ? 'המשימות הפתוחות בשלב יוסרו. ' : ''}${stages[shown + 1] ? `ממשיכים ל"${stages[shown + 1].name}".` : 'זה השלב האחרון בפלואו.'}`}
          confirmLabel={ask === 'finish' ? 'סיום שלב' : 'דילוג'}
          onClose={() => setAsk(null)}
          onConfirm={() => { if (ask === 'finish') finishStage(k.id); else skipStage(k.id); setSel(null); toast.success(ask === 'finish' ? 'השלב הושלם' : 'השלב דולג') }}
        />
      )}
      {switching && <SwitchTemplate current={tpl.id} onClose={() => setSwitching(false)} onPick={(id) => { restartFlow(k.id, id); setSel(null); setSwitching(false); toast.success('הפלואו התחיל מחדש') }} />}
    </Card>
  )
}

function SwitchTemplate({ current, onClose, onPick }: { current: ID; onClose: () => void; onPick: (id: ID) => void }) {
  const tpls = useApp((s) => s.db.config.caseTemplates)
  const list = useMemo(() => tpls.filter((t) => t.active || t.id === current), [tpls, current])
  const [id, setId] = useState(current)
  return (
    <Modal title="החלפת תבנית" size="narrow" onClose={onClose} footer={<><button className="btn" onClick={onClose}>ביטול</button><button className="btn primary" onClick={() => onPick(id)}>התחלה מחדש</button></>}>
      <div className="col">
        <Field label="תבנית">
          <select className="select" value={id} onChange={(e) => setId(e.target.value)}>
            {list.map((t) => <option key={t.id} value={t.id}>{t.name}{t.id === current ? ' (נוכחית)' : ''}</option>)}
          </select>
        </Field>
        <Callout tone="warning">המשימות הפתוחות של הפלואו הנוכחי יוסרו, והפלואו יתחיל מחדש מהשלב שמתאים למצב התיק.</Callout>
      </div>
    </Modal>
  )
}
