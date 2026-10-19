// מסך התחברות כשהמערכת עובדת מול שרת עם מסד נתונים משותף. במצב הדגמה מציג את האפליקציה כמו שהיא.
import type { ReactNode } from 'react'

export function AuthGate({ children }: { children: ReactNode }) {
  return <>{children}</>
}
