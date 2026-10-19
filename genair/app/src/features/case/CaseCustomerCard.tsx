// כרטיס הלקוח בתיק: פרטים, סנכרון ל-Priority, משלם, אנשי קשר ופעולות מהירות
import { Link } from 'react-router-dom'
import { useApp } from '../../lib/store'
import { Badge, Card } from '../../components/ui'
import { QuickContact } from '../../components/extras'
import { customerTypeLabel, syncLabel, syncTone } from '../../lib/labels'
import { phone } from '../../lib/format'
import type { ID } from '../../lib/types'

export function CaseCustomerCard({ caseId, onWhatsapp }: { caseId: ID; onWhatsapp: () => void }) {
  const db = useApp((s) => s.db)
  const k = db.cases.find((x) => x.id === caseId)
  if (!k) return null
  const c = db.customers.find((x) => x.id === k.customerId)
  const payer = db.customers.find((x) => x.id === k.payerCustomerId)
  const addr = c?.addresses.find((a) => a.id === k.addressId) ?? c?.addresses[0]
  const contacts = db.contacts.filter((x) => k.contactIds.includes(x.id))
  const primary = contacts.find((x) => x.primary) ?? contacts[0]
  return (
    <Card title="לקוח" pad>
      <div className="strong">{c?.name}</div>
      <div className="small muted">{c && customerTypeLabel[c.type]} · <span className="ltr">{phone(c?.phone)}</span></div>
      {c && (
        <div className="row mt8" style={{ gap: 6 }}>
          <Badge tone={syncTone[c.sync.status]}>{syncLabel[c.sync.status]} ב-Priority</Badge>
          {c.temp && <Badge tone="warning">לקוח זמני</Badge>}
        </div>
      )}
      {payer && <div className="small mt8">משלם: <Link to={`/customers/${payer.id}`}>{payer.name}</Link></div>}
      <div className="mt12"><QuickContact phone={primary?.phone ?? c?.phone} address={addr} whatsapp={onWhatsapp} /></div>
      {contacts.length > 0 && (
        <div className="mt12 col" style={{ gap: 6 }}>
          {contacts.map((x) => (
            <div key={x.id} className="small">{x.name}{x.role ? ` · ${x.role}` : ''} · <span className="ltr">{phone(x.phone)}</span></div>
          ))}
        </div>
      )}
      {addr?.entryNotes && <div className="small muted mt8">כניסה: {addr.entryNotes}</div>}
    </Card>
  )
}
