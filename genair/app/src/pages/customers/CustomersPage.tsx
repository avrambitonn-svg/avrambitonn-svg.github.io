import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, RefreshCw } from 'lucide-react'
import { useApp } from '../../lib/store'
import { Badge, Card, Empty, Field, Modal, PageHead, Tabs, toast } from '../../components/ui'
import { customerTypeLabel, syncLabel, syncTone } from '../../lib/labels'
import { phone, uid } from '../../lib/format'
import { createCustomer } from '../../lib/actions'
import { pushCustomer, priorityEnabled } from '../../lib/integrations/priority'
import type { CustomerType } from '../../lib/types'

export default function CustomersPage() {
  const db = useApp((s) => s.db)
  const nav = useNavigate()
  const [tab, setTab] = useState<'customers' | 'contacts'>('customers')
  const [q, setQ] = useState('')
  const [type, setType] = useState<CustomerType | ''>('')
  const [newOpen, setNewOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)

  const list = useMemo(() => {
    const t = q.trim()
    const d = t.replace(/\D/g, '')
    return db.customers
      .filter((c) => !type || c.type === type)
      .filter((c) => !t || c.name.includes(t) || (d.length >= 3 && c.phone.replace(/\D/g, '').includes(d)) || c.addresses.some((a) => a.city.includes(t) || a.street.includes(t)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, [db.customers, q, type])

  const contacts = useMemo(() => {
    const t = q.trim()
    return db.contacts.filter((c) => !t || c.name.includes(t) || c.phone.includes(t.replace(/\D/g, '') || '~'))
  }, [db.contacts, q])

  const unsynced = db.customers.filter((c) => c.sync.status !== 'synced').length

  return (
    <div>
      <PageHead
        title="לקוחות"
        sub={`${db.customers.length} לקוחות · ${unsynced} לא מסונכרנים ל-Priority`}
        actions={
          <>
            <button
              className="btn"
              disabled={syncing}
              onClick={async () => {
                if (!priorityEnabled()) {
                  toast.info('החיבור ל-Priority כבוי. אפשר להפעיל אותו בהגדרות ← חיבורים.')
                  return
                }
                setSyncing(true)
                let ok = 0
                for (const c of db.customers.filter((x) => x.sync.status !== 'synced')) if ((await pushCustomer(c)).status === 'synced') ok++
                setSyncing(false)
                toast.success(`${ok} לקוחות סונכרנו`)
              }}
            >
              <RefreshCw size={16} /> {syncing ? 'מסנכרן...' : 'סנכרון ל-Priority'}
            </button>
            <button className="btn primary" onClick={() => setNewOpen(true)}><Plus size={17} /> לקוח חדש</button>
          </>
        }
      />
      <div className="row wrap mb16">
        <input className="input sm" style={{ maxWidth: 280 }} placeholder="חיפוש שם, טלפון או עיר" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="row wrap">
          <button className={`chip ${type === '' ? 'on' : ''}`} onClick={() => setType('')}>הכל</button>
          {(Object.keys(customerTypeLabel) as CustomerType[]).map((t) => (
            <button key={t} className={`chip ${type === t ? 'on' : ''}`} onClick={() => setType(t)}>{customerTypeLabel[t]}</button>
          ))}
        </div>
      </div>
      <Card>
        <div style={{ padding: '0 12px' }}>
          <Tabs value={tab} onChange={setTab} items={[{ id: 'customers', label: 'לקוחות', count: list.length }, { id: 'contacts', label: 'אנשי קשר', count: contacts.length }]} />
        </div>
        {tab === 'customers' && (list.length === 0 ? <Empty title="לא נמצאו לקוחות" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>שם</th><th>טלפון</th><th className="hide-mobile">עיר</th><th className="hide-mobile">סוג</th><th className="hide-mobile">תיקים</th><th>Priority</th></tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id} className="click" onClick={() => nav(`/customers/${c.id}`)}>
                    <td>
                      <div className="strong small">{c.name}</div>
                      {c.temp && <Badge tone="warning">לקוח זמני</Badge>}
                    </td>
                    <td className="small"><span className="ltr">{phone(c.phone)}</span></td>
                    <td className="small hide-mobile">{c.addresses[0]?.city}</td>
                    <td className="small hide-mobile">{customerTypeLabel[c.type]}</td>
                    <td className="small hide-mobile">{db.cases.filter((k) => k.customerId === c.id).length}</td>
                    <td>
                      <Badge tone={syncTone[c.sync.status]}>{syncLabel[c.sync.status]}</Badge>
                      {c.sync.priorityId && <div className="tiny muted num">{c.sync.priorityId}</div>}
                      {c.sync.error && <div className="tiny" style={{ color: 'var(--danger)' }}>{c.sync.error}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {tab === 'contacts' && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>שם</th><th>תפקיד</th><th>טלפון</th><th>לקוח</th></tr></thead>
              <tbody>
                {contacts.map((ct) => {
                  const c = db.customers.find((x) => x.id === ct.customerId)
                  return (
                    <tr key={ct.id} className="click" onClick={() => c && nav(`/customers/${c.id}`)}>
                      <td className="small strong">{ct.name} {ct.primary && <Badge tone="brand">ראשי</Badge>}</td>
                      <td className="small">{ct.role ?? '—'}</td>
                      <td className="small"><span className="ltr">{phone(ct.phone)}</span></td>
                      <td className="small">{c?.name}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {newOpen && <NewCustomerDialog onClose={() => setNewOpen(false)} onCreated={(id) => nav(`/customers/${id}`)} />}
    </div>
  )
}

export function NewCustomerDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const db = useApp((s) => s.db)
  const upsert = useApp((s) => s.upsert)
  const [f, setF] = useState({ name: '', phone: '', email: '', idNumber: '', type: 'private' as CustomerType, city: 'ירושלים', street: '', number: '' })
  const dup = f.phone.replace(/\D/g, '').length >= 9 ? db.customers.find((c) => c.phone.replace(/\D/g, '') === f.phone.replace(/\D/g, '')) : undefined
  const ok = f.name.trim() && f.phone.replace(/\D/g, '').length >= 9
  return (
    <Modal
      title="לקוח חדש"
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>ביטול</button><button className="btn primary" disabled={!ok} onClick={() => {
        const c = createCustomer({ name: f.name.trim(), phone: f.phone, email: f.email || undefined, idNumber: f.idNumber || undefined, type: f.type, addresses: f.street ? [{ id: uid('ad'), city: f.city, street: f.street, number: f.number }] : [] })
        upsert('contacts', { id: uid('ct'), customerId: c.id, name: f.name.trim(), phone: f.phone, primary: true })
        toast.success('הלקוח נוצר. הוא יישאר "זמני" עד שייפתח ב-Priority.')
        onCreated(c.id)
      }}>יצירה</button></>}
    >
      <div className="grid g2">
        <Field label="שם *"><input className="input" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="טלפון *"><input className="input ltr" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="אימייל"><input className="input ltr" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="ת״ז / ח״פ"><input className="input" value={f.idNumber} onChange={(e) => setF({ ...f, idNumber: e.target.value })} /></Field>
        <Field label="עיר"><input className="input" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Field label="רחוב" className="grow"><input className="input" value={f.street} onChange={(e) => setF({ ...f, street: e.target.value })} /></Field>
          <Field label="מס׳"><input className="input" style={{ width: 70 }} value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} /></Field>
        </div>
      </div>
      <div className="row wrap mt12">
        {(Object.keys(customerTypeLabel) as CustomerType[]).map((t) => (
          <button key={t} className={`chip ${f.type === t ? 'on' : ''}`} onClick={() => setF({ ...f, type: t })}>{customerTypeLabel[t]}</button>
        ))}
      </div>
      {dup && <div className="mt12 small" style={{ color: 'var(--warning)' }}>שימו לב: כבר קיים לקוח עם הטלפון הזה — {dup.name}</div>}
    </Modal>
  )
}
