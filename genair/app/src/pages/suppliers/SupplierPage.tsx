// כרטיס ספק: פרטים, הזמנות רכש, הוצאות בתיקים ומסמכים
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowRight, ClipboardList, Coins, ExternalLink, FolderOpen, Globe, Info, Mail, MapPin, MessageCircle, Pencil, Phone, Plus, ShoppingCart, Wallet } from 'lucide-react'
import { useApp } from '../../lib/store'
import { Badge, Card, Empty, Stat, Tabs } from '../../components/ui'
import { DocsPanel } from '../../features/docs/DocsPanel'
import { Dot, Stars } from '../../features/case/controls'
import { date, money, phone as fmtPhone } from '../../lib/format'
import { safeHref, telLink, whatsappLink } from '../../lib/integrations/links'
import { isOpenPo, poStatusLabel, poStatusTone, poTotal } from './po'
import { SupplierDialog } from './SupplierDialog'
import { PurchaseOrderDialog } from './PurchaseOrderDialog'
import type { ID } from '../../lib/types'
import '../../features/ops/ops.css'
import './suppliers.css'

type Tab = 'orders' | 'expenses' | 'docs' | 'details'

export default function SupplierPage({ id: idProp, onBack, onOpenPo }: { id?: ID; onBack?: () => void; onOpenPo?: (id: ID) => void }) {
  const params = useParams()
  const nav = useNavigate()
  const id = idProp ?? params.id ?? ''
  const sup = useApp((s) => s.db.suppliers.find((x) => x.id === id))
  const allPos = useApp((s) => s.db.purchaseOrders)
  const money_ = useApp((s) => s.db.money)
  const cases = useApp((s) => s.db.cases)
  const cats = useApp((s) => s.db.config.supplierCategories)
  const expCats = useApp((s) => s.db.config.expenseCategories)
  const docs = useApp((s) => s.db.docs)
  const [tab, setTab] = useState<Tab>('orders')
  const [edit, setEdit] = useState(false)
  const [newPo, setNewPo] = useState(false)
  const pos = useMemo(() => allPos.filter((p) => p.supplierId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [allPos, id])
  const expenses = useMemo(() => money_.filter((m) => m.supplierId === id && m.kind === 'expense').sort((a, b) => b.at.localeCompare(a.at)), [money_, id])
  const docCount = useMemo(() => docs.filter((d) => d.supplierId === id).length, [docs, id])
  const openPo = (pid: ID) => (onOpenPo ? onOpenPo(pid) : nav(`/suppliers?po=${pid}`))
  const back = () => (onBack ? onBack() : nav('/suppliers'))

  if (!sup) return <Card><Empty title="הספק לא נמצא"><Link to="/suppliers">לרשימת הספקים</Link></Empty></Card>
  const cat = cats.find((c) => c.key === sup.category)
  const open = pos.filter(isOpenPo)
  const purchased = pos.filter((p) => p.status === 'received').reduce((s, p) => s + poTotal(p), 0)
  const spent = expenses.reduce((s, m) => s + m.amount, 0)
  const caseIds = new Set([...expenses.map((m) => m.caseId), ...pos.map((p) => p.caseId).filter(Boolean)])
  const digits = (sup.phone ?? '').replace(/\D/g, '')

  return (
    <div className="col" style={{ gap: 16 }}>
      <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={back}><ArrowRight size={15} /> כל הספקים</button>
      <Card>
        <div className="card-body row between wrap" style={{ alignItems: 'flex-start', gap: 14 }}>
          <div className="grow" style={{ minWidth: 240 }}>
            <div className="row wrap" style={{ gap: 8 }}>
              <Badge><Dot color={cat?.color} /> {cat?.label ?? sup.category}</Badge>
              {!sup.active && <Badge tone="muted">לא פעיל</Badge>}
              {sup.priorityId && <Badge tone="success">Priority · <span className="ltr">{sup.priorityId}</span></Badge>}
              {!!sup.rating && <Stars value={sup.rating} size={14} />}
            </div>
            <h1 className="mt8" style={{ fontSize: 24 }}>{sup.name}</h1>
            <div className="small muted mt8">
              {[sup.contactName, sup.paymentTerms].filter(Boolean).join(' · ')}
              {sup.vatNum && <> · ח״פ <span className="ltr">{sup.vatNum}</span></>}
            </div>
          </div>
          <div className="row wrap" style={{ gap: 6 }}>
            {sup.phone && <a className="btn sm" href={telLink(sup.phone)}><Phone size={15} /> <span className="ltr">{fmtPhone(sup.phone)}</span></a>}
            {digits.length >= 9 && <a className="btn sm wa" href={whatsappLink(sup.phone!, `שלום${sup.contactName ? ` ${sup.contactName}` : ''}, `)} target="_blank" rel="noreferrer"><MessageCircle size={15} /> וואטסאפ</a>}
            {sup.email && <a className="btn sm" href={`mailto:${sup.email}`}><Mail size={15} /> מייל</a>}
            <button className="btn sm" onClick={() => setEdit(true)}><Pencil size={15} /> עריכה</button>
            <button className="btn sm primary" onClick={() => setNewPo(true)}><Plus size={15} /> הזמנת רכש</button>
          </div>
        </div>
      </Card>

      <div className="stat-row">
        <Stat icon={<ClipboardList size={20} />} label="הזמנות פתוחות" value={open.length} delta={open.length ? money(open.reduce((s, p) => s + poTotal(p), 0)) : 'אין'} />
        <Stat icon={<ShoppingCart size={20} />} tone="success" label="רכש שהתקבל" value={<span style={{ fontSize: 22 }}>{money(purchased)}</span>} delta={`${pos.filter((p) => p.status === 'received').length} הזמנות`} />
        <Stat icon={<Wallet size={20} />} tone="warning" label="הוצאות בתיקים" value={<span style={{ fontSize: 22 }}>{money(spent)}</span>} delta={`${expenses.length} תנועות`} />
        <Stat icon={<Coins size={20} />} tone="violet" label="תיקים" value={caseIds.size} delta="שבהם עבד הספק" />
      </div>

      <Card>
        <div style={{ padding: '0 12px' }}>
          <Tabs value={tab} onChange={setTab} items={[
            { id: 'orders', label: 'הזמנות רכש', icon: <ClipboardList size={15} />, count: pos.length },
            { id: 'expenses', label: 'הוצאות', icon: <Wallet size={15} />, count: expenses.length },
            { id: 'docs', label: 'מסמכים', icon: <FolderOpen size={15} />, count: docCount },
            { id: 'details', label: 'פרטים', icon: <Info size={15} /> },
          ]} />
        </div>
        {tab === 'orders' && (pos.length === 0 ? (
          <Empty title="עוד אין הזמנות מהספק"><button className="btn sm primary mt8" onClick={() => setNewPo(true)}><Plus size={15} /> הזמנה ראשונה</button></Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>מספר</th><th>סטטוס</th><th className="hide-mobile">תיק</th><th className="hide-mobile">נוצרה</th><th className="hide-mobile">אספקה</th><th className="end">סה״כ</th></tr></thead>
              <tbody>
                {pos.map((p) => {
                  const k = cases.find((x) => x.id === p.caseId)
                  return (
                    <tr key={p.id} className="click" onClick={() => openPo(p.id)}>
                      <td className="small strong"><span className="ltr">{p.number}</span></td>
                      <td><Badge tone={poStatusTone[p.status]}>{poStatusLabel[p.status]}</Badge></td>
                      <td className="small hide-mobile">{k ? k.title : <span className="muted">מלאי</span>}</td>
                      <td className="small hide-mobile">{date(p.createdAt)}</td>
                      <td className="small hide-mobile">{p.receivedAt ? `התקבלה ${date(p.receivedAt)}` : p.expectedAt ? date(p.expectedAt) : '—'}</td>
                      <td className="end num small strong">{money(poTotal(p))}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ))}
        {tab === 'expenses' && (expenses.length === 0 ? <Empty title="אין הוצאות מקושרות">בכספי התיק בוחרים ספק לכל הוצאה</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>תאריך</th><th>תיק</th><th className="hide-mobile">קטגוריה</th><th>תיאור</th><th className="end">סכום</th></tr></thead>
              <tbody>
                {expenses.map((m) => {
                  const k = cases.find((x) => x.id === m.caseId)
                  return (
                    <tr key={m.id}>
                      <td className="small nowrap">{date(m.at)}</td>
                      <td className="small">{k ? <Link to={`/cases/${k.id}`}>{k.number}</Link> : '—'}</td>
                      <td className="small hide-mobile">{expCats.find((c) => c.key === m.category)?.label ?? m.category}</td>
                      <td className="small">{m.description}</td>
                      <td className="end num small strong">{money(m.amount)}</td>
                    </tr>
                  )
                })}
                <tr><td colSpan={4} className="end small strong">סה״כ</td><td className="end num strong">{money(spent)}</td></tr>
              </tbody>
            </table>
          </div>
        ))}
        {tab === 'docs' && <div className="card-body"><DocsPanel supplierId={sup.id} /></div>}
        {tab === 'details' && (
          <div className="card-body grid g2 small sp-details">
            <div><span className="muted">איש קשר: </span>{sup.contactName ?? '—'}</div>
            <div><span className="muted">טלפון: </span>{sup.phone ? <a href={telLink(sup.phone)} className="ltr">{fmtPhone(sup.phone)}</a> : '—'}</div>
            <div><span className="muted">אימייל: </span>{sup.email ? <a href={`mailto:${sup.email}`} className="ltr">{sup.email}</a> : '—'}</div>
            <div><span className="muted">אתר: </span>{safeHref(sup.website) ? <a href={safeHref(sup.website)} target="_blank" rel="noreferrer" className="ltr"><Globe size={13} /> {sup.website!.replace(/^https?:\/\//, '')} <ExternalLink size={12} /></a> : '—'}</div>
            <div><span className="muted">כתובת: </span>{sup.address ? <a href={`https://waze.com/ul?q=${encodeURIComponent(sup.address)}&navigate=yes`} target="_blank" rel="noreferrer"><MapPin size={13} /> {sup.address}</a> : '—'}</div>
            <div><span className="muted">ח״פ / עוסק: </span><span className="ltr">{sup.vatNum ?? '—'}</span></div>
            <div><span className="muted">תנאי תשלום: </span>{sup.paymentTerms ?? '—'}</div>
            <div><span className="muted">מספר ב-Priority: </span><span className="ltr">{sup.priorityId ?? '—'}</span></div>
            <div><span className="muted">נוסף: </span>{date(sup.createdAt)}</div>
            {sup.notes && <div className="sp-span2" style={{ whiteSpace: 'pre-wrap' }}><span className="muted">הערות: </span>{sup.notes}</div>}
          </div>
        )}
      </Card>

      {edit && <SupplierDialog supplier={sup} onClose={() => setEdit(false)} />}
      {newPo && <PurchaseOrderDialog initial={{ supplierId: sup.id }} onClose={() => setNewPo(false)} onSaved={(p) => openPo(p.id)} />}
    </div>
  )
}
