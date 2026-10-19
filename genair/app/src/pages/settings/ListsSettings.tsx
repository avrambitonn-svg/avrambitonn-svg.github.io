// הגדרות ← רשימות: סוגי פרויקטים, סטטוסים, תגיות, קטגוריות, אמצעי תשלום, כללי עמלות, מספור תיקים וערכת צבע
import { useMemo, useState, type ReactNode } from 'react'
import {
  ArrowDown, ArrowUp, BadgePercent, Banknote, ChevronDown, CircleDot, FolderTree, Hash, ListChecks, MessageSquareText, Palette, Plane, Plus, RotateCcw, Shapes, Signal, Tag, Trash2, Truck, Wallet,
} from 'lucide-react'
import { useApp } from '../../lib/store'
import { applyTheme, defaultConfig, newKey, setConfig, themes, useThemeSync, type ListKey } from '../../lib/config'
import { formatCaseNumber, userInitials } from '../../lib/numbering'
import { ruleText } from '../../lib/commission'
import { Badge, Callout, Confirm, toast } from '../../components/ui'
import { ColorPick, CommitInput, Switch } from '../../features/case/controls'
import type { CommissionRule, Config, DB, ListOption } from '../../lib/types'
import '../../features/ops/ops.css'
import './lists.css'

type Usage = (db: DB, key: string, o: ListOption) => number

interface ListDef {
  id: ListKey
  title: string
  icon: ReactNode
  hint?: string
  fixed?: boolean // מפתחות קבועים: רק שם וצבע
  noColor?: boolean
  usage?: Usage
  usedIn?: string
}

const lists: ListDef[] = [
  { id: 'projectTypes', title: 'סוגי פרויקטים', icon: <Shapes size={17} />, hint: 'מופיעים בפתיחת תיק, בסינון ובדוחות. "שם אוטומטי" ממלא את שם התיק לפי הסוג, הלקוח והעיר.', usage: (db, k) => db.cases.filter((c) => c.projectType === k).length, usedIn: 'תיקים' },
  { id: 'caseStages', title: 'סטטוסי תיקים', icon: <CircleDot size={17} />, hint: 'שלבי הצנרת קבועים (המערכת נשענת עליהם), אבל אפשר לשנות להם שם וצבע.', fixed: true },
  { id: 'tags', title: 'תגיות', icon: <Tag size={17} />, hint: 'תגיות לתיקים. שינוי שם מתעדכן גם בתיקים הקיימים.', usage: (db, k, o) => db.cases.filter((c) => c.tags.includes(k) || c.tags.includes(o.label)).length, usedIn: 'תיקים' },
  { id: 'expenseCategories', title: 'קטגוריות הוצאה', icon: <Wallet size={17} />, usage: (db, k) => db.money.filter((m) => m.kind === 'expense' && m.category === k).length, usedIn: 'הוצאות' },
  { id: 'budgetItemTypes', title: 'סוגי סעיפי תקציב', icon: <Banknote size={17} />, hint: 'יצירת תקציב מהצעה מאושרת בונה סעיף אחד לכל סוג.', usage: (db, k) => db.money.filter((m) => m.budgetType === k).length, usedIn: 'סעיפים' },
  { id: 'paymentMethods', title: 'אמצעי תשלום', icon: <BadgePercent size={17} />, noColor: true, usage: (db, k) => db.money.filter((m) => m.method === k).length, usedIn: 'תנועות' },
  { id: 'contactMethods', title: 'אופני יצירת קשר', icon: <MessageSquareText size={17} />, noColor: true, usage: (db, k) => db.cases.filter((c) => c.contactMethod === k).length, usedIn: 'תיקים' },
  { id: 'driveFolders', title: 'תיקיות Drive', icon: <FolderTree size={17} />, hint: 'התיקיות שנפתחות בכל תיק (ובתיקיית התיק ב-Google Drive כשהשרת מחובר).', usage: (db, k) => db.docs.filter((d) => d.folder === k).length, usedIn: 'מסמכים' },
  { id: 'taskStatuses', title: 'סטטוסי משימות', icon: <ListChecks size={17} />, usage: (db, k) => db.tasks.filter((t) => (t.status ?? (t.done ? 'done' : 'new')) === k).length, usedIn: 'משימות' },
  { id: 'taskPriorities', title: 'עדיפויות משימות', icon: <Signal size={17} />, usage: (db, k) => db.tasks.filter((t) => t.priority === k).length, usedIn: 'משימות' },
  { id: 'leaveTypes', title: 'סוגי היעדרות', icon: <Plane size={17} />, usage: (db, k) => db.leaves.filter((l) => l.type === k).length, usedIn: 'בקשות' },
  { id: 'supplierCategories', title: 'קטגוריות ספקים', icon: <Truck size={17} />, usage: (db, k) => db.suppliers.filter((s) => s.category === k).length, usedIn: 'ספקים' },
]

