// המשתמש המחובר בתחתית התפריט: מצב הסנכרון, התראות בדפדפן ויציאה. במצב הדגמה: "גרסת הדגמה".
import { useState } from 'react'
import { Bell, LogOut } from 'lucide-react'
import { useMe } from '../../lib/store'
import { Avatar, Confirm, toast } from '../../components/ui'
import { bridge, pendingCount, signOut, syncNow, useSync, type NetState } from '../../lib/sync'
import { browserNotifyPermission, requestBrowserNotify } from '../../lib/sync/notify'
import { relative } from '../../lib/format'
import './auth.css'

export function UserMenu() {
  const me = useMe()
  if (bridge.mode !== 'server') {
    return (
      <>
        <div className="row" style={{ marginBottom: 10 }}>
          <Avatar user={me} />
          <div className="grow">
            <div style={{ color: '#fff', fontWeight: 600 }}>{me.name}</div>
            <div className="tiny">{me.title}</div>
          </div>
        </div>
        <span className="demo-badge">גרסת הדגמה</span>
      </>
    )
  }
  return <SignedIn />
}

const netLabel: Record<NetState, string> = { idle: 'לא מחובר', connecting: 'מתחבר...', online: 'מחובר · מסונכרן', offline: 'אין חיבור', error: 'שגיאת סנכרון' }

function SignedIn() {
  const me = useMe()
  const { net, pending, error, lastSyncAt } = useSync()
  const [perm, setPerm] = useState(browserNotifyPermission())
  const [confirm, setConfirm] = useState(false)
  const label = pending > 0 && net !== 'online' ? `${netLabel[net]} · ${pending} ממתינים` : pending > 0 ? `שולח ${pending}...` : netLabel[net]

  async function out() {
    if (pendingCount() > 0) return setConfirm(true)
    await signOut()
  }

  return (
    <>
      <div className="um-user">
        <Avatar user={me} />
        <div className="grow">
          <div className="nm truncate">{me.name}</div>
          <div className="tiny truncate">{me.title}</div>
        </div>
        <button className="icon-btn" onClick={() => void out()} aria-label="יציאה" title="יציאה"><LogOut size={16} /></button>
      </div>
      <div className="um-status">
        <button
          className="um-pill"
          onClick={() => void syncNow().then(() => toast.success('מסונכרן'))}
          title={[error, lastSyncAt ? `סנכרון אחרון ${relative(lastSyncAt)}` : ''].filter(Boolean).join(' · ') || 'סנכרון עכשיו'}
          aria-label={`מצב הסנכרון: ${label}. לחיצה מסנכרנת עכשיו`}
        >
          <span className={`um-dot ${net}`} />
          {label}
        </button>
      </div>
      {perm === 'default' && (
        <button className="um-link" onClick={async () => setPerm(await requestBrowserNotify())}>
          <Bell size={13} /> התראות גם כשהמערכת ברקע
        </button>
      )}
      {confirm && (
        <Confirm
          title="יש שינויים שלא נשלחו"
          text={`${pendingCount()} שינויים עוד לא הגיעו לשרת (אין חיבור). ביציאה הם יימחקו מהמכשיר.`}
          confirmLabel="יציאה בכל זאת"
          danger
          onConfirm={() => void signOut()}
          onClose={() => setConfirm(false)}
        />
      )}
    </>
  )
}
