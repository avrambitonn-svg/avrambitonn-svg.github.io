import { useMemo, useState } from 'react'
import { AlertTriangle, ArrowLeftRight, Boxes, ClipboardList, Coins, FilePlus2, Mail, MessageCircle, PackageCheck, PackagePlus, Search, SlidersHorizontal, Truck, Warehouse } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge, Callout, Card, Empty, Field, Modal, PageHead, Stat, Tabs, toast } from '../../components/ui'
import { app, useApp, useMe } from '../../lib/store'
import type { CatalogItem, ID, StockEntry } from '../../lib/types'
import { categoryLabel } from '../../lib/labels'
import { date as fmtDate, money, number as fmtNum } from '../../lib/format'
import { findStock, isVan, locationsOf, MAIN_WAREHOUSE, moveStock, readPref, setStock, vanOf, writePref } from '../../features/ops/ops'
import { createPurchaseOrder, isOpenPo, markPoSent, poMail, poStatusLabel, poTotal, poWhatsapp } from '../suppliers/po'
import { PurchaseOrderView, ReceiveDialog } from '../suppliers/PurchaseOrderView'
import '../../features/ops/ops.css'

type Transfer = { itemId?: ID; from?: string; to?: string; qty?: number }
const shortLoc = (l: string) => (isVan(l) ? l.replace('רכב — ', 'רכב ') : l)

