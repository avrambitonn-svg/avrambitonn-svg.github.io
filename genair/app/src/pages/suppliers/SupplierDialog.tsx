// הוספה ועריכה של ספק
import { useState } from 'react'
import { useApp } from '../../lib/store'
import { Field, Modal, toast } from '../../components/ui'
import { Stars, Switch } from '../../features/case/controls'
import { choices } from '../../lib/config'
import { nowIso, uid } from '../../lib/format'
import type { Supplier } from '../../lib/types'

const terms = ['שוטף + 30', 'שוטף + 45', 'שוטף + 60', 'מזומן', 'העברה מראש']

export function SupplierDialog({ supplier, onClose, onSaved }: { supplier?: Supplier; onClose: () => void; onSaved?: (s: Supplier) => void }) {
  const cats = useApp((s) => s.db.config.supplierCategories)
  const all = useApp((s) => s.db.suppliers)
  const upsert = useApp((s) => s.upsert)
  const [f, setF] = useState<Supplier>(() => supplier ?? { id: uid('sp'), name: '', category: cats.find((c) => c.active)?.key ?? 'other', active: true, createdAt: nowIso(), rating: 0 })
  const set = (p: Partial<Supplier>) => setF((x) => ({ ...x, ...p }))
  const digits = (f.phone ?? '').replace(/\D/g, '')
  const dup = f.name.trim() ? all.find((s) => s.id !== f.id && s.name.trim() === f.name.trim()) : undefined
  const phoneBad = !!f.phone && digits.length < 9
  const mailBad = !!f.email && !/^\S+@\S+\.\S+$/.test(f.email)
  const ok = f.name.trim() && !phoneBad && !mailBad
  const save = () => {
    const clean: Supplier = { ...f, name: f.name.trim(), website: f.website?.trim() ? (/^https?:\/\//.test(f.website.trim()) ? f.website.trim() : `https://${f.website.trim()}`) : undefined }
    upsert('suppliers', clean)
    toast.success(supplier ? 'הספק עודכן' : 'הספק נוסף')
    onSaved?.(clean)
    onClose()
  }
  return (
    <Modal
      title={supplier ? `עריכת ספק — ${supplier.name}` : 'ספק חדש'}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>ביטול</button><button className="btn primary" disabled={!ok} onClick={save}>{supplier ? 'שמירה' : 'הוספה'}</button></>}
    >
      <div className="col" style={{ gap: 12 }}>
        <div className="grid g2">
          <Field label="שם הספק *"><input className="input" autoFocus value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="שם העסק" /></Field>
          <Field label="קטגוריה">
            <select className="select" value={f.category} onChange={(e) => set({ category: e.target.value })}>
              {choices(cats, f.category).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </Field>
          <Field label="איש קשר"><input className="input" value={f.contactName ?? ''} onChange={(e) => set({ contactName: e.target.value || undefined })} /></Field>
          <Field label="טלפון" hint={phoneBad ? <span className="txt-danger">מספר קצר מדי</span> : 'לחיוג ולוואטסאפ מהמערכת'}><input className="input ltr" inputMode="tel" value={f.phone ?? ''} onChange={(e) => set({ phone: e.target.value || undefined })} placeholder="05X-XXXXXXX" /></Field>
          <Field label="אימייל" hint={mailBad ? <span className="txt-danger">כתובת לא תקינה</span> : undefined}><input className="input ltr" inputMode="email" value={f.email ?? ''} onChange={(e) => set({ email: e.target.value || undefined })} /></Field>
          <Field label="אתר"><input className="input ltr" value={f.website ?? ''} onChange={(e) => set({ website: e.target.value || undefined })} placeholder="www..." /></Field>
          <Field label="כתובת" className="sp-span2"><input className="input" value={f.address ?? ''} onChange={(e) => set({ address: e.target.value || undefined })} /></Field>
          <Field label="ח״פ / עוסק מורשה"><input className="input ltr" inputMode="numeric" value={f.vatNum ?? ''} onChange={(e) => set({ vatNum: e.target.value || undefined })} /></Field>
          <Field label="מספר ספק ב-Priority"><input className="input ltr" value={f.priorityId ?? ''} onChange={(e) => set({ priorityId: e.target.value || undefined })} placeholder="S10000" /></Field>
          <Field label="תנאי תשלום">
            <input className="input" list="sp-terms" value={f.paymentTerms ?? ''} onChange={(e) => set({ paymentTerms: e.target.value || undefined })} />
            <datalist id="sp-terms">{terms.map((t) => <option key={t} value={t} />)}</datalist>
          </Field>
          <Field label="דירוג"><span style={{ height: 40, display: 'flex', alignItems: 'center' }}><Stars value={f.rating ?? 0} onChange={(v) => set({ rating: v })} size={20} /></span></Field>
        </div>
        <Field label="הערות"><textarea className="textarea" value={f.notes ?? ''} onChange={(e) => set({ notes: e.target.value || undefined })} placeholder="זמני אספקה, שעות הזמנה, הנחות..." /></Field>
        <Switch checked={f.active} onChange={(v) => set({ active: v })} label={f.active ? 'ספק פעיל' : 'לא פעיל (לא יופיע בהזמנות חדשות)'} />
        {dup && <div className="small txt-warning">כבר יש ספק בשם הזה.</div>}
      </div>
    </Modal>
  )
}