const OPEN_KEY = 'genair-lists-open'
function readOpen(): Record<string, boolean> {
  let saved: Record<string, boolean> = { projectTypes: true }
  try {
    saved = (JSON.parse(localStorage.getItem(OPEN_KEY) ?? '') as Record<string, boolean>) ?? saved
  } catch {
    /* ברירת מחדל */
  }
  // קישור ישיר לאזור (#ls-caseNumbering) פותח אותו
  const target = window.location.hash.split('#')[2]
  return target?.startsWith('ls-') ? { ...saved, [target.slice(3)]: true } : saved
}

export function ListsSettings() {
  useThemeSync()
  const cfg = useApp((s) => s.db.config)
  const [open, setOpenState] = useState<Record<string, boolean>>(readOpen)
  const [reset, setReset] = useState<keyof Config | null>(null)
  const toggle = (id: string) => {
    const next = { ...open, [id]: !open[id] }
    setOpenState(next)
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(next))
    } catch {
      /* בלי זיכרון */
    }
  }
  const allOpen = [...lists.map((l) => l.id), 'commissionRules', 'caseNumbering', 'theme'].every((k) => open[k])
  const setAll = (v: boolean) => {
    const next = Object.fromEntries([...lists.map((l) => l.id), 'commissionRules', 'caseNumbering', 'theme'].map((k) => [k, v]))
    setOpenState(next)
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(next))
    } catch {
      /* בלי זיכרון */
    }
  }

  return (
    <div className="col lists" style={{ gap: 12 }}>
      <div className="row between wrap">
        <div className="small muted">כל שינוי נשמר מיד ומופיע בכל המערכת. פריט שהושבת לא יוצג בבחירה, אבל רשומות ישנות ימשיכו להציג אותו.</div>
        <button className="btn sm ghost" onClick={() => setAll(!allOpen)}>{allOpen ? 'לסגור הכל' : 'לפתוח הכל'}</button>
      </div>

      {lists.map((l) => {
        const items = cfg[l.id] as ListOption[]
        return (
          <Section key={l.id} id={l.id} title={l.title} icon={l.icon} count={items.length} active={items.filter((o) => o.active).length} open={!!open[l.id]} onToggle={() => toggle(l.id)} onReset={() => setReset(l.id)}>
            {l.hint && <div className="tiny muted ls-hint">{l.hint}</div>}
            <OptionEditor def={l} items={items} />
          </Section>
        )
      })}

      <Section id="commissionRules" title="כללי עמלות" icon={<BadgePercent size={17} />} count={cfg.commissionRules.length} active={cfg.commissionRules.filter((r) => r.active).length} open={!!open.commissionRules} onToggle={() => toggle('commissionRules')} onReset={() => setReset('commissionRules')}>
        <CommissionRules rules={cfg.commissionRules} />
      </Section>

      <Section id="caseNumbering" title="מספור תיקים" icon={<Hash size={17} />} badge={cfg.caseNumbering.mode === 'agent' ? 'לפי סוכן' : 'רץ'} open={!!open.caseNumbering} onToggle={() => toggle('caseNumbering')} onReset={() => setReset('caseNumbering')}>
        <Numbering n={cfg.caseNumbering} />
      </Section>

      <Section id="theme" title="ערכת צבע" icon={<Palette size={17} />} badge={themes.find((t) => t.key === cfg.theme)?.label} open={!!open.theme} onToggle={() => toggle('theme')} onReset={() => setReset('theme')}>
        <div className="theme-grid">
          {themes.map((t) => (
            <button key={t.key} className={`theme-card ${cfg.theme === t.key ? 'on' : ''}`} onClick={() => { setConfig({ theme: t.key }); applyTheme(t.key) }} aria-pressed={cfg.theme === t.key}>
              <span className="theme-sw"><span style={{ background: t.swatch[1] }} /><span style={{ background: t.swatch[0] }} /></span>
              <b>{t.label}</b>
              <span className="theme-demo" style={{ background: t.swatch[0] }}>כפתור</span>
            </button>
          ))}
        </div>
        <div className="tiny muted mt8">הצבע הראשי משתנה בכל המערכת (כפתורים, קישורים, תפריט). הלוגו ומסמכים ללקוח נשארים בצבעי המותג.</div>
      </Section>

      {reset && (
        <Confirm
          title="שחזור ברירת מחדל"
          text={reset === 'theme' || reset === 'caseNumbering' ? 'ההגדרה תחזור לברירת המחדל.' : 'הרשימה תחזור לערכים המקוריים. פריטים שהוספתם ושנמצאים בשימוש יישארו בסוף הרשימה; השאר יימחקו.'}
          confirmLabel="שחזור"
          onConfirm={() => { restore(reset); toast.success('שוחזרה ברירת המחדל') }}
          onClose={() => setReset(null)}
        />
      )}
    </div>
  )
}

