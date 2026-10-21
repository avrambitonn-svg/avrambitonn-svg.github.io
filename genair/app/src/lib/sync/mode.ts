// מעבר בין מצב הדגמה (הנתונים בדפדפן) למסד הנתונים המשותף. כל מצב שומר עותק משלו, ולכן טוענים את הדף מחדש.
// מפתח ה-AI נשמר ב-sessionStorage (משותף לשני המצבים), ואסימון הגישה לא משמש במסד המשותף, כך שלא מעבירים מפתחות.
import { writeSyncConfig, type SyncMode } from './bridge'

export function switchMode(mode: SyncMode, serverUrl?: string) {
  writeSyncConfig({
    mode,
    ...(serverUrl !== undefined ? { serverUrl: serverUrl.replace(/\/$/, '') } : {}),
    appToken: undefined,
    anthropicKey: undefined,
    ...(mode === 'local' ? { token: undefined, userId: undefined, expiresAt: undefined } : {}),
  })
  // שומרים את השינויים האחרונים לפני הטעינה מחדש
  setTimeout(() => window.location.reload(), 150)
}