export default function InventoryPage() {
  const stock = useApp((s) => s.db.stock)
  const catalog = useApp((s) => s.db.catalog)
  const users = useApp((s) => s.db.users)
  const me = useMe()
  const locations = useMemo(() => locationsOf({ stock, users }), [stock, users])
  const [loc, setLoc] = useState<string>(() => (me.role === 'installer' && locations.includes(vanOf(me)) ? vanOf(me) : 'all'))
  const [q, setQ] = useState('')
  const [onlyLow, setOnlyLow] = useState(false)
  const [adjust, setAdjust] = useState<StockEntry | 'new' | null>(null)
  const [transfer, setTransfer] = useState<Transfer | null>(null)
  const [poView, setPoView] = useState<ID | null>(null)

  const item = (id: ID) => catalog.find((c) => c.id === id)
  const low = useMemo(() => stock.filter((e) => e.qty < e.min), [stock])
  const stats = useMemo(() => {
    const value = stock.reduce((s, e) => s + Math.max(0, e.qty) * (catalog.find((c) => c.id === e.itemId)?.cost ?? 0), 0)
    const whValue = stock.filter((e) => e.location === MAIN_WAREHOUSE).reduce((s, e) => s + Math.max(0, e.qty) * (catalog.find((c) => c.id === e.itemId)?.cost ?? 0), 0)
    return { items: new Set(stock.map((e) => e.itemId)).size, value, whValue, vans: locations.filter(isVan).length }
  }, [stock, catalog, locations])

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase()
    return stock
      .filter((e) => loc === 'all' || e.location === loc)
      .filter((e) => !onlyLow || e.qty < e.min)
      .filter((e) => {
        if (!t) return true
        const it = catalog.find((c) => c.id === e.itemId)
        return !!it && (it.name.toLowerCase().includes(t) || it.sku.toLowerCase().includes(t))
      })
      .sort((a, b) => locations.indexOf(a.location) - locations.indexOf(b.location) || Number(b.qty < b.min) - Number(a.qty < a.min) || (item(a.itemId)?.name ?? '').localeCompare(item(b.itemId)?.name ?? '', 'he'))
  }, [stock, catalog, loc, onlyLow, q, locations])

  const tabs = [
    { id: 'all', label: 'הכל', count: low.length },
    ...locations.map((l) => ({ id: l, label: <span className="row" style={{ gap: 6 }}>{isVan(l) ? <Truck size={15} /> : <Warehouse size={15} />}{shortLoc(l)}</span>, count: low.filter((e) => e.location === l).length })),
  ]

  return (
    <div className="col" style={{ gap: 16 }}>
      <PageHead
        title="מלאי"
        sub={`${MAIN_WAREHOUSE} ו-${stats.vans} רכבי שירות · ${low.length ? `${low.length} פריטים מתחת למינימום` : 'אין חוסרים'}`}
        actions={
          <>
            <button className="btn" onClick={() => setAdjust('new')}><PackagePlus size={16} /> פריט למיקום</button>
            <button className="btn primary" onClick={() => setTransfer({ from: MAIN_WAREHOUSE, to: loc !== 'all' && loc !== MAIN_WAREHOUSE ? loc : undefined })}><ArrowLeftRight size={16} /> העברה</button>
          </>
        }
      />

      <div className="stat-row">
        <Stat icon={<Boxes size={20} />} label="פריטים במעקב" value={stats.items} delta={`${stock.length} רשומות ב-${locations.length} מיקומים`} />
        <Stat icon={<AlertTriangle size={20} />} label="מתחת למינימום" value={low.length} tone={low.length ? 'danger' : 'success'} onClick={() => setOnlyLow(true)} />
        <Stat icon={<Coins size={20} />} label="שווי מלאי (עלות)" value={<span style={{ fontSize: 22 }}>{money(stats.value)}</span>} tone="violet" delta={`במחסן: ${money(stats.whValue)}`} />
        <Stat icon={<Truck size={20} />} label="רכבים" value={stats.vans} tone="warning" delta="מלאי שיוצא איתם לשטח" />
      </div>

      {low.length > 0 && (
        <div className="show-mobile">
          <Callout tone="warning">
            <div className="row between wrap" style={{ gap: 8 }}>
              <span><b>{low.length} פריטים</b> מתחת למינימום</span>
              <button className="btn sm" onClick={() => document.getElementById('po-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>להזמנת הרכש</button>
            </div>
          </Callout>
        </div>
      )}

      <div className="grid g-side">
        <Card>
          <Tabs value={loc} onChange={setLoc} items={tabs} />
          <div className="filters" style={{ padding: '12px 14px', borderBottom: '1px solid var(--line-2)' }}>
            <div className="search-box grow" style={{ minWidth: 180 }}>
              <Search size={16} className="muted" />
              <input className="input sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder="שם פריט או מק״ט" aria-label="חיפוש" />
            </div>
            <label className="check small"><input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} /> רק חוסרים</label>
          </div>
          {rows.length === 0 ? (
            <Empty icon={<Boxes size={36} />} title={onlyLow ? 'אין חוסרים כאן' : q ? 'לא נמצא פריט' : 'אין מלאי רשום במיקום הזה'}>
              {!onlyLow && !q && <button className="btn sm mt8" onClick={() => setAdjust('new')}><PackagePlus size={15} /> הוספת פריט</button>}
            </Empty>
          ) : (
            <>
              <div className="table-wrap hide-mobile">
                <table className="table">
                  <thead>
                    <tr><th>פריט</th>{loc === 'all' && <th>מיקום</th>}<th className="end">כמות</th><th className="end">מינימום</th><th>מצב</th><th /></tr>
                  </thead>
                  <tbody>
                    {rows.map((e) => {
                      const it = item(e.itemId)
                      return (
                        <tr key={e.id}>
                          <td>
                            <div className="strong">{it?.name ?? e.itemId}</div>
                            <div className="tiny muted"><span className="ltr">{it?.sku}</span> · {it ? categoryLabel[it.category] : ''}</div>
                          </td>
                          {loc === 'all' && <td className="small nowrap">{shortLoc(e.location)}</td>}
                          <td className={`end num strong nowrap ${e.qty < e.min ? 'txt-danger' : ''}`}><span className="ltr">{fmtNum(e.qty)}</span> <span className="tiny muted">{it?.unit}</span></td>
                          <td className="end num muted">{e.min}</td>
                          <td><StockBadge e={e} /></td>
                          <td className="end nowrap">
                            <button className="icon-btn" title="ספירה ועדכון" aria-label="ספירה ועדכון" onClick={() => setAdjust(e)}><SlidersHorizontal size={16} /></button>
                            <button className="icon-btn" title="העברה" aria-label="העברה" onClick={() => setTransfer({ itemId: e.itemId, from: e.location, to: e.location === MAIN_WAREHOUSE ? undefined : MAIN_WAREHOUSE })}><ArrowLeftRight size={16} /></button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="list show-mobile">
                {rows.map((e) => {
                  const it = item(e.itemId)
                  return (
                    <div key={e.id} className="list-item" style={{ alignItems: 'flex-start' }}>
                      <div className="grow col" style={{ gap: 4 }}>
                        <div className="strong">{it?.name ?? e.itemId}</div>
                        <div className="tiny muted">{shortLoc(e.location)} · מינימום {e.min}</div>
                        <div className="row" style={{ gap: 6 }}>
                          <button className="btn sm" onClick={() => setAdjust(e)}>ספירה</button>
                          <button className="btn sm" onClick={() => setTransfer({ itemId: e.itemId, from: e.location, to: e.location === MAIN_WAREHOUSE ? undefined : MAIN_WAREHOUSE })}>העברה</button>
                        </div>
                      </div>
                      <div className="col" style={{ gap: 4, alignItems: 'flex-end' }}>
                        <span className={`num strong ${e.qty < e.min ? 'txt-danger' : ''}`} style={{ fontSize: 18 }}><span className="ltr">{fmtNum(e.qty)}</span> <span className="tiny muted">{it?.unit}</span></span>
                        <StockBadge e={e} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </Card>

        <aside className="col" style={{ gap: 16 }}>
          <LowStockCard low={low} item={item} onRefill={(t) => setTransfer(t)} />
          <div id="po-card" style={{ scrollMarginTop: 80 }}><PurchaseCard onOpenPo={setPoView} /></div>
          <OpenOrdersCard onOpenPo={setPoView} />
        </aside>
      </div>

      {adjust && <AdjustModal entry={adjust === 'new' ? undefined : adjust} defaultLocation={loc === 'all' ? MAIN_WAREHOUSE : loc} locations={locations} onClose={() => setAdjust(null)} />}
      {transfer && <TransferModal init={transfer} locations={locations} onClose={() => setTransfer(null)} />}
      {poView && <PurchaseOrderView poId={poView} onClose={() => setPoView(null)} />}
    </div>
  )
}

function StockBadge({ e }: { e: StockEntry }) {
  if (e.qty < 0) return <Badge tone="danger">שלילי — לספור</Badge>
  if (e.qty === 0 && e.min > 0) return <Badge tone="danger">אזל</Badge>
  if (e.qty < e.min) return <Badge tone="warning">מתחת למינימום</Badge>
  return <Badge tone="success" dot>תקין</Badge>
}

function LowStockCard({ low, item, onRefill }: { low: StockEntry[]; item: (id: ID) => CatalogItem | undefined; onRefill: (t: Transfer) => void }) {
  const stock = useApp((s) => s.db.stock)
  const vans = low.filter((e) => isVan(e.location))
  const wh = low.filter((e) => !isVan(e.location))
  return (
    <Card title={<div className="row" style={{ gap: 8 }}><AlertTriangle size={16} className={low.length ? 'txt-warning' : 'muted'} /><h2>מלאי נמוך</h2></div>} actions={low.length ? <Badge tone="warning">{low.length}</Badge> : undefined}>
      {!low.length ? (
        <div className="card-body small txt-success strong">כל המיקומים מעל המינימום</div>
      ) : (
        <div className="list">
          {wh.map((e) => (
            <div key={e.id} className="list-item small">
              <span className="grow"><span className="strong" style={{ display: 'block' }}>{item(e.itemId)?.name}</span><span className="tiny muted">{shortLoc(e.location)} · <span className="ltr">{e.qty}</span> מתוך מינימום {e.min}</span></span>
              <Badge tone={e.qty <= 0 ? 'danger' : 'warning'}>חסר {e.min - e.qty}</Badge>
            </div>
          ))}
          {vans.map((e) => {
            const whQty = findStock(stock, e.itemId, MAIN_WAREHOUSE)?.qty ?? 0
            const need = e.min - e.qty
            return (
              <div key={e.id} className="list-item small">
                <span className="grow"><span className="strong" style={{ display: 'block' }}>{item(e.itemId)?.name}</span><span className="tiny muted">{shortLoc(e.location)} · <span className="ltr">{e.qty}</span> מתוך {e.min} · במחסן {whQty}</span></span>
                <button className="btn sm" disabled={whQty <= 0} onClick={() => onRefill({ itemId: e.itemId, from: MAIN_WAREHOUSE, to: e.location, qty: Math.min(need, whQty) })}>השלמה</button>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

// הזמנת רכש מוצעת: מה שבמחסן מתחת למינימום, עד פי 2 מהמינימום, ועוד מה שחסר לרכבים, פחות מה שכבר הוזמן ועוד לא הגיע
function usePurchaseSuggestions() {
  const stock = useApp((s) => s.db.stock)
  const catalog = useApp((s) => s.db.catalog)
  const pos = useApp((s) => s.db.purchaseOrders)
  return useMemo(() => {
    const ids = [...new Set(stock.map((e) => e.itemId))]
    const onOrder = (itemId: ID) => pos.filter(isOpenPo).reduce((s, p) => s + p.lines.filter((l) => l.itemId === itemId).reduce((a, l) => a + l.qty, 0), 0)
    return ids
      .map((itemId) => {
        const wh = findStock(stock, itemId, MAIN_WAREHOUSE)
        const vanShort = stock.filter((e) => e.itemId === itemId && isVan(e.location) && e.qty < e.min).reduce((s, e) => s + (e.min - e.qty), 0)
        const available = wh?.qty ?? 0
        const min = wh?.min ?? 0
        const needed = (wh && wh.qty < wh.min) || vanShort > Math.max(0, available - min)
        const ordered = onOrder(itemId)
        const qty = needed ? Math.max(0, Math.max(1, min * 2 + vanShort - available) - ordered) : 0
        return { itemId, qty, available, min, vanShort, ordered, item: catalog.find((c) => c.id === itemId) }
      })
      .filter((x) => x.qty > 0 && x.item)
      .sort((a, b) => (a.item!.category === 'unit' ? 0 : 1) - (b.item!.category === 'unit' ? 0 : 1) || a.item!.name.localeCompare(b.item!.name, 'he'))
  }, [stock, catalog, pos])
}

const SUP_PREF = 'genair-po-supplier'

function PurchaseCard({ onOpenPo }: { onOpenPo: (id: ID) => void }) {
  const sugg = usePurchaseSuggestions()
  const suppliers = useApp((s) => s.db.suppliers)
  const cats = useApp((s) => s.db.config.supplierCategories)
  const [over, setOver] = useState<Record<ID, number>>({})
  const [skip, setSkip] = useState<ID[]>([])
  const [supplierId, setSupplierState] = useState(() => readPref<string>(SUP_PREF, '', suppliers.map((x) => x.id)))
  const setSupplier = (v: string) => { setSupplierState(v); writePref(SUP_PREF, v) }
  const active = useMemo(() => suppliers.filter((x) => x.active).sort((a, b) => Number(['units', 'materials'].includes(b.category)) - Number(['units', 'materials'].includes(a.category)) || a.name.localeCompare(b.name, 'he')), [suppliers])
  const sup = suppliers.find((x) => x.id === supplierId)
  const lines = sugg.filter((s) => !skip.includes(s.itemId)).map((s) => ({ ...s, qty: over[s.itemId] ?? s.qty })).filter((l) => l.qty > 0)
  const total = lines.reduce((s, l) => s + l.qty * l.item!.cost, 0)

  const create = (send?: 'whatsapp' | 'email') => {
    if (!sup || !lines.length) return
    const po = createPurchaseOrder({
      supplierId: sup.id, toLocation: MAIN_WAREHOUSE, notes: 'השלמת מלאי לפי ההזמנה המוצעת',
      lines: lines.map((l) => ({ itemId: l.itemId, description: l.item!.name, qty: l.qty, unitCost: l.item!.cost, unit: l.item!.unit })),
    })
    if (send === 'whatsapp') window.open(poWhatsapp(po, sup), '_blank', 'noopener')
    if (send === 'email') window.location.href = poMail(po, sup)
    if (send) markPoSent(po.id, send)
    setOver({})
    setSkip([])
    toast.success(send ? `הזמנה ${po.number} נשלחה ל${sup.name}` : `נוצרה טיוטה ${po.number}`)
    if (!send) onOpenPo(po.id)
  }

  return (
    <Card title={<div className="row" style={{ gap: 8 }}><ClipboardList size={16} className="muted" /><h2>הזמנת רכש מוצעת</h2></div>} actions={sugg.length ? <span className="tiny muted">{lines.length} פריטים</span> : undefined}>
      {!sugg.length ? (
        <div className="card-body small muted">אין צורך בהזמנה כרגע. המחסן מכסה את המינימום ואת החוסרים ברכבים (כולל מה שכבר הוזמן).</div>
      ) : (
        <>
          <div className="list">
            {sugg.map((s) => {
              const on = !skip.includes(s.itemId)
              return (
                <div key={s.itemId} className={`list-item small po-line ${on ? '' : 'off'}`}>
                  <input type="checkbox" checked={on} onChange={() => setSkip((l) => (on ? [...l, s.itemId] : l.filter((x) => x !== s.itemId)))} aria-label="לכלול בהזמנה" />
                  <span className="grow">
                    <span className="strong" style={{ display: 'block' }}>{s.item!.name}</span>
                    <span className="tiny muted">במחסן {s.available} · מינימום {s.min}{s.vanShort ? ` · חסר ברכבים ${s.vanShort}` : ''}{s.ordered ? ` · כבר בהזמנה ${s.ordered}` : ''}</span>
                  </span>
                  <input className="input sm num" style={{ width: 64, textAlign: 'center' }} inputMode="numeric" value={over[s.itemId] ?? s.qty} disabled={!on} onChange={(e) => setOver((m) => ({ ...m, [s.itemId]: Math.max(0, Number(e.target.value.replace(/\D/g, '')) || 0) }))} aria-label="כמות להזמנה" />
                </div>
              )
            })}
          </div>
          <div className="card-body col" style={{ gap: 8, borderTop: '1px solid var(--line-2)' }}>
            <Field label="ספק" hint={sup ? <>{sup.phone ? <span className="ltr">{sup.phone}</span> : 'אין טלפון'}{sup.email ? ` · ${sup.email}` : ''} · עלות משוערת {money(total)}</> : <>הספקים מנוהלים ב<Link to="/suppliers">מסך הספקים</Link></>}>
              <select className="select sm" value={supplierId} onChange={(e) => setSupplier(e.target.value)}>
                <option value="">בחירת ספק...</option>
                {active.map((x) => <option key={x.id} value={x.id}>{x.name} · {cats.find((c) => c.key === x.category)?.label ?? ''}</option>)}
              </select>
            </Field>
            <div className="row wrap" style={{ gap: 6 }}>
              <button className="btn sm wa" disabled={!sup || !lines.length} onClick={() => create('whatsapp')}><MessageCircle size={15} /> הזמנה בוואטסאפ</button>
              <button className="btn sm" disabled={!sup || !lines.length || !sup.email} onClick={() => create('email')} title={sup && !sup.email ? 'לספק אין אימייל' : undefined}><Mail size={15} /> במייל</button>
              <button className="btn sm" disabled={!sup || !lines.length} onClick={() => create()}><FilePlus2 size={15} /> טיוטה</button>
            </div>
            <div className="tiny muted">ההזמנה נשמרת עם מספר, ובקבלת הסחורה הכמויות נכנסות למלאי.</div>
          </div>
        </>
      )}
    </Card>
  )
}

// הזמנות שעוד לא הגיעו: קבלה למלאי בלחיצה
function OpenOrdersCard({ onOpenPo }: { onOpenPo: (id: ID) => void }) {
  const pos = useApp((s) => s.db.purchaseOrders)
  const suppliers = useApp((s) => s.db.suppliers)
  const open = useMemo(() => pos.filter((p) => p.status === 'sent' || p.status === 'confirmed' || p.status === 'draft').sort((a, b) => (a.expectedAt ?? '9').localeCompare(b.expectedAt ?? '9')), [pos])
  const [receiving, setReceiving] = useState<ID | null>(null)
  const today = new Date().toISOString().slice(0, 10)
  const rpo = open.find((p) => p.id === receiving)
  return (
    <Card title={<div className="row" style={{ gap: 8 }}><Truck size={16} className="muted" /><h2>הזמנות בדרך</h2></div>} actions={<Link className="btn sm ghost" to="/suppliers?tab=orders">הכל</Link>}>
      {!open.length ? <div className="card-body small muted">אין הזמנות פתוחות</div> : (
        <div className="list">
          {open.slice(0, 6).map((p) => {
            const sup = suppliers.find((x) => x.id === p.supplierId)
            const late = p.expectedAt && p.expectedAt < today
            return (
              <div key={p.id} className="list-item small click" onClick={() => onOpenPo(p.id)}>
                <span className="grow">
                  <span className="strong" style={{ display: 'block' }}><span className="ltr">{p.number}</span> · {sup?.name}</span>
                  <span className={`tiny ${late ? 'txt-danger' : 'muted'}`}>{poStatusLabel[p.status]}{p.expectedAt ? ` · אספקה ${fmtDate(p.expectedAt)}` : ''} · {money(poTotal(p))}</span>
                </span>
                {p.status !== 'draft' && <button className="btn sm" onClick={(e) => { e.stopPropagation(); setReceiving(p.id) }}><PackageCheck size={15} /> קבלה</button>}
              </div>
            )
          })}
        </div>
      )}
      {rpo && <ReceiveDialog po={rpo} sup={suppliers.find((x) => x.id === rpo.supplierId)} onClose={() => setReceiving(null)} />}
    </Card>
  )
}

function AdjustModal({ entry, defaultLocation, locations, onClose }: { entry?: StockEntry; defaultLocation: string; locations: string[]; onClose: () => void }) {
  const catalog = useApp((s) => s.db.catalog)
  const stock = useApp((s) => s.db.stock)
  const [itemId, setItemId] = useState(entry?.itemId ?? '')
  const [location, setLocation] = useState(entry?.location ?? defaultLocation)
  const existing = itemId ? findStock(stock, itemId, location) : undefined
  const [qty, setQty] = useState<number>(entry?.qty ?? 0)
  const [min, setMin] = useState<number>(entry?.min ?? 0)
  const it = catalog.find((c) => c.id === itemId)
  const base = entry ?? existing
  const diff = base ? qty - base.qty : qty
  // פריטים פיזיים בלבד (גז קירור הוא שירות בקטלוג, אבל הוא יושב ברכב)
  const items = catalog.filter((c) => (c.active && c.category !== 'labor' && c.category !== 'service') || c.id === 's-gas')
  const save = () => {
    if (!itemId) return
    setStock(itemId, location, qty, min)
    toast.success(base ? `עודכן: ${it?.name} (${diff >= 0 ? '+' : ''}${diff})` : `נוסף ל${location}: ${it?.name}`)
    onClose()
  }
  return (
    <Modal
      title={entry ? 'ספירה ועדכון' : 'פריט למיקום'}
      size="narrow"
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>ביטול</button><button className="btn primary" disabled={!itemId} onClick={save}>שמירה</button></>}
    >
      <div className="col" style={{ gap: 12 }}>
        {entry ? (
          <div>
            <div className="strong">{it?.name}</div>
            <div className="tiny muted">{entry.location} · כרגע רשום {entry.qty} {it?.unit}</div>
          </div>
        ) : (
          <>
            <Field label="פריט">
              <select className="select" value={itemId} onChange={(e) => { setItemId(e.target.value); const ex = findStock(stock, e.target.value, location); setQty(ex?.qty ?? 0); setMin(ex?.min ?? 0) }}>
                <option value="">בחירה מהקטלוג...</option>
                {items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="מיקום">
              <select className="select" value={location} onChange={(e) => { setLocation(e.target.value); const ex = itemId ? findStock(stock, itemId, e.target.value) : undefined; setQty(ex?.qty ?? 0); setMin(ex?.min ?? 0) }}>
                {locations.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </Field>
            {existing && <div className="tiny muted">הפריט כבר רשום במיקום הזה ({existing.qty}). השמירה תעדכן את הכמות.</div>}
          </>
        )}
        <div className="grid g2" style={{ gap: 10 }}>
          <Field label={entry ? 'כמות בספירה' : 'כמות'} hint={base && diff !== 0 ? <span className={diff < 0 ? 'txt-danger' : 'txt-success'}>{diff > 0 ? '+' : ''}{diff} לעומת הרשום</span> : undefined}>
            <input className="input num" type="number" value={qty} onChange={(e) => setQty(Number(e.target.value) || 0)} autoFocus={!!entry} />
          </Field>
          <Field label="מינימום" hint="מתחת לזה תופיע התראה">
            <input className="input num" type="number" min={0} value={min} onChange={(e) => setMin(Math.max(0, Number(e.target.value) || 0))} />
          </Field>
        </div>
      </div>
    </Modal>
  )
}

function TransferModal({ init, locations, onClose }: { init: Transfer; locations: string[]; onClose: () => void }) {
  const stock = useApp((s) => s.db.stock)
  const catalog = useApp((s) => s.db.catalog)
  const users = useApp((s) => s.db.users)
  const [itemId, setItemId] = useState(init.itemId ?? '')
  const [from, setFrom] = useState(init.from ?? MAIN_WAREHOUSE)
  const [to, setTo] = useState(init.to ?? locations.find((l) => l !== (init.from ?? MAIN_WAREHOUSE)) ?? '')
  const [qty, setQty] = useState(init.qty ?? 1)
  const stocked = useMemo(() => [...new Set(stock.filter((e) => e.qty > 0).map((e) => e.itemId))].map((id) => catalog.find((c) => c.id === id)).filter(Boolean) as CatalogItem[], [stock, catalog])
  const it = catalog.find((c) => c.id === itemId)
  const avail = itemId ? findStock(stock, itemId, from)?.qty ?? 0 : 0
  const dest = itemId ? findStock(stock, itemId, to)?.qty ?? 0 : 0
  const valid = itemId && from && to && from !== to && qty > 0 && qty <= avail
  const save = () => {
    if (!valid) return
    moveStock(itemId, from, -qty)
    moveStock(itemId, to, qty)
    const owner = users.find((u) => vanOf(u) === to)
    if (owner && owner.id !== app().currentUserId) app().notify(owner.id, `הועברו לרכב שלך: ${it?.name} × ${qty}`, '/inventory')
    toast.success(`הועברו ${qty} ${it?.unit ?? ''} ${it?.name ?? ''} ל${to}`)
    onClose()
  }
  return (
    <Modal
      title="העברה בין מיקומים"
      size="narrow"
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>ביטול</button><button className="btn primary" disabled={!valid} onClick={save}><ArrowLeftRight size={16} /> העברה</button></>}
    >
      <div className="col" style={{ gap: 12 }}>
        <Field label="פריט">
          <select className="select" value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="">בחירה...</option>
            {stocked.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)', gap: 8, alignItems: 'end' }}>
          <Field label="מ-">
            <select className="select" value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value === to) setTo(locations.find((l) => l !== e.target.value) ?? '') }}>
              {locations.map((l) => <option key={l} value={l}>{shortLoc(l)}</option>)}
            </select>
          </Field>
          <button type="button" className="icon-btn" style={{ marginBottom: 1 }} onClick={() => { setFrom(to); setTo(from) }} aria-label="החלפת כיוון"><ArrowLeftRight size={17} /></button>
          <Field label="אל">
            <select className="select" value={to} onChange={(e) => setTo(e.target.value)}>
              {locations.filter((l) => l !== from).map((l) => <option key={l} value={l}>{shortLoc(l)}</option>)}
            </select>
          </Field>
        </div>
        <Field label="כמות" hint={itemId ? `זמין ב${shortLoc(from)}: ${avail} ${it?.unit ?? ''}` : undefined}>
          <input className="input num" type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(0, Number(e.target.value) || 0))} />
        </Field>
        {itemId && qty > avail && <div className="tiny txt-danger">אין מספיק ב{shortLoc(from)}. כדאי לעדכן ספירה קודם.</div>}
        {itemId && valid && (
          <div className="side-box small">
            <div className="row between"><span>{shortLoc(from)}</span><span className="num">{avail} ← {avail - qty}</span></div>
            <div className="row between"><span>{shortLoc(to)}</span><span className="num">{dest} ← {dest + qty}</span></div>
          </div>
        )}
      </div>
    </Modal>
  )
}
