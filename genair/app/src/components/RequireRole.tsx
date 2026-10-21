// שמירה על נתיב לפי תפקיד: מי שאין לו גישה חוזר לדף הראשי (שמפנה כל תפקיד למסך שלו).
// בהדגמה זה התפקיד של המשתמש שנבחר ב"צפייה בתור".
import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useMe } from '../lib/store'
import type { Role } from '../lib/types'

export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const me = useMe()
  if (!me || !roles.includes(me.role)) return <Navigate to="/" replace />
  return <>{children}</>
}
