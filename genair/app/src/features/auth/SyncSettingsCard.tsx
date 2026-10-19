// הגדרות ← חיבורים: מסד נתונים משותף והתחברות. מעבר בין הדגמה בדפדפן למסד המשותף, בדיקת שרת והקמה ראשונה.
import { useMemo, useState, type ReactNode } from 'react'
import { CheckCircle2, CloudUpload, Database, LogOut, RefreshCw, Server, Users } from 'lucide-react'
import { app, useApp, useMe, DEVICE_SETTINGS } from '../../lib/store'
import { Badge, Callout, Card, Confirm, Field, toast } from '../../components/ui'
import { relative } from '../../lib/format'
import { bootstrapServer, bridge, readSyncConfig, serverHealth, signOut, switchMode, syncNow, useSync, authFetch, type NetState } from '../../lib/sync'
import type { ServerHealth } from '../../lib/sync/session'
import { docBlob, uploadToServer } from '../../lib/files'
import './auth.css'
import { brand } from '../../brand'

export function SyncSettingsCard() {
  return bridge.mode === 'server' ? <Connected /> : <LocalMode />
}

const title = (badge: ReactNode) => ({
  title: <div className="row"><Database size={17} /><h2>מסד נתונים משותף והתחברות</h2></div>,
  actions: badge,
})

const netTone: Record<NetState, 'success' | 'warning' | 'danger' | 'muted'> = { online: 'success', connecting: 'warning', offline: 'warning', error: 'danger', idle: 'muted' }
const netText: Record<NetState, string> = { online: 'מחובר', connecting: 'מתחבר', offline: 'אין חיבור', error: 'שגיאה', idle: 'לא פעיל' }

function Connected() {
  const me = useMe()
  const sync = useSync()
  const [confirm, setConfirm] = useState(false)
  const url = readSyncConfig().serverUrl
  return (
    <Card {...title(<Badge tone={netTone[sync.net]} dot>{netText[sync.net]}</Badge>)} pad>
      <p className="small muted">כל הצוות עובד על אותם נתונים. שינוי שנעשה כאן מגיע לשאר המשתמשים תוך שניות, וגם בלי קליטה העבודה נשמרת ונשלחת כשהחיבור חוזר.</p>
      <div className="grid g2 mt12 small">
        <div><span className="muted">שרת: </span><span className="ltr">{url}</span></div>
        <div><span className="muted">מחובר/ת: </span><b>{me?.name}</b></div>
        <div><span className="muted">ממתינים לשליחה: </span><b>{sync.pending}</b></div>
        <div><span className="muted">סנכרון אחרון: </span>{sync.lastSyncAt ? relative(sync.lastSyncAt) : '—'}{sync.transport ? <span className="tiny muted"> · <span className="ltr">{sync.transport === 'sse' ? 'SSE' : 'long-poll'}</span></span> : null}</div>
      </div>
      {sync.error && <div className="mt12"><Callout tone="warning">{sync.error}</Callout></div>}
      {sync.droppedOps ? <div className="mt12"><Callout tone="warning">{sync.droppedOps} שינויים של משתמש קודם במכשיר הזה לא נשלחו ונמחקו.</Callout></div> : null}
      <div className="row wrap mt12">
        <button className="btn sm" onClick={() => void syncNow().then(() => toast.success('מסונכרן'))}><RefreshCw size={15} /> סנכרון עכשיו</button>
        <button className="btn sm ghost" onClick={() => setConfirm(true)}><LogOut size={15} /> חזרה לגרסת ההדגמה</button>
      </div>
      <div className="tiny muted mt12">כתובת השרת, אסימון הגישה ומפתח ה-AI שמורים רק במכשיר הזה. כל שאר ההגדרות משותפות לכל הארגון.</div>
      {confirm && (
        <Confirm
          title="חזרה לגרסת ההדגמה"
          text="המכשיר יתנתק מהמסד המשותף, והעותק המקומי של נתוני הארגון יימחק ממנו. נתוני ההדגמה של הדפדפן הזה יחזרו."
          confirmLabel="מעבר להדגמה"
          onConfirm={() => void signOut().then(() => switchMode('local'))}
          onClose={() => setConfirm(false)}
        />
      )}
    </Card>
  )
}

