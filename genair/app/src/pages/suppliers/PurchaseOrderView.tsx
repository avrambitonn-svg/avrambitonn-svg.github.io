// הזמנת רכש: פרטים, שליחה לספק, אישור, קבלת סחורה למלאי והדפסה
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { Ban, Check, CheckCircle2, Copy, Mail, MessageCircle, PackageCheck, Pencil, Phone, Printer, Truck } from 'lucide-react'
import { useApp } from '../../lib/store'
import { Badge, Callout, Confirm, Field, Modal, toast } from '../../components/ui'
import { date, dateTime, money } from '../../lib/format'
import { telLink } from '../../lib/integrations/links'
import { choices } from '../../lib/config'
import { brand } from '../../brand'
import { locationsOf, MAIN_WAREHOUSE } from '../../features/ops/ops'
import { cancelPo, confirmPo, DIRECT, expenseCategoryFor, markPoSent, poFlow, poMail, poStatusLabel, poStatusTone, poText, poTotal, poWhatsapp, receivePo } from './po'
import { PurchaseOrderDialog } from './PurchaseOrderDialog'
import type { ID, PurchaseOrder, Supplier } from '../../lib/types'
import './suppliers.css'

export function PurchaseOrderView({ poId, onClose }: { poId: ID; onClose: () => void }) {
  const po = useApp((s) => s.db.purchaseOrders.find((x) => x.id === poId))
  const suppliers = useApp((s) => s.db.suppliers)
  const cases = useApp((s) => s.db.cases)
  const catalog = useApp((s) => s.db.catalog)
  const [edit, setEdit] = useState(false)
  const [receive, setReceive] = useState(false)
  const [cancel, setCancel] = useState(false)
  const [expected, setExpected] = useState('')
  if (!po) return <Modal title="הזמנת רכש" onClose={onClose}><div className="empty">ההזמנה לא נמצאה</div></Modal>
  const sup = suppliers.find((s) => s.id === po.supplierId)
  const k = cases.find((x) => x.id === po.caseId)
  const total = poTotal(po)
  const step = po.status === 'cancelled' ? -1 : poFlow.indexOf(po.status)
  const sku = (id?: ID) => (id ? catalog.find((c) => c.id === id)?.sku : undefined)
  const sendWa = () => {
    window.open(poWhatsapp(po, sup), '_blank', 'noopener')
    markPoSent(po.id, 'whatsapp')
    toast.success('ההזמנה נפתחה בוואטסאפ וסומנה כנשלחה')
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(poText(po, sup))
      markPoSent(po.id, 'copy')
      toast.success('נוסח ההזמנה הועתק')
    } catch {
      toast.error('לא הצלחנו להעתיק')
    }
  }

  return (
    <>
      <Modal
        size="wide"
        title={<span className="row wrap" style={{ gap: 8 }}><span className="ltr num">{po.number}</span><Badge tone={poStatusTone[po.status]} dot>{poStatusLabel[po.status]}</Badge></span>}
        onClose={onClose}
        footer={
          <div className="row wrap po-actions">
            <button className="btn sm" onClick={() => printPo()}><Printer size={15} /> הדפסה / PDF</button>
            {po.status === 'draft' && <button className="btn sm" onClick={() => setEdit(true)}><Pencil size={15} /> עריכה</button>}
            {(po.status === 'draft' || po.status === 'sent') && (
              <>
                <button className="btn sm wa" onClick={sendWa}><MessageCircle size={15} /> {po.status === 'draft' ? 'שליחה בוואטסאפ' : 'שליחה שוב'}</button>
                <a className="btn sm" href={poMail(po, sup)} onClick={() => markPoSent(po.id, 'email')}><Mail size={15} /> מייל</a>
                <button className="btn sm" onClick={copy}><Copy size={15} /> העתקה</button>
              </>
            )}
            {(po.status === 'sent' || po.status === 'confirmed') && <button className="btn sm primary" onClick={() => setReceive(true)}><PackageCheck size={15} /> קבלת סחורה</button>}
            {po.status !== 'received' && po.status !== 'cancelled' && <button className="btn sm ghost danger" onClick={() => setCancel(true)}><Ban size={15} /> ביטול</button>}
          </div>
        }
      >
        <div className="col" style={{ gap: 14 }}>
          {po.status !== 'cancelled' ? (
            <div className="po-steps" aria-label="מצב ההזמנה">
              {poFlow.map((s, i) => (
                <div key={s} className={`po-step ${i <= step ? 'done' : ''} ${i === step ? 'cur' : ''}`}>
                  <span className="n">{i < step || po.status === 'received' ? <Check size={13} /> : i + 1}</span>
                  <span className="t">{poStatusLabel[s]}</span>
                </div>
              ))}
            </div>
          ) : <Callout tone="danger">ההזמנה בוטלה{po.cancelledAt ? ` ב-${date(po.cancelledAt)}` : ''}.</Callout>}

          <div className="grid g2">
            <div className="side-box">
              <div className="tiny muted">ספק</div>
              {sup ? <Link className="strong" to={`/suppliers?id=${sup.id}`} onClick={onClose}>{sup.name}</Link> : <span className="muted">ספק שנמחק</span>}
              {sup?.contactName && <div className="small">{sup.contactName}</div>}
              <div className="row wrap mt8" style={{ gap: 6 }}>
                {sup?.phone && <a className="btn sm" href={telLink(sup.phone)}><Phone size={14} /> <span className="ltr">{sup.phone}</span></a>}
                {sup?.paymentTerms && <Badge tone="muted">{sup.paymentTerms}</Badge>}
              </div>
            </div>
            <div className="side-box small col" style={{ gap: 4 }}>
              <div><span className="muted">תיק: </span>{k ? <Link to={`/cases/${k.id}`} onClick={onClose}>{k.number} · {k.title}</Link> : 'למלאי'}</div>
              <div><span className="muted">יעד: </span>{po.toLocation === DIRECT ? 'ישירות לאתר' : po.toLocation ?? MAIN_WAREHOUSE}</div>
              <div><span className="muted">נוצרה: </span>{date(po.createdAt)}{po.sentAt ? <> · <span className="muted">נשלחה: </span>{date(po.sentAt)}</> : null}</div>
              {po.expectedAt && <div><span className="muted">אספקה צפויה: </span><b>{date(po.expectedAt)}</b></div>}
              {po.receivedAt && <div><span className="muted">התקבלה: </span>{dateTime(po.receivedAt)}</div>}
            </div>
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>תיאור</th><th className="end">כמות</th><th className="end">עלות ליח׳</th><th className="end">סה״כ</th></tr></thead>
              <tbody>
                {po.lines.map((l, i) => (
                  <tr key={i}>
                    <td className="small">{sku(l.itemId) && <span className="tiny muted ltr">{sku(l.itemId)} </span>}{l.description}</td>
                    <td className="end num small">{l.qty} <span className="tiny muted">{l.unit ?? ''}</span></td>
                    <td className="end num small">{money(l.unitCost)}</td>
                    <td className="end num small strong">{money(l.qty * l.unitCost)}</td>
                  </tr>
                ))}
                <tr><td colSpan={3} className="end small strong">סה״כ לפני מע״מ</td><td className="end num strong">{money(total)}</td></tr>
              </tbody>
            </table>
          </div>
          {po.notes && <div className="small"><span className="muted">הערות: </span>{po.notes}</div>}

          {po.status === 'sent' && (
            <div className="side-box row wrap" style={{ gap: 8 }}>
              <span className="small grow">הספק אישר? אפשר לעדכן את מועד האספקה שהוא נתן.</span>
              <input className="input sm" type="date" style={{ width: 'auto' }} value={expected || po.expectedAt || ''} onChange={(e) => setExpected(e.target.value)} aria-label="מועד אספקה" />
              <button className="btn sm" onClick={() => { confirmPo(po.id, expected || undefined); toast.success('ההזמנה סומנה כמאושרת') }}><CheckCircle2 size={15} /> הספק אישר</button>
            </div>
          )}
          {po.status === 'received' && k && po.moneyLineId && <Callout tone="success">נרשמה הוצאה בתיק <Link to={`/cases/${k.id}`} onClick={onClose}>{k.title}</Link>.</Callout>}
        </div>
      </Modal>
      {edit && <PurchaseOrderDialog po={po} onClose={() => setEdit(false)} />}
      {receive && <ReceiveDialog po={po} sup={sup} onClose={() => setReceive(false)} />}
      {cancel && <Confirm title="ביטול הזמנה" text={`לבטל את ${po.number}? אם כבר נשלחה, כדאי לעדכן גם את הספק.`} confirmLabel="ביטול ההזמנה" danger onConfirm={() => { cancelPo(po.id); toast.info('ההזמנה בוטלה') }} onClose={() => setCancel(false)} />}
      <PoSheet po={po} sup={sup} />
    </>
  )
}

