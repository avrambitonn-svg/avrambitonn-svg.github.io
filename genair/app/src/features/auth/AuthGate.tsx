// מסך התחברות כשהמערכת עובדת מול שרת עם מסד נתונים משותף. במצב הדגמה מציג את האפליקציה כמו שהיא.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, LogIn, RefreshCw, WifiOff } from 'lucide-react'
import { brand } from '../../brand'
import { useApp } from '../../lib/store'
import { Wordmark } from '../../components/Layout'
import { Callout, Field } from '../../components/ui'
import { bridge, changePassword, login, readSyncConfig, signOut, startPlatform, switchMode, syncNow, useSession, useSync } from '../../lib/sync'
import './auth.css'

export function AuthGate({ children }: { children: ReactNode }) {
  const token = useSession((s) => s.token)
  const mustChange = useSession((s) => s.mustChange)
  const ready = useSync((s) => s.ready)
  const hasMe = useApp((s) => s.db.users.some((u) => u.id === s.currentUserId))

  // יומן גוגל בשני המצבים; במצב משותף גם הסנכרון (כשיש חיבור שמור)
  useEffect(() => {
    if (bridge.mode !== 'server' || token) startPlatform()
  }, [token])

  if (bridge.mode !== 'server') return <>{children}</>
  if (!token) return <LoginScreen />
  if (mustChange) return <NewPassword />
  if (!ready) return <Loading />
  if (!hasMe) return <NoUser />
  return <>{children}</>
}

// המשתמש נמחק או הושבת בזמן שהיה מחובר
function NoUser() {
  return (
    <Shell foot={<ServerFoot />}>
      <div className="auth-card" style={{ textAlign: 'center' }}>
        <h1>המשתמש לא פעיל</h1>
        <div className="sub">פנו למנהל המערכת כדי לקבל גישה מחדש.</div>
        <button className="btn primary mt16" onClick={() => void signOut()}>יציאה</button>
      </div>
    </Shell>
  )
}

function Shell({ children, foot }: { children: ReactNode; foot?: ReactNode }) {
  return (
    <div className="auth-page" dir="rtl">
      <div className="auth-brand">
        <Wordmark />
        <div className="slogan">{brand.slogan}</div>
      </div>
      {children}
      {foot && <div className="auth-foot">{foot}</div>}
    </div>
  )
}

function ServerFoot() {
  const url = readSyncConfig().serverUrl
  return (
    <>
      <div>שרת: <span className="ltr">{url || 'לא הוגדר'}</span></div>
      <button type="button" onClick={() => switchMode('local')}>מעבר לגרסת ההדגמה</button>
    </>
  )
}

function LoginScreen() {
  const nav = useNavigate()
  const [id, setId] = useState('')
  const [pw, setPw] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const notice = useSession((s) => s.notice)
  const serverUrl = readSyncConfig().serverUrl

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!id.trim() || !pw) return setErr('צריך טלפון או אימייל וסיסמה')
    setBusy(true)
    setErr('')
    try {
      tempPassword = pw // לפני הכניסה: מסך הסיסמה החדשה עולה מיד כשהשרת מבקש
      const r = await login(serverUrl, id.trim(), pw)
      if (!r.mustChange) tempPassword = ''
      useApp.setState({ currentUserId: r.user.id })
      nav(r.user.role === 'installer' ? '/field' : '/', { replace: true })
    } catch (e2) {
      tempPassword = ''
      setErr((e2 as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell foot={<ServerFoot />}>
      <div className="auth-card">
        <h1>כניסה למערכת</h1>
        <div className="sub">{brand.name} · ניהול תפעול, לקוחות ושטח</div>
        <form onSubmit={submit} noValidate>
          <Field label="טלפון או אימייל">
            <input className="input" dir="ltr" style={{ textAlign: 'right' }} autoComplete="username" inputMode="email" value={id} onChange={(e) => setId(e.target.value)} autoFocus placeholder="050-0000000" />
          </Field>
          <Field label="סיסמה">
            <div className="auth-pass">
              <input className="input" dir="ltr" style={{ textAlign: 'right' }} type={show ? 'text' : 'password'} autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
              <button type="button" className="icon-btn" onClick={() => setShow((v) => !v)} aria-label={show ? 'הסתרת הסיסמה' : 'הצגת הסיסמה'}>{show ? <EyeOff size={17} /> : <Eye size={17} />}</button>
            </div>
          </Field>
          {err ? <Callout tone="danger">{err}</Callout> : notice && <Callout tone="warning">{notice}</Callout>}
          <button className="btn primary lg block" type="submit" disabled={busy}><LogIn size={18} /> {busy ? 'נכנסים...' : 'כניסה'}</button>
          <div className="tiny muted" style={{ textAlign: 'center' }}>שכחתם סיסמה? מנהל המערכת מאפס אותה בעמוד המשתמשים.</div>
        </form>
      </div>
    </Shell>
  )
}

// הסיסמה הזמנית שהוקלדה הרגע (רק בזיכרון), כדי לא לבקש אותה שוב
let tempPassword = ''

function NewPassword() {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [current, setCurrent] = useState(tempPassword)
  const [known] = useState(Boolean(tempPassword))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (pw.length < 8) return setErr('לפחות 8 תווים')
    if (pw !== pw2) return setErr('הסיסמאות לא זהות')
    setBusy(true)
    setErr('')
    try {
      await changePassword(current, pw)
      tempPassword = ''
    } catch (e2) {
      setErr((e2 as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Shell foot={<button type="button" onClick={() => void signOut()}>יציאה</button>}>
      <div className="auth-card">
        <h1>סיסמה חדשה</h1>
        <div className="sub">נכנסתם עם סיסמה זמנית. בחרו סיסמה משלכם כדי להמשיך.</div>
        <form onSubmit={submit} noValidate>
          {!known && <Field label="הסיסמה הזמנית"><input className="input ltr" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>}
          <Field label="סיסמה חדשה" hint="לפחות 8 תווים"><input className="input ltr" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
          <Field label="שוב, לאימות"><input className="input ltr" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
          {err && <Callout tone="danger">{err}</Callout>}
          <button className="btn primary lg block" type="submit" disabled={busy}>{busy ? 'שומר...' : 'שמירה והמשך'}</button>
        </form>
      </div>
    </Shell>
  )
}

function Loading() {
  const net = useSync((s) => s.net)
  const error = useSync((s) => s.error)
  const failed = net === 'offline' || net === 'error'
  return (
    <Shell foot={<ServerFoot />}>
      {failed ? (
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <WifiOff size={30} color="var(--warning)" />
          <h1 className="mt8">אין חיבור לשרת</h1>
          <div className="sub">{error || 'בודקים שוב כל כמה שניות.'} כשהחיבור יחזור, הנתונים ייטענו לבד.</div>
          <div className="row mt16" style={{ justifyContent: 'center' }}>
            <button className="btn primary" onClick={() => void syncNow()}><RefreshCw size={16} /> לנסות עכשיו</button>
            <button className="btn" onClick={() => void signOut()}>יציאה</button>
          </div>
        </div>
      ) : (
        <>
          <div className="auth-spin" aria-hidden />
          <div>טוענים את הנתונים...</div>
        </>
      )}
    </Shell>
  )
}
