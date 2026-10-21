// עובדים, תפקידים, הרשאות וגישה למערכת: הוספה ועריכה, פונקציות (מנהל מחלקה / פרויקט), יומן אישי,
// הסמכות עם תוקף, סיסמאות (במסד המשותף) וטבלת ההרשאות לפי תפקיד
import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, CircleOff, Copy, KeyRound, Pencil, Plus, Search, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react'
import { useApp, useMe } from '../../lib/store'
import { Avatar, Badge, Callout, Card, Field, Modal, PageHead, Tabs, toast } from '../../components/ui'
import { roleLabel, type Tone } from '../../lib/labels'
import { date, daysBetween, phone as fmtPhone, relative, uid } from '../../lib/format'
import { bridge, listCredentials, loginLabel, setUserPassword } from '../../lib/sync'
import type { CredentialInfo } from '../../lib/sync/session'
import type { Certification, Role, User, UserFunction } from '../../lib/types'
import './users.css'
import { brand } from '../../brand'

const roles = Object.keys(roleLabel) as Role[]
const functionLabel: Record<UserFunction, string> = { department_manager: 'מנהל מחלקה', project_manager: 'מנהל פרויקט' }
const certTypes: Certification['type'][] = ['עבודה בגובה', 'חשמל', 'גזי קירור', 'מנוף']
const palette = ['#0f766e', '#0ea5e9', '#00aeef', '#6366f1', '#8b5cf6', '#16a34a', '#f59e0b', '#f97316', '#ef4444', '#db2777', '#64748b', '#1c2127']
const roleTone: Record<Role, Tone> = { admin: 'brand', office: 'info', agent: 'success', engineer: 'warning', installer: 'info' }

const digits = (p?: string) => (p ?? '').replace(/\D/g, '').replace(/^972/, '0')