function restore(key: keyof Config) {
  const s = useApp.getState()
  const def = defaultConfig()
  if (key === 'theme') {
    setConfig({ theme: def.theme })
    applyTheme(def.theme)
    return
  }
  if (key === 'caseNumbering' || key === 'commissionRules' || key === 'caseStages') {
    setConfig({ [key]: def[key] } as Partial<Config>)
    return
  }
  const def2 = lists.find((l) => l.id === key)
  const cur = s.db.config[key] as ListOption[]
  const base = def[key] as ListOption[]
  const keep = cur.filter((o) => !base.some((b) => b.key === o.key) && def2?.usage && def2.usage(s.db, o.key, o) > 0)
  setConfig({ [key]: [...base, ...keep] } as Partial<Config>)
}

function Section({ id, title, icon, count, active, badge, open, onToggle, onReset, children }: { id: string; title: string; icon: ReactNode; count?: number; active?: number; badge?: string; open: boolean; onToggle: () => void; onReset: () => void; children: ReactNode }) {
  return (
    <section className={`card ls-sec ${open ? 'open' : ''}`} id={`ls-${id}`}>
      <button className="ls-head" onClick={onToggle} aria-expanded={open}>
        <span className="ls-ico">{icon}</span>
        <span className="grow strong">{title}</span>
        {count !== undefined && <Badge tone="muted"><span className="ltr">{active !== undefined && active !== count ? `${active}/${count}` : count}</span></Badge>}
        {badge && <Badge tone="brand">{badge}</Badge>}
        <ChevronDown size={18} className="ls-chev" />
      </button>
      {open && (
        <div className="ls-body">
          {children}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn sm ghost" onClick={onReset}><RotateCcw size={14} /> שחזור ברירת מחדל</button>
          </div>
        </div>
      )}
    </section>
  )
}

type Opt = ListOption & { autoName?: boolean }

