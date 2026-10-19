// ספקים, אנשי קשר, הזמנות רכש ומסמכים. כרטיס ספק: ?id=, הזמנה: ?po=
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ClipboardList, MessageCircle, Phone, Plus, Search, Truck, Users } from 'lucide-react'
import { useApp } from '../../lib/store'
import { Badge, Card, Empty, PageHead, Stat, Tabs } from '../../components/ui'
import { Dot, Stars } from '../../features/case/controls'
import { date, money } from '../../lib/format'
import { telLink, whatsappLink } from '../../lib/integrations/links'
import { isOpenPo, poStatusLabel, poStatusTone, poTotal, type PoStatus } from './po'
import { SupplierDialog } from './SupplierDialog'
import { PurchaseOrderDialog } from './PurchaseOrderDialog'
import { PurchaseOrderView } from './PurchaseOrderView'
import SupplierPage from './SupplierPage'
import type { ID } from '../../lib/types'
import '../../features/ops/ops.css'
import './suppliers.css'

type Tab = 'suppliers' | 'orders'

export default function SuppliersPage() {
  const [params, setParams] = useSearchParams()
  const suppliers = useApp((s) => s.db.suppliers)
  const pos = useApp((s) => s.db.purchaseOrders)
  const cases = useApp((s) => s.db.cases)
  const cats = useApp((s) => s.db.config.supplierCategories)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [status, setStatus] = useState<PoStatus | 'open' | ''>('open')
  const [newSup, setNewSup] = useState(false)
  const [newPo, setNewPo] = useState(false)
  const tab: Tab = params.get('tab') === 'orders' ? 'orders' : 'suppliers'
  const supplierId = params.get('id')
  const poId = params.get('po')

  const setParam = (k: string, v?: string) => {
    const p = new URLSearchParams(params)
    if (v) p.set(k, v)
    else p.delete(k)
    setParams(p)
  }
  const openPo = (id: ID) => setParam('po', id)

  const stats = useMemo(() => {
    const open = pos.filter(isOpenPo)
    return { active: suppliers.filter((s) => s.active).length, open: open.length, openValue: open.reduce((s, p) => s + poTotal(p), 0), late: open.filter((p) => p.expectedAt && p.expectedAt < new Date().toISOString().slice(0, 10)).length }
  }, [suppliers, pos])

  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    const d = t.replace(/\D/g, '')
    return suppliers
      .filter((s) => showInactive || s.active)
      .filter((s) => !cat || s.category === cat)
      .filter((s) => !t || [s.name, s.contactName, s.email, s.address].some((x) => x?.toLowerCase().includes(t)) || (d.length >= 3 && (s.phone ?? '').replace(/\D/g, '').includes(d)))
      .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'he'))
  }, [suppliers, q, cat, showInactive])

  const orders = useMemo(() => {
    const t = q.trim().toLowerCase()
    return pos
      .filter((p) => (status === 'open' ? isOpenPo(p) : !status || p.status === status))
      .filter((p) => !t || p.number.toLowerCase().includes(t) || (suppliers.find((s) => s.id === p.supplierId)?.name ?? '').toLowerCase().includes(t))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, [pos, status, q, suppliers])

  const supStats = (id: ID) => {
    const mine = pos.filter((p) => p.supplierId === id)
    return { open: mine.filter(isOpenPo).length, total: mine.filter((p) => p.status === 'received').reduce((s, p) => s + poTotal(p), 0) }
  }

  if (supplierId) {
    return (
      <>
        <SupplierPage id={supplierId} onBack={() => setParam('id')} onOpenPo={openPo} />
        {poId && <PurchaseOrderView poId={poId} onClose={() => setParam('po')} />}
      </>
    )
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      <PageHead
        title="ספקים"
        sub="ספקים, אנשי קשר, הזמנות רכש ומסמכים"
        actions={<>
          <button className="btn" onClick={() => setNewPo(true)}><ClipboardList size={16} /> הזמנת רכש</button>
          <button className="btn primary" onClick={() => setNewSup(true)}><Plus size={17} /> ספק חדש</button>
        </>}
      />

      <div className="stat-row">
        <Stat icon={<Users size={20} />} label="ספקים פעילים" value={stats.active} delta={`${suppliers.length} סה״כ`} />
        <Stat icon={<ClipboardList size={20} />} tone="warning" label="הזמנות פתוחות" value={stats.open} delta={money(stats.openValue)} onClick={() => { setParam('tab', 'orders'); setStatus('open') }} />
        <Stat icon={<Truck size={20} />} tone={stats.late ? 'danger' : 'success'} label="באיחור" value={stats.late} delta="עבר מועד האספקה" onClick={() => { setParam('tab', 'orders'); setStatus('open') }} />
      </div>

      <Card>
        <div style={{ padding: '0 12px' }}>
          <Tabs value={tab} onChange={(t) => setParam('tab', t === 'orders' ? 'orders' : undefined)} items={[
            { id: 'suppliers', label: 'ספקים', icon: <Users size={15} />, count: list.length },
            { id: 'orders', label: 'הזמנות רכש', icon: <ClipboardList size={15} />, count: stats.open },
          ]} />
        </div>
        <div className="filters" style={{ padding: '12px 14px', borderBottom: '1px solid var(--line-2)' }}>
          <div className="search-box sp-search grow">
            <Search size={16} className="muted" />
            <input className="input sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tab === 'orders' ? 'מספר הזמנה או ספק' : 'שם, איש קשר, טלפון או עיר'} aria-label="חיפוש" />
          </div>
          {tab === 'suppliers' ? (
            <>
              <select className="select sm" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="קטגוריה">
                <option value="">כל הקטגוריות</option>
                {cats.filter((c) => c.active).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
              <label className="check small"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> גם לא פעילים</label>
            </>
          ) : (
            <select className="select sm" value={status} onChange={(e) => setStatus(e.target.value as PoStatus | 'open' | '')} aria-label="סטטוס">
              <option value="open">פתוחות</option>
              <option value="">הכל</option>
              {(Object.keys(poStatusLabel) as PoStatus[]).map((s) => <option key={s} value={s}>{poStatusLabel[s]}</option>)}
            </select>
          )}
        </div>

        {tab === 'suppliers' && (list.length === 0 ? (
          <Empty icon={<Truck size={36} />} title={q || cat ? 'לא נמצא ספק' : 'עוד אין ספקים'}>{!q && !cat && <button className="btn sm primary mt8" onClick={() => setNewSup(true)}><Plus size={15} /> ספק ראשון</button>}</Empty>
        ) : (
          <>
            <div className="table-wrap hide-mobile">
              <table className="table">
                <thead><tr><th>ספק</th><th>קטגוריה</th><th>טלפון</th><th>הזמנות פתוחות</th><th className="end">רכש שהתקבל</th><th>דירוג</th></tr></thead>
                <tbody>
                  {list.map((s) => {
                    const c = cats.find((x) => x.key === s.category)
                    const st = supStats(s.id)
                    return (
                      <tr key={s.id} className={`click ${s.active ? '' : 'sp-off'}`} onClick={() => setParam('id', s.id)}>
                        <td><div className="small strong">{s.name}</div><div className="tiny muted">{[s.contactName, s.paymentTerms].filter(Boolean).join(' · ')}</div></td>
                        <td className="small nowrap"><Dot color={c?.color} /> {c?.label ?? s.category}{!s.active && <> <Badge tone="muted">לא פעיל</Badge></>}</td>
                        <td className="small nowrap" onClick={(e) => e.stopPropagation()}>
                          {s.phone ? <span className="row" style={{ gap: 4 }}><a href={telLink(s.phone)} className="ltr">{s.phone}</a><a className="icon-btn sm sp-wa" href={whatsappLink(s.phone, '')} target="_blank" rel="noreferrer" aria-label="וואטסאפ"><MessageCircle size={15} /></a></span> : '—'}
                        </td>
                        <td className="small num">{st.open || '—'}</td>
                        <td className="end small num">{st.total ? money(st.total) : '—'}</td>
                        <td>{s.rating ? <Stars value={s.rating} size={13} /> : <span className="tiny muted">—</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="list show-mobile">
              {list.map((s) => {
                const c = cats.find((x) => x.key === s.category)
                const st = supStats(s.id)
                return (
                  <div key={s.id} className={`list-item click ${s.active ? '' : 'sp-off'}`} onClick={() => setParam('id', s.id)} style={{ alignItems: 'flex-start' }}>
                    <div className="grow">
                      <div className="strong small">{s.name}</div>
                      <div className="tiny muted"><Dot color={c?.color} size={7} /> {c?.label}{s.contactName ? ` · ${s.contactName}` : ''}{st.open ? ` · ${st.open} הזמנות פתוחות` : ''}</div>
                    </div>
                    {s.phone && (
                      <span className="row" style={{ gap: 2 }} onClick={(e) => e.stopPropagation()}>
                        <a className="icon-btn sm" href={telLink(s.phone)} aria-label="חיוג"><Phone size={16} /></a>
                        <a className="icon-btn sm sp-wa" href={whatsappLink(s.phone, '')} target="_blank" rel="noreferrer" aria-label="וואטסאפ"><MessageCircle size={16} /></a>
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        ))}

        {tab === 'orders' && (orders.length === 0 ? (
          <Empty icon={<ClipboardList size={36} />} title="אין הזמנות כאן"><button className="btn sm primary mt8" onClick={() => setNewPo(true)}><Plus size={15} /> הזמנת רכש</button></Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>מספר</th><th>ספק</th><th>סטטוס</th><th className="hide-mobile">תיק</th><th className="hide-mobile">נוצרה</th><th className="hide-mobile">אספקה</th><th className="end">סה״כ</th></tr></thead>
              <tbody>
                {orders.map((p) => {
                  const sup = suppliers.find((s) => s.id === p.supplierId)
                  const k = cases.find((x) => x.id === p.caseId)
                  const late = isOpenPo(p) && p.expectedAt && p.expectedAt < new Date().toISOString().slice(0, 10)
                  return (
                    <tr key={p.id} className="click" onClick={() => openPo(p.id)}>
                      <td className="small strong nowrap"><span className="ltr">{p.number}</span></td>
                      <td className="small">{sup?.name ?? '—'}</td>
                      <td><Badge tone={poStatusTone[p.status]}>{poStatusLabel[p.status]}</Badge></td>
                      <td className="small hide-mobile">{k ? k.title : <span className="muted">מלאי</span>}</td>
                      <td className="small hide-mobile nowrap">{date(p.createdAt)}</td>
                      <td className={`small hide-mobile nowrap ${late ? 'txt-danger strong' : ''}`}>{p.receivedAt ? `התקבלה ${date(p.receivedAt)}` : p.expectedAt ? date(p.expectedAt) : '—'}</td>
                      <td className="end num small strong">{money(poTotal(p))}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ))}
      </Card>

      {newSup && <SupplierDialog onClose={() => setNewSup(false)} onSaved={(s) => setParam('id', s.id)} />}
      {newPo && <PurchaseOrderDialog onClose={() => setNewPo(false)} onSaved={(p) => openPo(p.id)} />}
      {poId && <PurchaseOrderView poId={poId} onClose={() => setParam('po')} />}
    </div>
  )
}