export function ReceiveDialog({ po, sup, onClose }: { po: PurchaseOrder; sup?: Supplier; onClose: () => void }) {
  const stock = useApp((s) => s.db.stock)
  const users = useApp((s) => s.db.users)
  const cats = useApp((s) => s.db.config.expenseCategories)
  const k = useApp((s) => s.db.cases.find((x) => x.id === po.caseId))
  const locations = useMemo(() => locationsOf({ stock, users }), [stock, users])
  const [location, setLocation] = useState(po.toLocation && (po.toLocation === DIRECT || locations.includes(po.toLocation)) ? po.toLocation : MAIN_WAREHOUSE)
  const [qty, setQty] = useState<Record<number, number>>(() => Object.fromEntries(po.lines.map((l, i) => [i, l.qty])))
  const [category, setCategory] = useState(() => expenseCategoryFor(sup))
  const [addExpense, setAddExpense] = useState(true)
  const total = po.lines.reduce((s, l, i) => s + (qty[i] ?? l.qty) * l.unitCost, 0)
  const save = () => {
    const r = receivePo(po.id, { location, qty, category, addExpense })
    toast.success(`ההזמנה התקבלה${r.stocked ? ` · ${r.stocked} פריטים נכנסו ל${location}` : ''}${r.expense ? ' · נרשמה הוצאה בתיק' : ''}`)
    onClose()
  }
  return (
    <Modal title={`קבלת סחורה — ${po.number}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>ביטול</button><button className="btn primary" onClick={save}><Truck size={15} /> אישור קבלה</button></>}>
      <div className="col" style={{ gap: 12 }}>
        <Field label="לאן נכנסת הסחורה">
          <select className="select" value={location} onChange={(e) => setLocation(e.target.value)}>
            {locations.map((l) => <option key={l} value={l}>{l}</option>)}
            {po.caseId && <option value={DIRECT}>ישירות לאתר (לא נכנס למלאי)</option>}
          </select>
        </Field>
        <div className="list" style={{ border: '1px solid var(--line-2)', borderRadius: 10 }}>
          {po.lines.map((l, i) => (
            <div key={i} className="list-item small">
              <span className="grow">{l.description}{!l.itemId && <span className="tiny muted"> · לא נכנס למלאי</span>}</span>
              <span className="tiny muted">הוזמנו {l.qty}</span>
              <input className="input sm num" style={{ width: 72 }} type="number" min={0} value={qty[i] ?? l.qty} onChange={(e) => setQty((q) => ({ ...q, [i]: Math.max(0, Number(e.target.value) || 0) }))} aria-label="כמות שהתקבלה" />
            </div>
          ))}
        </div>
        {k && (
          <div className="side-box col" style={{ gap: 8 }}>
            <label className="check small"><input type="checkbox" checked={addExpense} onChange={(e) => setAddExpense(e.target.checked)} /> לרשום הוצאה של <b className="num">{money(total)}</b> בתיק {k.title}</label>
            {addExpense && (
              <Field label="קטגוריית הוצאה">
                <select className="select sm" value={category} onChange={(e) => setCategory(e.target.value)}>
                  {choices(cats, category).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </Field>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

// ---------- הדפסה ----------
export function printPo() {
  const prev = document.title
  const sheet = document.querySelector<HTMLElement>('.po-sheet')
  document.title = sheet?.dataset.title ?? prev
  document.body.classList.add('print-po')
  const done = () => {
    document.body.classList.remove('print-po')
    document.title = prev
    window.removeEventListener('afterprint', done)
  }
  window.addEventListener('afterprint', done)
  window.print()
  setTimeout(done, 1500)
}

function PoSheet({ po, sup }: { po: PurchaseOrder; sup?: Supplier }) {
  const k = useApp((s) => s.db.cases.find((x) => x.id === po.caseId))
  const catalog = useApp((s) => s.db.catalog)
  const [el] = useState(() => document.createElement('div'))
  useEffect(() => {
    document.body.appendChild(el)
    return () => el.remove()
  }, [el])
  const total = poTotal(po)
  return createPortal(
    <div className="po-sheet" dir="rtl" data-title={`הזמנת רכש ${po.number} — ${sup?.name ?? ''}`}>
      <div className="po-sheet-head">
        <div>
          <div className="po-brand"><span>G</span>ENAIR</div>
          <div className="tiny">{brand.name} · {brand.address} · <span className="ltr">{brand.phone}</span> · {brand.email}</div>
        </div>
        <div style={{ textAlign: 'end' }}>
          <h1>הזמנת רכש</h1>
          <div className="strong ltr">{po.number}</div>
          <div className="small">{date(po.createdAt)}</div>
        </div>
      </div>
      <div className="po-sheet-meta">
        <div><b>לכבוד: </b>{sup?.name}{sup?.contactName ? `, ${sup.contactName}` : ''}<br />{sup?.address}{sup?.phone ? <> · <span className="ltr">{sup.phone}</span></> : null}{sup?.vatNum ? <> · ח״פ <span className="ltr">{sup.vatNum}</span></> : null}</div>
        <div><b>אספקה: </b>{po.toLocation === DIRECT ? `לאתר — ${k?.title ?? ''}` : `${po.toLocation ?? MAIN_WAREHOUSE}, ${brand.address}`}{po.expectedAt ? <><br /><b>מועד מבוקש: </b>{date(po.expectedAt)}</> : null}{k ? <><br /><b>פרויקט: </b>{k.number} · {k.title}</> : null}</div>
      </div>
      <table className="po-sheet-table">
        <thead><tr><th>#</th><th>מק״ט</th><th>תיאור</th><th>כמות</th><th>יחידה</th><th>מחיר ליח׳</th><th>סה״כ</th></tr></thead>
        <tbody>
          {po.lines.map((l, i) => (
            <tr key={i}><td>{i + 1}</td><td className="ltr">{l.itemId ? catalog.find((c) => c.id === l.itemId)?.sku : ''}</td><td>{l.description}</td><td>{l.qty}</td><td>{l.unit ?? 'יח׳'}</td><td>{money(l.unitCost, true)}</td><td>{money(l.qty * l.unitCost, true)}</td></tr>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={6}>סה״כ לפני מע״מ</td><td>{money(total, true)}</td></tr></tfoot>
      </table>
      {po.notes && <p className="small"><b>הערות: </b>{po.notes}</p>}
      <p className="small">{sup?.paymentTerms ? `תנאי תשלום: ${sup.paymentTerms}. ` : ''}נא לציין את מספר ההזמנה בחשבונית ובתעודת המשלוח.</p>
      <div className="po-sign"><div>חתימה וחותמת</div><div>תאריך</div></div>
    </div>,
    el,
  )
}