function OptionEditor({ def, items }: { def: ListDef; items: Opt[] }) {
  const db = useApp((s) => s.db)
  const patch = useApp((s) => s.patch)
  const [label, setLabel] = useState('')
  const [color, setColor] = useState('#00aeef')
  const usage = useMemo(() => Object.fromEntries(items.map((o) => [o.key, def.usage ? def.usage(db, o.key, o) : 0])), [db, items, def])
  const save = (next: Opt[]) => setConfig({ [def.id]: next } as Partial<Config>)
  const update = (key: string, p: Partial<Opt>) => {
    const old = items.find((o) => o.key === key)
    save(items.map((o) => (o.key === key ? { ...o, ...p } : o)))
    // תגיות נשמרות בתיק כטקסט: שינוי שם מעדכן גם את התיקים
    if (def.id === 'tags' && old && p.label && p.label !== old.label) {
      db.cases.filter((k) => k.tags.includes(old.label)).forEach((k) => patch('cases', k.id, { tags: k.tags.map((t) => (t === old.label ? p.label! : t)) }))
    }
  }
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= items.length) return
    const next = [...items]
    ;[next[i], next[j]] = [next[j], next[i]]
    save(next)
  }
  const add = () => {
    const t = label.trim()
    if (!t) return
    if (items.some((o) => o.label.trim() === t)) {
      toast.error('כבר יש פריט בשם הזה')
      return
    }
    const o: Opt = { key: newKey(def.id === 'projectTypes' ? 'pt' : 'opt'), label: t, color: def.noColor ? undefined : color, active: true }
    if (def.id === 'projectTypes') o.autoName = true
    save([...items, o])
    setLabel('')
  }

  return (
    <div className="ls-list">
      {items.map((o, i) => {
        const used = usage[o.key] ?? 0
        const delTitle = o.system ? 'ערך מערכת: אפשר לשנות שם ולהשבית, לא למחוק' : used ? `בשימוש ב-${used} ${def.usedIn ?? ''}. אפשר להשבית במקום למחוק` : 'מחיקה'
        return (
          <div key={o.key} className={`ls-row ${o.active ? '' : 'off'}`}>
            {!def.fixed && (
              <span className="ls-move">
                <button className="icon-btn sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label="למעלה"><ArrowUp size={15} /></button>
                <button className="icon-btn sm" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label="למטה"><ArrowDown size={15} /></button>
              </span>
            )}
            {!def.noColor && <ColorPick value={o.color} onChange={(c) => update(o.key, { color: c })} />}
            <CommitInput className="input sm ls-label" value={o.label} ariaLabel="שם" onCommit={(v) => v.trim() ? update(o.key, { label: v.trim() }) : toast.error('השם לא יכול להיות ריק')} />
            <span className="ls-meta">
              {def.id === 'projectTypes' && (
                <span className="seg ls-seg" role="group" aria-label="שם התיק">
                  <button className={o.autoName ? 'on' : ''} onClick={() => update(o.key, { autoName: true })}>שם אוטומטי</button>
                  <button className={!o.autoName ? 'on' : ''} onClick={() => update(o.key, { autoName: false })}>שם ידני</button>
                </span>
              )}
              {o.system && <span className="tiny muted ls-sys">מערכת</span>}
              {used > 0 && <span className="tiny muted ls-used">{used} {def.usedIn}</span>}
              {!def.fixed && <Switch checked={o.active} onChange={(v) => update(o.key, { active: v })} title={o.active ? 'פעיל' : 'מושבת'} />}
              {!def.fixed && (
                <button className="icon-btn sm" disabled={o.system || used > 0} title={delTitle} aria-label={delTitle} onClick={() => save(items.filter((x) => x.key !== o.key))}><Trash2 size={15} /></button>
              )}
            </span>
          </div>
        )
      })}
      {!def.fixed && (
        <form className="ls-row ls-add" onSubmit={(e) => { e.preventDefault(); add() }}>
          {!def.noColor && <ColorPick value={color} onChange={setColor} />}
          <input className="input sm ls-label" placeholder="פריט חדש..." value={label} onChange={(e) => setLabel(e.target.value)} aria-label="פריט חדש" />
          <button className="btn sm primary" type="submit" disabled={!label.trim()}><Plus size={15} /> הוספה</button>
        </form>
      )}
    </div>
  )
}

