// הגדרות ← חיבורים: מסד נתונים משותף והתחברות. במסד המשותף (Supabase): מצב החיבור והסנכרון ובדיקת השרת.
// בגרסת ההדגמה: הסבר (המצב נקבע בבנייה: npm run build = Supabase, npm run build:demo = הדגמה).
import { useState, type ReactNode } from 'react'
import { Database, RefreshCw, Server } from 'lucide-react'
import { useMe } from '../../lib/store'
import { Badge, Callout, Card, toast } from '../../components/ui'
import { relative } from '../../lib/format'
import { SUPABASE_URL, bridge, serverHealth, syncNow, useSync, type NetState } from '../../lib/sync'
import type { ServerHealth } from '../../lib/sync/session'
import './auth.css'

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
  const [h, setH] = useState<ServerHealth | null>(null)
  const [checking, setChecking] = useState(false)
  const host = SUPABASE_URL.replace(/^https?:\/\//, '')

  async function check() {
    setChecking(true)
    try {
      setH(await serverHealth())
      toast.success('השרת עונה')
    } catch (e) {
      setH(null)
      toast.error((e as Error).message)
    } finally {
      setChecking(false)
    }
  }

  return (
    <Card {...title(<Badge tone={netTone[sync.net]} dot>{netText[sync.net]}</Badge>)} pad>
      <p className="small muted">כל הצוות עובד על אותם נתונים. שינוי שנעשה כאן מגיע לשאר המשתמשים תוך שניות, וגם בלי קליטה העבודה נשמרת ונשלחת כשהחיבור חוזר.</p>
      <div className="grid g2 mt12 small">
        <div><span className="muted">שרת: </span><span className="ltr">{host}</span> <span className="tiny muted">(Supabase)</span></div>
        <div><span className="muted">מחובר/ת: </span><b>{me?.name}</b></div>
        <div><span className="muted">ממתינים לשליחה: </span><b>{sync.pending}</b></div>
        <div><span className="muted">סנכרון אחרון: </span>{sync.lastSyncAt ? relative(sync.lastSyncAt) : '—'}{sync.transport ? <span className="tiny muted"> · {sync.transport === 'realtime' ? 'בזמן אמת' : 'בדיקה כל 30 שניות'}</span> : null}</div>
      </div>
      {sync.error && <div className="mt12"><Callout tone="warning">{sync.error}</Callout></div>}
      {sync.droppedOps ? <div className="mt12"><Callout tone="warning">{sync.droppedOps} שינויים של משתמש קודם במכשיר הזה לא נשלחו ונמחקו.</Callout></div> : null}
      {h && (
        <div className="row wrap small mt12" style={{ gap: 6 }}>
          <Badge tone={h.db?.ready !== false ? 'success' : 'danger'}>מסד נתונים {h.db?.ready !== false ? 'פעיל' : 'לא זמין'}</Badge>
          {h.version && <span className="tiny muted ltr">v{h.version}</span>}
        </div>
      )}
      <div className="row wrap mt12">
        <button className="btn sm" onClick={() => void syncNow().then(() => toast.success('מסונכרן'))}><RefreshCw size={15} /> סנכרון עכשיו</button>
        <button className="btn sm ghost" disabled={checking} onClick={() => void check()}><Server size={15} /> {checking ? 'בודק...' : 'בדיקת השרת'}</button>
      </div>
      <div className="tiny muted mt12">ההתחברות שמורה רק במכשיר הזה. כל שאר ההגדרות משותפות לכל הארגון.</div>
    </Card>
  )
}

function LocalMode() {
  return (
    <Card {...title(<Badge tone="muted" dot>הדגמה בדפדפן הזה</Badge>)} pad>
      <p className="small muted">זו גרסת ההדגמה: הנתונים נשמרים רק בדפדפן הזה, בלי התחברות. טוב לניסיון ולהצגה.</p>
      <p className="small muted mt8">הגרסה לעבודה אמיתית מחוברת למסד הנתונים המשותף (Supabase): כל הצוות על אותם נתונים, עם כניסה בטלפון נייד וסיסמה, עדכונים בזמן אמת וקבצים בשרת. את הנתונים שהוזנו כאן אפשר להעלות אליה בהקמה הראשונה (מהדפדפן הזה או מקובץ גיבוי).</p>
    </Card>
  )
}
