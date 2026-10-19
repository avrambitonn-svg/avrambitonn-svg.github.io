// הגדרות ← תהליכי עבודה: תבניות תיקים ושלבי פלואו. עורכים טיוטה ושומרים בבת אחת
import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2, Workflow, X } from 'lucide-react'
import { useApp } from '../../lib/store'
import { Callout, Card, Confirm, Empty, toast } from '../../components/ui'
import { pipeline, stageLabel } from '../../lib/labels'
import { uid } from '../../lib/format'
import type { CaseStage, CaseTemplate, FlowRole, FlowStage } from '../../lib/types'
import { flowRoleLabel, flowRoles } from './engine'
import './flow.css'

const move = <T,>(list: T[], i: number, d: -1 | 1): T[] => {
  const j = i + d
  if (j < 0 || j >= list.length) return list
  const out = [...list]
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}

function Mini({ onUp, onDown, onRemove, first, last }: { onUp: () => void; onDown: () => void; onRemove?: () => void; first: boolean; last: boolean }) {
  return (
    <span className="fs-mini">
      <button type="button" className="icon-btn" disabled={first} onClick={onUp} aria-label="למעלה"><ArrowUp size={15} /></button>
      <button type="button" className="icon-btn" disabled={last} onClick={onDown} aria-label="למטה"><ArrowDown size={15} /></button>
      {onRemove && <button type="button" className="icon-btn" onClick={onRemove} aria-label="הסרה"><X size={15} /></button>}
    </span>
  )
}

