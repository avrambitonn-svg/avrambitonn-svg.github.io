// שכבת הפלטפורמה: מסד נתונים משותף (Supabase), התחברות, סנכרון בזמן אמת. ראו engine.ts, session.ts, supabase.ts ו-bridge.ts.
import { bridge } from './bridge'
import { startSync } from './engine'
import { startReconciler } from './reconcile'
import { watchCalendar } from './calendar'

export { bridge, readSyncConfig, writeSyncConfig, publicServerUrl, publicHeaders, type SyncMode, type SyncConfig } from './bridge'
export { useSync, startSync, stopSync, syncNow, signOut, pendingCount, type NetState } from './engine'
export { useSession, login, logout, changePassword, bootstrapServer, serverHealth, setUserPassword, listCredentials, authFetch, edgeHeaders, rpc, loginLabel, SyncError } from './session'
export { serverMode, functionsBase, loginEmail, SUPABASE_URL } from './supabase'

export const isServerMode = () => bridge.mode === 'server'

/** מופעל פעם אחת כשהמערכת עולה (AuthGate): יומן גוגל בשני המצבים; סנכרון והשלמות במצב משותף */
export function startPlatform() {
  watchCalendar()
  if (bridge.mode !== 'server') return
  startReconciler()
  void startSync()
}
