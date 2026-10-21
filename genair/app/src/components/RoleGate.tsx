// A screen only some roles may open. The menu already hides it from the others; this stops a typed address or an old
// link from showing it anyway. (What a person can actually read or change is decided by the server.)
import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useApp } from '../lib/store'
import type { Role } from '../lib/types'

export function RoleGate({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const role = useApp((s) => s.db.users.find((u) => u.id === s.currentUserId)?.role)
  if (!role) return null
  if (!roles.includes(role)) return <Navigate to={role === 'installer' ? '/field' : '/'} replace />
  return <>{children}</>
}
