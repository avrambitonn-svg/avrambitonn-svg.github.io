// בדיקת שלמות פרטי לקוח והמרה מלקוח זמני ללקוח קבוע (פתיחה ב-Priority)
import { AlertTriangle } from 'lucide-react'
import { toast } from '../../components/ui'
import { pushCustomer, priorityEnabled } from '../../lib/integrations/priority'
import type { Customer } from '../../lib/types'

// מה חסר בכרטיס: טלפון, כתובת, ול-עסק / מוסד / יזם גם ח״פ
export function missingDetails(c: Customer): string[] {
  const out: string[] = []
  if ((c.phone ?? '').replace(/\D/g, '').length < 9) out.push('טלפון')
  if (!c.addresses.some((a) => a.street?.trim() && a.city?.trim())) out.push('כתובת')
  if (c.type !== 'private' && !c.idNumber?.trim()) out.push('ח״פ / מספר עוסק')
  return out
}

export function MissingIcon({ c, size = 15 }: { c: Customer; size?: number }) {
  const miss = missingDetails(c)
  if (!miss.length) return null
  const text = `חסרים פרטים: ${miss.join(', ')}`
  return (
    <span className="cu-miss" title={text} aria-label={text} role="img">
      <AlertTriangle size={size} />
    </span>
  )
}

// המרה ללקוח קבוע: שולחים ל-Priority (אותו תהליך של סנכרון לקוח). כשהחיבור כבוי, הלקוח נכנס לתור
export async function convertToPermanent(c: Customer) {
  const miss = missingDetails(c)
  if (miss.includes('ח״פ / מספר עוסק')) {
    toast.error('כדי לפתוח לקוח עסקי ב-Priority צריך ח״פ / מספר עוסק')
    return
  }
  const s = await pushCustomer(c)
  if (s.status === 'synced') toast.success(`${c.name} נפתח ב-Priority והוא עכשיו לקוח קבוע`)
  else if (s.status === 'error') toast.error(`Priority: ${s.error ?? 'שגיאה'}`)
  else toast.info(priorityEnabled() ? 'נכנס לתור הסנכרון' : 'החיבור ל-Priority כבוי: הלקוח נכנס לתור, ויהפוך לקבוע כשיסונכרן')
}
