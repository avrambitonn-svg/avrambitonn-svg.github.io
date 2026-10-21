// הקמה ראשונה של המסד המשותף (Supabase), כשהוא עוד ריק: הנתונים עולים אליו (מהדפדפן הזה, מקובץ גיבוי,
// או מערכת חדשה עם מנהל אחד), נוצר חשבון כניסה למנהל, ומתחברים איתו. דורש את קוד ההקמה (BOOTSTRAP_TOKEN).
import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, CloudUpload } from 'lucide-react'
import { get as idbGet } from 'idb-keyval'
import { DEVICE_SETTINGS, defaultSettings, emptyDB } from '../../lib/store'
import { defaultConfig } from '../../lib/configDefaults'
import { Callout, Field, toast } from '../../components/ui'
import { bootstrapServer, rpc, type SyncError } from '../../lib/sync'
import { docBlob, uploadToServer } from '../../lib/files'
import type { DB, Doc, Settings, User } from '../../lib/types'

type Source = 'browser' | 'file' | 'new'
interface Loaded {
  db: DB
  settings?: Partial<Settings>
}

const orgSettings = (s: Partial<Settings>) => Object.fromEntries(Object.entries({ ...defaultSettings, ...s }).filter(([k]) => !(DEVICE_SETTINGS as readonly string[]).includes(k)))

/** העותק של הגרסה המקומית (מצב הדגמה) שנשמר בדפדפן הזה, אם יש */
async function browserCopy(): Promise<Loaded | null> {
  try {
    const raw = await idbGet<string>('genair-ops-v1')
    if (!raw) return null
    const st = (JSON.parse(raw) as { state?: { db?: DB; settings?: Partial<Settings> } }).state
    return st?.db?.users?.length ? { db: st.db, settings: st.settings } : null
  } catch {
    return null
  }
}

/** קובץ גיבוי (הגדרות ← נתונים ← ייצוא גיבוי): המאגר עצמו, או עותק שמור של האפליקציה */
function parseBackup(text: string): Loaded {
  const j = JSON.parse(text) as Record<string, unknown>
  const st = (j.state ?? j) as { db?: DB; settings?: Partial<Settings> } & Partial<DB>
  const db = (st.db ?? st) as DB
  if (!Array.isArray(db.users) || !db.users.length) throw new Error('בקובץ אין משתמשים. צריך קובץ גיבוי של המערכת.')
  return { db, settings: st.settings }
}

function snapshotOf(src: Loaded) {
  const { config, counters, ...collections } = src.db
  return { collections, config: { ...defaultConfig(), ...(config ?? {}) }, settings: orgSettings(src.settings ?? {}), counters: counters ?? {} }
}