export default function UsersPage() {
  const me = useMe()
  const [tab, setTab] = useState<'team' | 'perms'>('team')
  const [edit, setEdit] = useState<User | 'new' | null>(null)
  const [pwFor, setPwFor] = useState<User | null>(null)
  const server = bridge.mode === 'server'
  const canEdit = me.role === 'admin' || me.role === 'office'
  const [creds, setCreds] = useState<Record<string, CredentialInfo>>({})

  const loadCreds = () => {
    if (!server || !canEdit) return
    listCredentials()
      .then((r) => setCreds(Object.fromEntries(r.users.map((u) => [u.id, u]))))
      .catch(() => {})
  }
  useEffect(loadCreds, [server, canEdit])

  return (
    <div>
      <PageHead
        title="משתמשים"
        sub="עובדים, תפקידים, הרשאות וגישה למערכת"
        actions={canEdit && <button className="btn primary" onClick={() => setEdit('new')}><UserPlus size={16} /> משתמש חדש</button>}
      />
      <Tabs value={tab} onChange={setTab} items={[{ id: 'team', label: 'צוות', icon: <Users size={15} /> }, { id: 'perms', label: 'הרשאות לפי תפקיד', icon: <ShieldCheck size={15} /> }]} />
      <div className="mt16">
        {tab === 'team' ? <Team canEdit={canEdit} creds={server ? creds : null} onEdit={setEdit} onPassword={setPwFor} /> : <Permissions />}
      </div>
      {edit && <UserDialog user={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
      {pwFor && <PasswordDialog user={pwFor} hasPassword={!!creds[pwFor.id]?.hasPassword} onClose={() => { setPwFor(null); loadCreds() }} />}
    </div>
  )
}

function CertBadges({ list }: { list?: Certification[] }) {
  if (!list?.length) return <span className="tiny muted">—</span>
  return (
    <>
      {list.map((c) => {
        const left = daysBetween(new Date(), c.expires)
        return <Badge key={c.type + c.expires} tone={left < 0 ? 'danger' : left <= 30 ? 'warning' : 'success'}>{c.type} · {left < 0 ? 'פג תוקף' : date(c.expires)}</Badge>
      })}
    </>
  )
}

function Access({ c }: { c?: CredentialInfo }) {
  if (!c) return <span className="tiny muted">—</span>
  if (!c.hasPassword) return <Badge tone="warning">אין סיסמה</Badge>
  return (
    <span className="col" style={{ gap: 2 }}>
      <Badge tone={c.mustChange ? 'warning' : 'success'} dot>{c.mustChange ? 'סיסמה זמנית' : 'יש גישה'}</Badge>
      {c.login && <span className="tiny muted">כניסה עם <span className="ltr">{loginLabel(c.login)}</span></span>}
      {c.lastLoginAt && <span className="tiny muted">נכנס/ה {relative(c.lastLoginAt)}</span>}
    </span>
  )
}

function Team({ canEdit, creds, onEdit, onPassword }: { canEdit: boolean; creds: Record<string, CredentialInfo> | null; onEdit: (u: User) => void; onPassword: (u: User) => void }) {
  const me = useMe()
  const users = useApp((s) => s.db.users)
  const [q, setQ] = useState('')
  const [role, setRole] = useState<Role | ''>('')
  const [inactive, setInactive] = useState(false)
  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    const d = digits(q)
    return users
      .filter((u) => (inactive || u.active) && (!role || u.role === role))
      .filter((u) => !t || u.name.toLowerCase().includes(t) || u.title.toLowerCase().includes(t) || (u.email ?? '').toLowerCase().includes(t) || (d.length >= 3 && digits(u.phone).includes(d)))
      .sort((a, b) => Number(b.active) - Number(a.active) || roles.indexOf(a.role) - roles.indexOf(b.role) || a.name.localeCompare(b.name, 'he'))
  }, [users, q, role, inactive])
  const editable = (u: User) => canEdit && (me.role === 'admin' || u.role !== 'admin')
  const passwordable = me.role === 'admin' && creds !== null

  const actions = (u: User) => (
    <div className="row" style={{ gap: 2, justifyContent: 'flex-end' }}>
      {passwordable && <button className="icon-btn" title="סיסמה" aria-label={`סיסמה ל${u.name}`} onClick={() => onPassword(u)}><KeyRound size={16} /></button>}
      {editable(u) && <button className="icon-btn" title="עריכה" aria-label={`עריכת ${u.name}`} onClick={() => onEdit(u)}><Pencil size={16} /></button>}
    </div>
  )

  return (
    <Card>
      <div className="us-toolbar">
        <div className="search"><Search size={16} /><input placeholder="שם, תפקיד, טלפון..." value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="row wrap" style={{ gap: 6 }}>
          <button className={`chip ${role === '' ? 'on' : ''}`} onClick={() => setRole('')}>הכל</button>
          {roles.map((r) => <button key={r} className={`chip ${role === r ? 'on' : ''}`} onClick={() => setRole(role === r ? '' : r)}>{roleLabel[r]}</button>)}
        </div>
        <label className="check small"><input type="checkbox" checked={inactive} onChange={(e) => setInactive(e.target.checked)} /> גם לא פעילים</label>
      </div>

      <div className="table-wrap hide-mobile">
        <table className="table">
          <thead>
            <tr><th>שם</th><th>תפקיד</th><th>טלפון ואימייל</th><th>הסמכות</th>{creds && <th>גישה</th>}<th /></tr>
          </thead>
          <tbody>
            {list.map((u) => (
              <tr key={u.id} className={u.active ? '' : 'us-off'}>
                <td>
                  <div className="us-name">
                    <Avatar user={u} />
                    <div className="t">
                      <div className="small strong">{u.name}{u.id === me.id && <span className="tiny muted"> (אני)</span>}</div>
                      <div className="tiny muted">{u.title}{u.region ? ` · ${u.region}` : ''}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <div className="row wrap" style={{ gap: 4 }}>
                    <Badge tone={roleTone[u.role]}>{roleLabel[u.role]}</Badge>
                    {(u.functions ?? []).map((f) => <Badge key={f} tone="muted">{functionLabel[f]}</Badge>)}
                    {!u.active && <Badge tone="muted">לא פעיל</Badge>}
                  </div>
                </td>
                <td className="small">
                  <div><span className="ltr">{fmtPhone(u.phone)}</span></div>
                  {u.email && <div className="tiny muted"><span className="ltr">{u.email}</span></div>}
                </td>
                <td><div className="row wrap" style={{ gap: 4 }}><CertBadges list={u.certifications} /></div></td>
                {creds && <td><Access c={creds[u.id]} /></td>}
                <td>{actions(u)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="us-cards show-mobile">
        {list.map((u) => (
          <div key={u.id} className="us-card" style={u.active ? undefined : { opacity: 0.6 }}>
            <Avatar user={u} />
            <div className="grow">
              <div className="strong small">{u.name}</div>
              <div className="tiny muted">{u.title} · <span className="ltr">{fmtPhone(u.phone)}</span></div>
              <div className="meta">
                <Badge tone={roleTone[u.role]}>{roleLabel[u.role]}</Badge>
                {(u.functions ?? []).map((f) => <Badge key={f} tone="muted">{functionLabel[f]}</Badge>)}
                <CertBadges list={u.certifications} />
                {creds && <Access c={creds[u.id]} />}
              </div>
            </div>
            {actions(u)}
          </div>
        ))}
      </div>
      {list.length === 0 && <div className="empty small">לא נמצאו משתמשים</div>}
    </Card>
  )
}

type Draft = Omit<User, 'id'> & { id?: string }
const blank = (n: number): Draft => ({ name: '', role: 'installer', title: '', phone: '', email: '', region: '', color: palette[n % palette.length], active: true, functions: [], certifications: [] })

function UserDialog({ user, onClose }: { user?: User; onClose: () => void }) {
  const me = useMe()
  const users = useApp((s) => s.db.users)
  const upsert = useApp((s) => s.upsert)
  const [d, setD] = useState<Draft>(() => (user ? { ...user, functions: user.functions ?? [], certifications: user.certifications ?? [] } : blank(users.length)))
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }))
  const self = user?.id === me.id
  const assignable = me.role === 'admin' ? roles : roles.filter((r) => r !== 'admin')

  function save() {
    const name = d.name.trim()
    const phone = digits(d.phone)
    const email = (d.email ?? '').trim().toLowerCase()
    if (name.length < 2) return toast.error('צריך שם')
    if (!/^0\d{8,9}$/.test(phone)) return toast.error('צריך טלפון תקין (משמש גם לכניסה)')
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast.error('האימייל לא תקין')
    if (users.some((u) => u.id !== user?.id && digits(u.phone) === phone)) return toast.error('יש כבר משתמש עם הטלפון הזה')
    if (email && users.some((u) => u.id !== user?.id && (u.email ?? '').toLowerCase() === email)) return toast.error('יש כבר משתמש עם האימייל הזה')
    if (self && (!d.active || (user?.role === 'admin' && d.role !== 'admin'))) return toast.error('אי אפשר להוריד לעצמך הרשאות ניהול או להשבית את עצמך')
    if (user?.role === 'admin' && (d.role !== 'admin' || !d.active) && !users.some((u) => u.id !== user.id && u.role === 'admin' && u.active)) return toast.error('צריך להשאיר לפחות מנהל מערכת פעיל אחד')
    const certifications = (d.certifications ?? []).filter((c) => c.expires)
    const next: User = {
      ...(user ?? {}),
      ...d,
      id: user?.id ?? uid('u'),
      name,
      phone,
      title: d.title.trim(),
      email: email || undefined,
      region: d.region?.trim() || undefined,
      googleCalendarId: d.googleCalendarId?.trim() || undefined,
      functions: d.functions?.length ? d.functions : undefined,
      certifications: certifications.length ? certifications : undefined,
    }
    upsert('users', next)
    toast.success(user ? 'נשמר' : bridge.mode === 'server' ? 'המשתמש נוסף. עכשיו קובעים לו סיסמה.' : 'המשתמש נוסף')
    onClose()
  }

  const certs = d.certifications ?? []
  return (
    <Modal
      title={user ? `עריכת ${user.name}` : 'משתמש חדש'}
      size="wide"
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>ביטול</button><button className="btn primary" onClick={save}>שמירה</button></>}
    >
      <div className="col" style={{ gap: 16 }}>
        <div className="grid g2">
          <Field label="שם מלא"><input className="input" value={d.name} onChange={(e) => set({ name: e.target.value })} autoFocus={!user} /></Field>
          <Field label="תואר" hint="מה שרואים ליד השם, למשל: ראש צוות התקנות"><input className="input" value={d.title} onChange={(e) => set({ title: e.target.value })} /></Field>
          <Field label="תפקיד במערכת" hint="קובע מה רואים ומה מותר לשנות">
            <select className="select" value={d.role} disabled={self && user?.role === 'admin'} onChange={(e) => set({ role: e.target.value as Role })}>
              {assignable.map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}
            </select>
          </Field>
          <Field label="אזור"><input className="input" value={d.region ?? ''} onChange={(e) => set({ region: e.target.value })} placeholder="ירושלים, בית שמש..." /></Field>
          <Field label="טלפון" hint="משמש גם לכניסה למערכת"><input className="input ltr" inputMode="tel" value={d.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="050-0000000" /></Field>
          <Field label="אימייל"><input className="input ltr" inputMode="email" value={d.email ?? ''} onChange={(e) => set({ email: e.target.value })} placeholder={`name@${brand.domain}`} /></Field>
        </div>

        <div className="grid g2">
          <div className="field">
            <span className="label">פונקציות נוספות</span>
            <div className="row wrap">
              {(Object.keys(functionLabel) as UserFunction[]).map((f) => {
                const on = d.functions?.includes(f)
                return (
                  <label key={f} className="check">
                    <input type="checkbox" checked={!!on} onChange={() => set({ functions: on ? d.functions!.filter((x) => x !== f) : [...(d.functions ?? []), f] })} />
                    {functionLabel[f]}
                  </label>
                )
              })}
            </div>
            <span className="hint">מנהלי מחלקה מקבלים את משימות התיק, ומנהל פרויקט אחראי על הביצוע.</span>
          </div>
          <div className="field">
            <span className="label">צבע ביומן</span>
            <div className="us-colors">
              {palette.map((c) => <button key={c} type="button" className={d.color === c ? 'on' : ''} style={{ background: c }} onClick={() => set({ color: c })} aria-label={`צבע ${c}`} aria-pressed={d.color === c} />)}
            </div>
          </div>
        </div>

        <Field label="יומן Google אישי" hint="מזהה היומן (בדרך כלל האימייל). צריך לשתף אותו עם חשבון השירות של השרת, ואז כל שיבוץ נכנס ליומן שלו.">
          <input className="input ltr" value={d.googleCalendarId ?? ''} onChange={(e) => set({ googleCalendarId: e.target.value })} placeholder={`name@${brand.domain}`} />
        </Field>

        <div className="field">
          <span className="label">הסמכות ותוקף</span>
          <div className="col" style={{ gap: 8 }}>
            {certs.map((c, i) => (
              <div key={i} className="us-cert">
                <select className="select" value={c.type} onChange={(e) => set({ certifications: certs.map((x, j) => (j === i ? { ...x, type: e.target.value as Certification['type'] } : x)) })}>
                  {certTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <input className="input" type="date" value={c.expires} onChange={(e) => set({ certifications: certs.map((x, j) => (j === i ? { ...x, expires: e.target.value } : x)) })} aria-label="תוקף" />
                <button type="button" className="icon-btn" onClick={() => set({ certifications: certs.filter((_, j) => j !== i) })} aria-label="הסרת הסמכה"><Trash2 size={15} /></button>
              </div>
            ))}
            <button type="button" className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => set({ certifications: [...certs, { type: certTypes.find((t) => !certs.some((c) => c.type === t)) ?? 'עבודה בגובה', expires: '' }] })}>
              <Plus size={15} /> הוספת הסמכה
            </button>
          </div>
        </div>

        <label className="check">
          <input type="checkbox" checked={d.active} disabled={self} onChange={(e) => set({ active: e.target.checked })} />
          <span>פעיל{bridge.mode === 'server' ? ' (משתמש לא פעיל לא יכול להיכנס, וכל החיבורים שלו נסגרים)' : ''}</span>
        </label>
      </div>
    </Modal>
  )
}

function LoginHint({ login, closed }: { login: string; closed: boolean }) {
  return (
    <div className="small">
      כניסה עם <b className="ltr">{login}</b>
      <span className="muted"> {login.includes('@') ? '(אימייל, כי אין למשתמש טלפון נייד במערכת)' : '(הטלפון הנייד)'}{closed ? '. החיבורים הקודמים של המשתמש נסגרו.' : '.'}</span>
    </div>
  )
}

function PasswordDialog({ user, hasPassword, onClose }: { user: User; hasPassword: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<'temp' | 'manual'>('temp')
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [temp, setTemp] = useState('')
  const [login, setLogin] = useState('')
  const [done, setDone] = useState(false)

  async function submit() {
    if (mode === 'manual' && pw.length < 8) return toast.error('לפחות 8 תווים')
    setBusy(true)
    try {
      const r = await setUserPassword(user.id, mode === 'manual' ? pw : undefined)
      if (r.temporaryPassword) setTemp(r.temporaryPassword)
      if (r.login) setLogin(loginLabel(r.login))
      setDone(true)
      toast.success('הסיסמה נקבעה')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`${hasPassword ? 'איפוס סיסמה' : 'סיסמה ראשונה'} · ${user.name}`}
      size="narrow"
      onClose={onClose}
      footer={done ? <button className="btn primary" onClick={onClose}>סיום</button> : <><button className="btn" onClick={onClose}>ביטול</button><button className="btn primary" disabled={busy} onClick={() => void submit()}>{busy ? 'שומר...' : 'קביעת סיסמה'}</button></>}
    >
      {done ? (
        <div className="col" style={{ gap: 12 }}>
          {temp ? (
            <>
              <p className="small">זו הסיסמה הזמנית. היא מוצגת פעם אחת בלבד. בכניסה הראשונה {user.name.split(' ')[0]} יתבקש לבחור סיסמה משלו.</p>
              <div className="us-temp">
                <b className="ltr">{temp}</b>
                <button className="btn sm" onClick={() => { void navigator.clipboard.writeText(temp); toast.success('הועתק') }}><Copy size={15} /> העתקה</button>
              </div>
            </>
          ) : (
            <Callout tone="success">הסיסמה נשמרה.</Callout>
          )}
          <LoginHint login={login || (digits(user.phone).length >= 9 ? digits(user.phone) : (user.email ?? '').toLowerCase())} closed={hasPassword} />
        </div>
      ) : (
        <div className="col" style={{ gap: 12 }}>
          <label className="check"><input type="radio" checked={mode === 'temp'} onChange={() => setMode('temp')} /> <span><b>סיסמה זמנית</b><div className="tiny muted">המערכת יוצרת סיסמה, והמשתמש מחליף אותה בכניסה הראשונה</div></span></label>
          <label className="check"><input type="radio" checked={mode === 'manual'} onChange={() => setMode('manual')} /> <span><b>סיסמה שאני בוחר/ת</b></span></label>
          {mode === 'manual' && <Field label="סיסמה" hint="לפחות 8 תווים"><input className="input ltr" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>}
          {hasPassword && <div className="tiny muted">לאחר האיפוס המשתמש יוצא מכל המכשירים.</div>}
        </div>
      )}
    </Modal>
  )
}

// מה כל תפקיד רואה ועושה. השורות המסומנות נאכפות גם בשרת (במסד המשותף), לא רק במסך.
const permissions: { action: string; roles: Role[]; server?: boolean }[] = [
  { action: 'צפייה בכל הנתונים', roles: ['admin', 'office', 'agent', 'engineer', 'installer'] },
  { action: 'פתיחת לקוח ותיק', roles: ['admin', 'office', 'agent', 'engineer'], server: true },
  { action: 'בניית הצעת מחיר', roles: ['admin', 'office', 'agent', 'engineer'], server: true },
  { action: 'צפייה בעלויות ורווח', roles: ['admin', 'office'] },
  { action: 'אישור תכנון טכני', roles: ['admin', 'engineer'] },
  { action: 'שיבוץ צוותים', roles: ['admin', 'office'] },
  { action: 'עדכון ביצוע, תמונות וחתימה', roles: ['admin', 'office', 'agent', 'engineer', 'installer'], server: true },
  { action: 'מלאי, קריאות שירות ומשימות', roles: ['admin', 'office', 'agent', 'engineer', 'installer'], server: true },
  { action: 'אישור חופשות', roles: ['admin', 'office'], server: true },
  { action: 'דוחות', roles: ['admin', 'office'] },
  { action: 'משתמשים, רשימות והגדרות', roles: ['admin', 'office'], server: true },
  { action: 'קביעת סיסמאות ומנהלי מערכת', roles: ['admin'], server: true },
]

function Permissions() {
  return (
    <Card title={<div className="row"><ShieldCheck size={17} /><h2>הרשאות לפי תפקיד</h2></div>}>
      <div className="table-wrap">
        <table className="table us-matrix">
          <thead><tr><th>פעולה</th>{roles.map((r) => <th key={r}>{roleLabel[r]}</th>)}</tr></thead>
          <tbody>
            {permissions.map((p) => (
              <tr key={p.action}>
                <td className="small">{p.action}{p.server && bridge.mode === 'server' ? <span className="tiny muted"> · נאכף בשרת</span> : null}</td>
                {roles.map((r) => <td key={r}>{p.roles.includes(r) ? <CheckCircle2 size={17} color="var(--success)" aria-label="מותר" /> : <CircleOff size={16} color="#cbd2d9" aria-label="לא מותר" />}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card-body tiny muted">
        מתקין רואה במסך רק את העבודות שלו, וסוכן את התיקים שלו. {bridge.mode === 'server' ? 'במסד המשותף השרת בודק כל שינוי לפי התפקיד: מתקין יכול לעדכן רק עבודות שטח, ושינוי של משתמשים והגדרות שמור למשרד ולניהול.' : 'במסד המשותף ההרשאות נאכפות גם בשרת, לא רק במסך.'}
      </div>
    </Card>
  )
}