function LocalMode() {
  const settings = useApp((s) => s.settings)
  const setSettings = useApp((s) => s.setSettings)
  const users = useApp((s) => s.db.users)
  const admins = useMemo(() => users.filter((u) => u.role === 'admin' && u.active), [users])
  const [shared, setShared] = useState(false)
  const [h, setH] = useState<ServerHealth | null>(null)
  const [checking, setChecking] = useState(false)
  const [adminId, setAdminId] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState('')
  const url = settings.serverUrl.trim().replace(/\/$/, '')
  const admin = adminId || admins[0]?.id || ''

  async function check() {
    setChecking(true)
    setH(null)
    try {
      setH(await serverHealth(url))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setChecking(false)
    }
  }

  async function bootstrap() {
    if (pw.length < 8) return toast.error('הסיסמה צריכה לפחות 8 תווים')
    if (pw !== pw2) return toast.error('הסיסמאות לא זהות')
    setBusy('מעלה את הנתונים...')
    try {
      const s = app()
      const { config, counters, ...collections } = s.db
      const org = Object.fromEntries(Object.entries(s.settings).filter(([k]) => !(DEVICE_SETTINGS as readonly string[]).includes(k)))
      await bootstrapServer(url, { snapshot: { collections, config, settings: org, counters }, adminUserId: admin, password: pw, bootstrapToken: code || undefined })
      // קבצים ששמורים בדפדפן הזה עולים גם הם לשרת
      const local = s.db.docs.filter((d) => d.blobKey && !d.fileId)
      let n = 0
      for (const d of local) {
        setBusy(`מעלה קבצים ${++n}/${local.length}...`)
        try {
          const blob = await docBlob(d)
          if (!blob) continue
          const r = await uploadToServer(new File([blob], d.name, { type: d.mime }), { caseId: d.caseId, folder: d.folder })
          await authFetch('/api/db/ops', { method: 'POST', json: { ops: [{ op: 'patch', collection: 'docs', id: d.id, data: { fileId: r.fileId }, unset: ['blobKey'], at: Date.now() }] } })
        } catch {
          /* קובץ שלא עלה נשאר בדפדפן הזה */
        }
      }
      toast.success('המסד המשותף הוקם')
      switchMode('server', url)
    } catch (e) {
      toast.error((e as Error).message)
      setBusy('')
    }
  }

  const db = h?.db
  return (
    <Card {...title(<Badge tone="muted" dot>הדגמה בדפדפן הזה</Badge>)} pad>
      <div className="sync-modes">
        <button type="button" className={`choice ${!shared ? 'on' : ''}`} onClick={() => setShared(false)} aria-pressed={!shared}>
          <b>הדגמה בדפדפן הזה</b>
          <small>הנתונים נשמרים רק כאן, בלי התחברות. טוב לניסיון ולהצגה.</small>
        </button>
        <button type="button" className={`choice ${shared ? 'on' : ''}`} onClick={() => setShared(true)} aria-pressed={shared}>
          <b>מסד נתונים משותף</b>
          <small>כל הצוות על אותם נתונים, עם משתמש וסיסמה, התראות בזמן אמת וקבצים בשרת.</small>
        </button>
      </div>
      {shared && (
        <div className="col mt16" style={{ gap: 12 }}>
          <div className="row wrap" style={{ alignItems: 'flex-end' }}>
            <Field label="כתובת השרת" className="grow" hint="אותו שרת של האינטגרציות (תיקיית server), על אחסון קבוע">
              <input className="input ltr" placeholder={`https://api.${brand.domain}`} value={settings.serverUrl} onChange={(e) => { setSettings({ serverUrl: e.target.value.trim() }); setH(null) }} />
            </Field>
            <button className="btn" disabled={!url || checking} onClick={() => void check()}><Server size={15} /> {checking ? 'בודק...' : 'בדיקה'}</button>
          </div>
          {db && db.mode === 'off' && <Callout tone="warning">השרת עונה, אבל המסד המשותף כבוי בו (<span className="ltr">DB_MODE=off</span>). צריך שרת עם אחסון קבוע, לא Vercel.</Callout>}
          {db && db.mode !== 'off' && db.bootstrapped && (
            <Callout tone="success">
              <div className="row wrap between">
                <span>המסד המשותף פעיל בשרת. מתחברים עם טלפון או אימייל וסיסמה.</span>
                <button className="btn sm primary" onClick={() => switchMode('server', url)}><Users size={15} /> מעבר למסד המשותף</button>
              </div>
            </Callout>
          )}
          {db && db.mode !== 'off' && !db.bootstrapped && (
            <div className="card flat" style={{ padding: 16 }}>
              <div className="row"><CloudUpload size={18} color="var(--brand-700)" /><b>הקמה ראשונה</b></div>
              <p className="small muted mt8">השרת ריק. הנתונים שבדפדפן הזה (לקוחות, תיקים, משתמשים, הגדרות וקבצים) יעלו אליו ויהיו המסד המשותף. אחר כך כל עובד מקבל סיסמה מעמוד המשתמשים.</p>
              <div className="grid g2 mt12">
                <Field label="מנהל המערכת">
                  <select className="select" value={admin} onChange={(e) => setAdminId(e.target.value)}>
                    {admins.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </Field>
                {db.bootstrapToken ? (
                  <Field label="קוד הקמה" hint="BOOTSTRAP_TOKEN מהגדרות השרת"><input className="input ltr" value={code} onChange={(e) => setCode(e.target.value)} /></Field>
                ) : <div />}
                <Field label="סיסמה למנהל" hint="לפחות 8 תווים"><input className="input ltr" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
                <Field label="שוב, לאימות"><input className="input ltr" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
              </div>
              <div className="row wrap mt12">
                <button className="btn primary" disabled={!!busy || !admin || !pw} onClick={() => void bootstrap()}><CheckCircle2 size={16} /> {busy || 'העלאת הנתונים והפעלה'}</button>
                {!admins.length && <span className="small muted">צריך לפחות משתמש פעיל אחד בתפקיד ניהול.</span>}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