export function FirstSetup() {
  const [source, setSource] = useState<Source>('new')
  const [browser, setBrowser] = useState<Loaded | null>(null)
  const [file, setFile] = useState<Loaded | null>(null)
  const [fileErr, setFileErr] = useState('')
  const [adminId, setAdminId] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')

  useEffect(() => {
    void browserCopy().then((b) => {
      setBrowser(b)
      if (b) setSource('browser')
    })
  }, [])

  const loaded = source === 'browser' ? browser : source === 'file' ? file : null
  const admins = useMemo(() => (loaded?.db.users ?? []).filter((u) => u.role === 'admin' && u.active), [loaded])
  const admin = adminId && admins.some((u) => u.id === adminId) ? adminId : admins[0]?.id ?? ''

  async function pickFile(f?: File | null) {
    setFileErr('')
    setFile(null)
    if (!f) return
    try {
      setFile(parseBackup(await f.text()))
    } catch (e) {
      setFileErr(e instanceof SyntaxError ? 'הקובץ לא תקין (צריך קובץ JSON של גיבוי)' : (e as Error).message)
    }
  }

  async function submit() {
    setErr('')
    if (!code.trim()) return setErr('צריך את קוד ההקמה (BOOTSTRAP_TOKEN מהגדרות פונקציית ה-Edge ב-Supabase)')
    if (pw.length < 8) return setErr('הסיסמה צריכה לפחות 8 תווים')
    if (pw !== pw2) return setErr('הסיסמאות לא זהות')
    let src: Loaded
    let adminUserId: string
    if (source === 'new') {
      const digits = phone.replace(/\D/g, '').replace(/^972/, '0')
      if (!name.trim()) return setErr('צריך שם למנהל המערכת')
      if (digits.length < 9 && !email.includes('@')) return setErr('צריך טלפון נייד (או אימייל) למנהל: איתו נכנסים')
      const user: User = { id: 'u-admin', name: name.trim(), role: 'admin', title: 'מנהל/ת', phone: digits, email: email.trim() || undefined, color: '#0f766e', active: true }
      src = { db: { ...emptyDB(), users: [user] } }
      adminUserId = user.id
    } else {
      if (!loaded) return setErr(source === 'file' ? 'בוחרים קובץ גיבוי' : 'אין נתונים בדפדפן הזה')
      if (!admin) return setErr('צריך לפחות משתמש פעיל אחד בתפקיד ניהול')
      src = loaded
      adminUserId = admin
    }
    setBusy('מעלה את הנתונים...')
    try {
      await bootstrapServer({ snapshot: snapshotOf(src), adminUserId, password: pw, bootstrapToken: code.trim() })
    } catch (e) {
      const e2 = e as SyncError
      setBusy('')
      if (e2.code === 'invalid_bootstrap_token') return setErr('קוד ההקמה שגוי. מזינים בדיוק את הערך של BOOTSTRAP_TOKEN (אחרי כמה ניסיונות שגויים יש חסימה לזמן מה).')
      return setErr(e2.message)
    }
    toast.success('המסד המשותף הוקם. נכנסתם כמנהל המערכת.')
    // קבצים ששמורים בדפדפן הזה עולים גם הם (ברקע; המסך כבר עובר למערכת)
    if (source === 'browser') void uploadLocalFiles(src.db.docs ?? [])
  }

  return (
    <div className="auth-card" style={{ width: 'min(520px, 100%)' }}>
      <div className="row"><CloudUpload size={20} color="var(--brand-700)" /><h1>הקמה ראשונה</h1></div>
      <div className="sub">המסד המשותף עוד ריק. בוחרים מאיפה הנתונים, מי מנהל המערכת, וקובעים לו סיסמה. אחר כך כל עובד מקבל סיסמה מעמוד המשתמשים.</div>
      <div className="col mt16" style={{ gap: 12 }}>
        <div className="col" style={{ gap: 6 }}>
          {browser && (
            <label className="check"><input type="radio" checked={source === 'browser'} onChange={() => setSource('browser')} /> <span><b>הנתונים שבדפדפן הזה</b><div className="tiny muted">{browser.db.users.length} משתמשים · {browser.db.customers?.length ?? 0} לקוחות · {browser.db.cases?.length ?? 0} תיקים, כולל קבצים</div></span></label>
          )}
          <label className="check"><input type="radio" checked={source === 'file'} onChange={() => setSource('file')} /> <span><b>קובץ גיבוי</b><div className="tiny muted">ייצוא גיבוי מהגדרות ← נתונים</div></span></label>
          <label className="check"><input type="radio" checked={source === 'new'} onChange={() => setSource('new')} /> <span><b>מערכת חדשה</b><div className="tiny muted">מתחילים ריק, עם מנהל אחד</div></span></label>
        </div>
        {source === 'file' && (
          <Field label="קובץ הגיבוי">
            <input className="input" type="file" accept="application/json,.json" onChange={(e) => void pickFile(e.target.files?.[0])} />
          </Field>
        )}
        {source === 'file' && fileErr && <Callout tone="danger">{fileErr}</Callout>}
        {source === 'file' && file && <div className="tiny muted">{file.db.users.length} משתמשים · {file.db.customers?.length ?? 0} לקוחות · {file.db.cases?.length ?? 0} תיקים</div>}
        {source === 'new' ? (
          <div className="grid g2">
            <Field label="שם מנהל המערכת"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="טלפון נייד" hint="איתו נכנסים"><input className="input ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="050-0000000" /></Field>
            <Field label="אימייל" hint="רק אם אין טלפון"><input className="input ltr" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          </div>
        ) : (
          loaded && (
            <Field label="מנהל המערכת" hint="נכנס עם הטלפון הנייד שלו (או האימייל, אם אין טלפון)">
              <select className="select" value={admin} onChange={(e) => setAdminId(e.target.value)}>
                {admins.map((u) => <option key={u.id} value={u.id}>{u.name}{u.phone ? ` · ${u.phone}` : ''}</option>)}
              </select>
            </Field>
          )
        )}
        <div className="grid g2">
          <Field label="סיסמה למנהל" hint="לפחות 8 תווים"><input className="input ltr" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
          <Field label="שוב, לאימות"><input className="input ltr" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
        </div>
        <Field label="קוד הקמה" hint="BOOTSTRAP_TOKEN מהסודות של פונקציית ה-Edge ב-Supabase"><input className="input ltr" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} /></Field>
        {err && <Callout tone="warning">{err}</Callout>}
        <button className="btn primary lg block" disabled={!!busy} onClick={() => void submit()}><CheckCircle2 size={17} /> {busy || 'העלאת הנתונים והפעלה'}</button>
      </div>
    </div>
  )
}

/** אחרי ההקמה: קבצים שנשמרו רק בדפדפן הזה עולים לאחסון, והמסמך מצביע עליהם */
async function uploadLocalFiles(docs: Doc[]) {
  const local = docs.filter((d) => d.blobKey && !d.fileId)
  let ok = 0
  for (const d of local) {
    try {
      const blob = await docBlob(d)
      if (!blob) continue
      const r = await uploadToServer(new File([blob], d.name, { type: d.mime }), { caseId: d.caseId, folder: d.folder })
      await rpc('db_ops', { ops: [{ op: 'patch', collection: 'docs', id: d.id, data: { fileId: r.fileId }, unset: ['blobKey'], at: Date.now() }], client_id: null })
      ok++
    } catch {
      /* קובץ שלא עלה נשאר בדפדפן הזה */
    }
  }
  if (local.length) toast.success(`${ok} מתוך ${local.length} קבצים עלו למסד המשותף`)
}