export function FlowSettings() {
  const cfg = useApp((s) => s.db.config)
  const setConfig = useApp((s) => s.setConfig)
  const [base, setBase] = useState({ t: cfg.caseTemplates, s: cfg.flowStages })
  const [tpls, setTpls] = useState<CaseTemplate[]>(cfg.caseTemplates)
  const [stages, setStages] = useState<FlowStage[]>(cfg.flowStages)
  const [del, setDel] = useState<{ kind: 'tpl' | 'stage'; id: string } | null>(null)
  const dirty = JSON.stringify(tpls) !== JSON.stringify(base.t) || JSON.stringify(stages) !== JSON.stringify(base.s)

  // שינוי מבחוץ (משתמש אחר) כשאין טיוטה פתוחה: מתעדכנים
  useEffect(() => {
    if (dirty) return
    setBase({ t: cfg.caseTemplates, s: cfg.flowStages })
    setTpls(cfg.caseTemplates)
    setStages(cfg.flowStages)
  }, [cfg.caseTemplates, cfg.flowStages])

  const types = useMemo(() => cfg.projectTypes.filter((o) => o.active), [cfg.projectTypes])
  const tags = useMemo(() => cfg.tags.filter((o) => o.active), [cfg.tags])
  const setTpl = (id: string, p: Partial<CaseTemplate>) => setTpls((l) => l.map((t) => (t.id === id ? { ...t, ...p } : t)))
  const setStage = (id: string, p: Partial<FlowStage>) => setStages((l) => l.map((s) => (s.id === id ? { ...s, ...p } : s)))
  const setTask = (sid: string, i: number, p: Partial<FlowStage['tasks'][number]>) => setStages((l) => l.map((s) => (s.id === sid ? { ...s, tasks: s.tasks.map((t, j) => (j === i ? { ...t, ...p } : t)) } : s)))

  const save = () => {
    if (tpls.some((t) => !t.name.trim()) || stages.some((s) => !s.name.trim())) return toast.error('לכל תבנית ושלב צריך שם')
    const cleanStages = stages.map((s) => ({ ...s, name: s.name.trim(), tasks: s.tasks.filter((t) => t.title.trim()).map((t) => ({ ...t, title: t.title.trim() })) }))
    const ids = new Set(cleanStages.map((s) => s.id))
    const cleanTpls = tpls.map((t) => ({ ...t, name: t.name.trim(), stageIds: t.stageIds.filter((id) => ids.has(id)) }))
    setConfig({ caseTemplates: cleanTpls, flowStages: cleanStages })
    setBase({ t: cleanTpls, s: cleanStages })
    setTpls(cleanTpls)
    setStages(cleanStages)
    toast.success('תהליכי העבודה נשמרו')
  }

  const usedIn = (sid: string) => tpls.filter((t) => t.stageIds.includes(sid))

  return (
    <div className="col" style={{ gap: 16 }}>
      <Callout icon={<Workflow size={18} />}>
        תבנית תיק היא רשימת שלבים לפי הסדר. כשנפתח תיק מסוג פרויקט שמתאים לתבנית, הפלואו מתחיל לבד ויוצר משימות לצוות התיק לפי תפקיד.
        שלב נסגר כשכל המשימות שלו בוצעו, או כשהתיק מגיע בצנרת לשלב שמקושר אליו.
      </Callout>

      <Card title="תבניות תיקים" actions={<button className="btn sm" onClick={() => setTpls((l) => [...l, { id: uid('ct-'), name: 'תבנית חדשה', projectTypes: [], stageIds: [], active: true }])}><Plus size={15} /> תבנית</button>}>
        <div className="card-body col" style={{ gap: 12 }}>
          {tpls.length === 0 && <Empty title="אין תבניות" />}
          {tpls.map((t) => {
            const avail = stages.filter((s) => !t.stageIds.includes(s.id))
            return (
              <div key={t.id} className={`fs-item ${t.active ? '' : 'off'}`}>
                <div className="fs-row">
                  <input className="input sm" value={t.name} onChange={(e) => setTpl(t.id, { name: e.target.value })} aria-label="שם התבנית" />
                  <label className="check small"><input type="checkbox" checked={t.active} onChange={(e) => setTpl(t.id, { active: e.target.checked })} /> פעילה</label>
                  <button type="button" className="icon-btn" onClick={() => setDel({ kind: 'tpl', id: t.id })} aria-label="מחיקת תבנית"><Trash2 size={16} /></button>
                </div>
                <div>
                  <div className="label mb8">סוגי פרויקטים <span className="tiny muted" style={{ fontWeight: 400 }}>(בלי סימון = כל הסוגים)</span></div>
                  <div className="row wrap" style={{ gap: 6 }}>
                    {types.map((o) => {
                      const on = t.projectTypes.includes(o.key)
                      return <button key={o.key} type="button" className={`chip ${on ? 'on' : ''}`} onClick={() => setTpl(t.id, { projectTypes: on ? t.projectTypes.filter((x) => x !== o.key) : [...t.projectTypes, o.key] })}>{o.label}</button>
                    })}
                  </div>
                </div>
                <div>
                  <div className="label mb8">שלבים לפי הסדר</div>
                  <div className="col" style={{ gap: 6 }}>
                    {t.stageIds.map((sid, i) => {
                      const s = stages.find((x) => x.id === sid)
                      if (!s) return null
                      return (
                        <div key={sid} className="fs-stage-line">
                          <span className="n" style={{ background: s.color ?? 'var(--brand)' }}>{i + 1}</span>
                          <span className="grow small strong truncate">{s.name}</span>
                          <span className="tiny muted hide-mobile">{s.tasks.length} משימות{s.caseStage ? ` · עד "${stageLabel[s.caseStage]}"` : ''}</span>
                          <Mini first={i === 0} last={i === t.stageIds.length - 1} onUp={() => setTpl(t.id, { stageIds: move(t.stageIds, i, -1) })} onDown={() => setTpl(t.id, { stageIds: move(t.stageIds, i, 1) })} onRemove={() => setTpl(t.id, { stageIds: t.stageIds.filter((x) => x !== sid) })} />
                        </div>
                      )
                    })}
                    {avail.length > 0 && (
                      <select className="select sm" style={{ width: 'auto', alignSelf: 'flex-start' }} value="" onChange={(e) => e.target.value && setTpl(t.id, { stageIds: [...t.stageIds, e.target.value] })} aria-label="הוספת שלב">
                        <option value="">+ הוספת שלב...</option>
                        {avail.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    )}
                  </div>
                </div>
                {tags.length > 0 && (
                  <div>
                    <div className="label mb8">תגיות שנוספות לתיק</div>
                    <div className="row wrap" style={{ gap: 6 }}>
                      {tags.map((o) => {
                        const on = (t.defaultTags ?? []).includes(o.key)
                        return <button key={o.key} type="button" className={`chip ${on ? 'on' : ''}`} onClick={() => setTpl(t.id, { defaultTags: on ? (t.defaultTags ?? []).filter((x) => x !== o.key) : [...(t.defaultTags ?? []), o.key] })}>{o.label}</button>
                      })}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </Card>

      <Card title="שלבי פלואו" actions={<button className="btn sm" onClick={() => setStages((l) => [...l, { id: uid('fs-'), name: 'שלב חדש', color: '#64748b', tasks: [] }])}><Plus size={15} /> שלב</button>}>
        <div className="card-body col" style={{ gap: 12 }}>
          {stages.map((s, i) => {
            const used = usedIn(s.id)
            return (
              <div key={s.id} className="fs-item">
                <div className="fs-row">
                  <input type="color" className="fs-color" value={s.color ?? '#64748b'} onChange={(e) => setStage(s.id, { color: e.target.value })} aria-label="צבע" />
                  <input className="input sm" value={s.name} onChange={(e) => setStage(s.id, { name: e.target.value })} aria-label="שם השלב" />
                  <Mini first={i === 0} last={i === stages.length - 1} onUp={() => setStages((l) => move(l, i, -1))} onDown={() => setStages((l) => move(l, i, 1))} />
                  <button type="button" className="icon-btn" onClick={() => setDel({ kind: 'stage', id: s.id })} aria-label="מחיקת שלב"><Trash2 size={16} /></button>
                </div>
                <div className="fs-row small">
                  <span className="muted">נסגר אוטומטית כשהתיק מגיע ל:</span>
                  <select className="select sm" style={{ width: 'auto' }} value={s.caseStage ?? ''} onChange={(e) => setStage(s.id, { caseStage: (e.target.value || undefined) as CaseStage | undefined })} aria-label="שלב בצנרת">
                    <option value="">— רק כשהמשימות בוצעו —</option>
                    {pipeline.map((p) => <option key={p} value={p}>{stageLabel[p]}</option>)}
                  </select>
                  <span className="tiny muted">{used.length ? `בשימוש ב: ${used.map((t) => t.name).join(', ')}` : 'לא בשימוש באף תבנית'}</span>
                </div>
                <div className="col" style={{ gap: 6 }}>
                  {s.tasks.map((t, j) => (
                    <div key={j} className="fs-task">
                      <input className="input" value={t.title} placeholder="מה צריך לעשות" onChange={(e) => setTask(s.id, j, { title: e.target.value })} aria-label="משימה" />
                      <select className="select" value={t.role} onChange={(e) => setTask(s.id, j, { role: e.target.value as FlowRole })} aria-label="למי">
                        {flowRoles.map((r) => <option key={r} value={r}>{flowRoleLabel[r]}</option>)}
                      </select>
                      <label className="row" style={{ gap: 4 }} title="ימי עבודה מתחילת השלב">
                        <input className="input num" type="number" min={0} max={60} value={t.dueDays ?? 0} onChange={(e) => setTask(s.id, j, { dueDays: Math.max(0, Number(e.target.value) || 0) })} aria-label="ימים לביצוע" />
                        <span className="tiny muted">ימים</span>
                      </label>
                      <Mini first={j === 0} last={j === s.tasks.length - 1} onUp={() => setStage(s.id, { tasks: move(s.tasks, j, -1) })} onDown={() => setStage(s.id, { tasks: move(s.tasks, j, 1) })} onRemove={() => setStage(s.id, { tasks: s.tasks.filter((_, x) => x !== j) })} />
                    </div>
                  ))}
                  <button type="button" className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setStage(s.id, { tasks: [...s.tasks, { title: '', role: 'agent', dueDays: 2 }] })}><Plus size={14} /> משימה</button>
                </div>
              </div>
            )
          })}
        </div>
      </Card>

      {dirty && (
        <div className="fs-save">
          <span className="small">יש שינויים שלא נשמרו</span>
          <div className="row">
            <button className="btn sm" onClick={() => { setTpls(base.t); setStages(base.s) }}>ביטול</button>
            <button className="btn sm primary" onClick={save}>שמירה</button>
          </div>
        </div>
      )}

      {del && (
        <Confirm
          title={del.kind === 'tpl' ? 'למחוק את התבנית?' : 'למחוק את השלב?'}
          text={del.kind === 'tpl'
            ? 'תיקים שכבר רצים לפי התבנית ימשיכו כמו שהם. תיקים חדשים לא יקבלו אותה.'
            : usedIn(del.id).length ? `השלב יוסר גם מ: ${usedIn(del.id).map((t) => t.name).join(', ')}.` : 'השלב לא בשימוש באף תבנית.'}
          confirmLabel="מחיקה"
          danger
          onClose={() => setDel(null)}
          onConfirm={() => {
            if (del.kind === 'tpl') setTpls((l) => l.filter((t) => t.id !== del.id))
            else {
              setStages((l) => l.filter((s) => s.id !== del.id))
              setTpls((l) => l.map((t) => ({ ...t, stageIds: t.stageIds.filter((x) => x !== del.id) })))
            }
          }}
        />
      )}
    </div>
  )
}
