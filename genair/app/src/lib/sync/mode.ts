// מעבר בין מצב הדגמה (הנתונים בדפדפן) למסד הנתונים המשותף. כל מצב שומר עותק משלו, ולכן טוענים את הדף מחדש.
import { app } from '../store'
import { writeSyncConfig, type SyncMode } from './bridge'

export function switchMode(mode: SyncMode, serverUrl?: string) {
  const s = app().settings
  writeSyncConfig({
    mode,
    ...(serverUrl !== undefined ? { serverUrl: serverUrl.replace(/\/$/, '') } : {}),
    // מפתחות המכשיר עוברים איתנו לעותק השני
    appToken: s.appToken,
    anthropicKey: s.anthropicKey,
    ...(mode === 'local' ? { token: undefined, userId: undefined, expiresAt: undefined } : {}),
  })
  // שומרים את השינויים האחרונים לפני הטעינה מחדש
  setTimeout(() => window.location.reload(), 150)
}
