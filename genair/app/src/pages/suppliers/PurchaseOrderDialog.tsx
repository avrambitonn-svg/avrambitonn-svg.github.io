// הזמנת רכש חדשה או עריכת טיוטה: ספק, שורות מהקטלוג או טקסט חופשי, שיוך לתיק, יעד אספקה
import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useApp } from '../../lib/store'
import { Field, Modal, toast } from '../../components/ui'
import { categoryLabel } from '../../lib/labels'
import { money } from '../../lib/format'
import { locationsOf, MAIN_WAREHOUSE } from '../../features/ops/ops'
import { createPurchaseOrder, DIRECT, poTotal, updatePurchaseOrder } from './po'
import type { CatalogItem, ItemCategory, PurchaseOrder } from '../../lib/types'
import './suppliers.css'

type Line = PurchaseOrder['lines'][number]
const catOrder: ItemCategory[] = ['unit', 'material', 'accessory', 'heating', 'ventilation', 'service', 'labor']

export function PurchaseOrderDialog({ po, initial, onClose, onSaved }: { po?: PurchaseOrder; initial?: Partial<PurchaseOrder>; onClose: () => void; onSaved?: (po: PurchaseOrder) => void }) {
  const suppliers = useApp((s) => s.db.suppliers)
  const catalog = useApp((s) => s.db.catalog)
  const cases = useApp((s) => s.db.cases)
  const stock = useApp((s) => s.db.stock)
  const users = useApp((s) => s.db.users)
  const cats = useApp((s) => s.db.config.supplierCategories)
  const base = po ?? initial ?? {}
  const [supplierId, setSupplierId] = useState(base.supplierId ?? '')
  const [caseId, setCaseId] = useState(base.caseId ?? '')
  const [toLocation, setToLocation] = useState(base.toLocation ?? MAIN_WAREHOUSE)
  const [expectedAt, setExpectedAt] = useState(base.expectedAt ?? '')
  const [notes, setNotes] = useState(base.notes ?? '')
  const [lines, setLines] = useState<Line[]>(() => base.lines?.length ? base.lines : [{ description: '', qty: 1, unitCost: 0 }])
  const locations = useMemo(() => locationsOf({ stock, users }), [stock, users])
  const activeSuppliers = useMemo(() => suppliers.filter((s) => s.active || s.id === supplierId).sort((a, b) => a.name.localeCompare(b.name, 'he')), [suppliers, supplierId])
  const openCases = useMemo(() => cases.filter((k) => !['closed', 'lost'].includes(k.stage) || k.id === caseId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [cases, caseId])
  const items = useMemo(() => catalog.filter((c) => c.active), [catalog])
  const grouped = useMemo(() => catOrder.map((c) => [c, items.filter((i) => i.category === c)] as const).filter(([, l]) => l.length), [items])
  const setLine = (i: number, p: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)))
  const pickItem = (i: number, it?: CatalogItem) => setLine(i, it ? { itemId: it.id, description: it.name, unitCost: it.cost, unit: it.unit } : { itemId: undefined })
  const valid = lines.filter((l) => l.description.trim() && l.qty > 0)
  const total = poTotal({ lines: valid })
  const ok = !!supplierId && valid.length > 0

  const save = () => {
    if (!ok) return
    const data = { supplierId, caseId: caseId || undefined, toLocation, expectedAt: expectedAt || undefined, notes: notes.trim() || undefined, lines: valid.map((l) => ({ ...l, description: l.description.trim() })) }
    if (po) {
      updatePurchaseOrder(po.id, data)
      toast.success(`ההזמנה ${po.number} עודכנה`)
      onSaved?.({ ...po, ...data })
    } else {
      const created = createPurchaseOrder(data)
      toast.success(`נוצרה הזמנה ${created.number}`)
      onSaved?.(created)
    }
    onClose()
  }

  return (
    <Modal
      size="wide"
      title={po ? `עריכת הזמנה ${po.number}` : 'הזמנת רכש חדשה'}
      onClose={onClose}
      footer={<>
        <span className="grow small">סה״כ לפני מע״מ: <b className="num">{money(total)}</b></span>
        <button className="btn" onClick={onClose}>ביטול</button>
        <button className="btn primary" disabled={!ok} onClick={save}>{po ? 'שמירה' : 'יצירת הזמנה'}</button>
      </>}
    >
      <div className="col" style={{ gap: 14 }}>
        <div className="grid g2">
          <Field label="ספק *">
            <select className="select" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">בחירת ספק...</option>
              {cats.map((c) => {
                const list = activeSuppliers.filter((s) => s.category === c.key)
                return list.length ? <optgroup key={c.key} label={c.label}>{list.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup> : null
              })}
              {activeSuppliers.filter((s) => !cats.some((c) => c.key === s.category)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="שיוך לתיק" hint="בקבלת הסחורה תירשם הוצאה בתיק">
            <select className="select" value={caseId} onChange={(e) => { setCaseId(e.target.value); if (!e.target.value && toLocation === DIRECT) setToLocation(MAIN_WAREHOUSE) }}>
              <option value="">בלי תיק (למלאי)</option>
              {openCases.map((k) => <option key={k.id} value={k.id}>{k.number} · {k.title}</option>)}
            </select>
          </Field>
          <Field label="יעד אספקה">
            <select className="select" value={toLocation} onChange={(e) => setToLocation(e.target.value)}>
              {locations.map((l) => <option key={l} value={l}>{l}</option>)}
              {caseId && <option value={DIRECT}>ישירות לאתר (לא נכנס למלאי)</option>}
            </select>
          </Field>
          <Field label="מועד אספקה מבוקש"><input className="input" type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} /></Field>
        </div>

        <div>
          <div className="label mb8">שורות</div>
          <div className="po-lines">
            <div className="po-lrow po-lhead hide-mobile"><span>פריט מהקטלוג</span><span>תיאור</span><span>כמות</span><span>עלות ליח׳</span><span className="end">סה״כ</span><span /></div>
            {lines.map((l, i) => (
              <div key={i} className="po-lrow">
                <select className="select sm" value={l.itemId ?? ''} onChange={(e) => pickItem(i, items.find((x) => x.id === e.target.value))} aria-label="פריט מהקטלוג">
                  <option value="">טקסט חופשי</option>
                  {grouped.map(([c, list]) => <optgroup key={c} label={categoryLabel[c]}>{list.map((it) => <option key={it.id} value={it.id}>{it.sku} · {it.name}</option>)}</optgroup>)}
                </select>
                <input className="input sm" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="מה מזמינים" aria-label="תיאור" />
                <input className="input sm num" type="number" min={0} inputMode="decimal" value={l.qty} onChange={(e) => setLine(i, { qty: Math.max(0, Number(e.target.value) || 0) })} aria-label="כמות" />
                <input className="input sm num" type="number" min={0} inputMode="decimal" value={l.unitCost} onChange={(e) => setLine(i, { unitCost: Math.max(0, Number(e.target.value) || 0) })} aria-label="עלות ליחידה" />
                <span className="num small strong end">{money(l.qty * l.unitCost)}</span>
                <button className="icon-btn sm" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : [{ description: '', qty: 1, unitCost: 0 }]))} aria-label="מחיקת שורה"><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
          <button className="btn sm mt8" onClick={() => setLines((ls) => [...ls, { description: '', qty: 1, unitCost: 0 }])}><Plus size={15} /> שורה</button>
        </div>
        <Field label="הערות לספק"><textarea className="textarea" style={{ minHeight: 64 }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="שעות פריקה, איש קשר באתר, אישור חניה..." /></Field>
      </div>
    </Modal>
  )
}