function CommissionRules({ rules }: { rules: CommissionRule[] }) {
  const users = useApp((s) => s.db.users)
  const types = useApp((s) => s.db.config.projectTypes)
  const agents = useMemo(() => users.filter((u) => u.role === 'agent' || u.role === 'admin'), [users])
  const save = (next: CommissionRule[]) => setConfig({ commissionRules: next })
  const update = (id: string, p: Partial<CommissionRule>) => save(rules.map((r) => (r.id === id ? { ...r, ...p } : r)))
  const describe = (r: CommissionRule) => [r.agentId ? users.find((u) => u.id === r.agentId)?.name : 'כל הסוכנים', r.projectType ? types.find((t) => t.key === r.projectType)?.label : 'כל הסוגים'].join(' · ')
  return (
    <div className="col" style={{ gap: 10 }}>
      <Callout>העמלה נרשמת בתיק כשהלקוח מאשר הצעה. כשכמה כללים מתאימים, הכלל המדויק ביותר קובע: <b>סוכן וסוג פרויקט</b>, אחר כך <b>סוכן</b>, אחר כך <b>סוג פרויקט</b>, ובסוף הכלל הכללי. תיק בלי סוכן לא מקבל עמלה.</Callout>
      <div className="ls-list">
        {rules.map((r) => (
          <div key={r.id} className={`cr-row ${r.active ? '' : 'off'}`}>
            <CommitInput className="input sm" value={r.name} ariaLabel="שם הכלל" onCommit={(v) => update(r.id, { name: v.trim() || r.name })} />
            <select className="select sm" value={r.agentId ?? ''} onChange={(e) => update(r.id, { agentId: e.target.value || undefined })} aria-label="סוכן">
              <option value="">כל הסוכנים</option>
              {agents.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <select className="select sm" value={r.projectType ?? ''} onChange={(e) => update(r.id, { projectType: e.target.value || undefined })} aria-label="סוג פרויקט">
              <option value="">כל סוגי הפרויקטים</option>
              {types.filter((t) => t.active || t.key === r.projectType).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
            <span className="cr-pct">
              <CommitInput className="input sm num" type="number" value={String(r.pct)} ariaLabel="אחוז" onCommit={(v) => update(r.id, { pct: Math.max(0, Math.min(100, Number(v) || 0)) })} />
              <span className="small muted">%</span>
            </span>
            <select className="select sm" value={r.base} onChange={(e) => update(r.id, { base: e.target.value as CommissionRule['base'] })} aria-label="בסיס החישוב">
              <option value="net">מהמחיר לפני מע״מ</option>
              <option value="profit">מהרווח הגולמי</option>
            </select>
            <span className="cr-end">
              <Switch checked={r.active} onChange={(v) => update(r.id, { active: v })} title={r.active ? 'פעיל' : 'מושבת'} />
              <button className="icon-btn sm" onClick={() => save(rules.filter((x) => x.id !== r.id))} aria-label="מחיקת כלל" title="מחיקה"><Trash2 size={15} /></button>
            </span>
            <span className="tiny muted cr-desc">{describe(r)} · {ruleText(r)}</span>
          </div>
        ))}
      </div>
      <div>
        <button className="btn sm" onClick={() => save([...rules, { id: newKey('cr'), name: 'כלל חדש', pct: 3, base: 'net', active: true }])}><Plus size={15} /> כלל עמלה</button>
      </div>
    </div>
  )
}

function Numbering({ n }: { n: Config['caseNumbering'] }) {
  const users = useApp((s) => s.db.users)
  const counters = useApp((s) => s.db.counters)
  const patch = useApp((s) => s.patch)
  const agents = useMemo(() => users.filter((u) => (u.role === 'agent' || u.role === 'admin') && u.active), [users])
  const set = (p: Partial<Config['caseNumbering']>) => setConfig({ caseNumbering: { ...n, ...p } })
  const dupInitials = (ini: string) => agents.filter((u) => userInitials(u) === ini).length > 1
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="seg" role="radiogroup" aria-label="שיטת מספור">
        <button role="radio" aria-checked={n.mode === 'global'} className={n.mode === 'global' ? 'on' : ''} onClick={() => set({ mode: 'global' })}>מספור רץ לכל החברה</button>
        <button role="radio" aria-checked={n.mode === 'agent'} className={n.mode === 'agent' ? 'on' : ''} onClick={() => set({ mode: 'agent' })}>לפי ראשי תיבות של הסוכן</button>
      </div>
      <div className="grid g3 num-grid">
        <label className="field"><span>קידומת (למספור הרץ)</span><CommitInput className="input sm ltr" value={n.prefix} onCommit={(v) => set({ prefix: v.replace(/\s/g, '') })} /></label>
        <label className="field"><span>מספר ספרות</span><CommitInput className="input sm num" type="number" value={String(n.pad)} onCommit={(v) => set({ pad: Math.max(2, Math.min(8, Number(v) || 4)) })} /></label>
        <div className="field"><span>התיק הבא{n.mode === 'agent' ? ' (בלי סוכן)' : ''}</span><div className="num-preview"><span className="ltr">{formatCaseNumber(n, users, counters)}</span></div></div>
      </div>
      {n.mode === 'agent' && (
        <div className="ls-list">
          <div className="tiny muted">לכל סוכן מונה משלו. ראשי התיבות נלקחים מהשם, ואפשר לשנות אותם כאן.</div>
          {agents.map((u) => {
            const ini = userInitials(u)
            return (
              <div key={u.id} className="ls-row">
                <span className="grow small strong">{u.name}</span>
                <CommitInput className="input sm ltr num-ini" value={u.initials ?? ''} placeholder={userInitials({ name: u.name })} ariaLabel="ראשי תיבות" onCommit={(v) => patch('users', u.id, { initials: v.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 4) || undefined })} />
                <span className="num-preview sm"><span className="ltr">{formatCaseNumber(n, users, counters, u.id)}</span></span>
                {dupInitials(ini) && <Badge tone="warning">ראשי תיבות כפולים</Badge>}
              </div>
            )
          })}
        </div>
      )}
      <div className="tiny muted">אפשר גם להקליד מספר ידני בפתיחת תיק. מספר שכבר תפוס לא יוקצה פעמיים.</div>
    </div>
  )
}
