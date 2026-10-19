// עורך הצעת מחיר: שורות מהקטלוג, הנחה, תנאים, רווחיות (להנהלה), שליחה ללקוח, גרסאות ואישור
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle, ArrowDown, ArrowRight, ArrowUp, Ban, CalendarClock, Check, Copy, ExternalLink, Eye, FilePlus2, FileSignature, Lock, Mail, MapPin, MessageCircle,
  PenLine, Plus, Printer, RotateCcw, Search, Send, Sparkles, Trash2, TrendingUp,
} from 'lucide-react'
import type { Case, CatalogItem, Contact, Customer, ItemCategory, Quote, QuoteLine } from '../../lib/types'
import { app, useApp, useDB, useMe, useSettings } from '../../lib/store'
import { approveQuote, markQuoteSent, rejectQuote } from '../../lib/actions'
import { defaultTerms, lineTotal, totals } from '../../lib/quote'
import { categoryLabel, quoteStatusLabel, quoteStatusTone } from '../../lib/labels'
import { addDays, date, dateTime, money, nowIso, pct, uid, ymd } from '../../lib/format'
import { fill, sendMessage, templates } from '../../lib/messaging'
import { addressText, mailLink, portalUrl, shareOrCopy } from '../../lib/integrations/links'
import { brand } from '../../brand'
import { Badge, Callout, Card, Confirm, Empty, Field, Modal, SignaturePad, toast } from '../../components/ui'
import { AIQuoteDialog } from '../../features/quotes/AIQuoteDialog'
import { AiInsights, NumInput, PrioritySyncBadge } from '../../features/quotes/parts'
import { MIN_MARGIN, appUrl, canSeeCost, caseContact, depositMethodLabel, greetName, isQuoteExpired, isQuoteLocked } from '../../features/quotes/util'
import '../../features/quotes/quotes.css'
import './editor.css'

type Dialog = null | 'send' | 'approve' | 'reject' | 'catalog' | 'version' | 'ai'

const freeUnits = ['יח׳', 'מ״א', 'מ״ר', 'נק׳', 'שעה', 'פרויקט']
const countText = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`)

export default function QuoteEditor() {
  const { id } = useParams()
  const nav = useNavigate()
  const quotes = useDB((d) => d.quotes)
  const cases = useDB((d) => d.cases)
  const customers = useDB((d) => d.customers)
  const contacts = useDB((d) => d.contacts)
  const catalog = useDB((d) => d.catalog)
  const users = useDB((d) => d.users)
  const settings = useSettings()
  const me = useMe()
  const patch = useApp((s) => s.patch)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [flashId, setFlashId] = useState<string | null>(null)
  // מעבר בין גרסאות: מתחילים מראש העמוד
  useEffect(() => {
    window.scrollTo(0, 0)
    document.scrollingElement?.scrollTo(0, 0)
    document.body.scrollTo(0, 0)
  }, [id])

  const q = quotes.find((x) => x.id === id)
  const k = q ? cases.find((x) => x.id === q.caseId) : undefined
  const customer = k ? customers.find((c) => c.id === k.customerId) : undefined
  const contact = caseContact(k, contacts)
  const versions = useMemo(() => quotes.filter((x) => x.caseId === q?.caseId).sort((a, b) => a.version - b.version || a.createdAt.localeCompare(b.createdAt)), [quotes, q?.caseId])
  const t = useMemo(() => (q ? totals(q, catalog) : undefined), [q, catalog])
  const rooms = useMemo(() => {
    const set = new Set<string>()
    k?.survey.rooms.forEach((r) => set.add(r.name))
    q?.lines.forEach((l) => l.room && set.add(l.room))
    return [...set]
  }, [k?.survey.rooms, q?.lines])

  if (!q || !k || !t) {
    return (
      <Card>
        <Empty title="ההצעה לא נמצאה">
          <Link to="/cases">חזרה לתיקים</Link>
        </Empty>
      </Card>
    )
  }

  const locked = isQuoteLocked(q)
  const expired = isQuoteExpired(q)
  const atCustomer = q.status === 'sent' || q.status === 'viewed'
  const showCost = canSeeCost(me.role)
  const address = customer?.addresses.find((a) => a.id === k.addressId) ?? customer?.addresses[0]
  const creator = users.find((u) => u.id === q.createdBy)
  const deposit = Math.round((t.total * settings.depositPct) / 100)

  const set = (changes: Partial<Quote>) => patch('quotes', q.id, changes)
  const setLines = (lines: QuoteLine[]) => set({ lines })
  const setLine = (lineId: string, changes: Partial<QuoteLine>) => setLines(q.lines.map((l) => (l.id === lineId ? { ...l, ...changes } : l)))
  const move = (i: number, d: -1 | 1) => {
    const next = [...q.lines]
    const j = i + d
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    setLines(next)
  }
  const addLine = (l: QuoteLine) => {
    setLines([...app().db.quotes.find((x) => x.id === q.id)!.lines, l])
    setFlashId(l.id)
  }
  const addItem = (item: CatalogItem, room?: string) =>
    addLine({ id: uid('ln'), itemId: item.id, description: item.name, qty: 1, unit: item.unit, unitPrice: item.price, room: room || undefined })
  const addFree = () => addLine({ id: uid('ln'), description: '', qty: 1, unit: 'יח׳', unitPrice: 0 })

  function newVersion() {
    const s = app()
    const maxV = Math.max(...s.db.quotes.filter((x) => x.caseId === q!.caseId).map((x) => x.version), q!.version)
    const copy: Quote = {
      ...q!,
      id: uid('q'),
      version: maxV + 1,
      status: 'draft',
      lines: q!.lines.map((l) => ({ ...l, id: uid('ln') })),
      signature: undefined,
      deposit: undefined,
      sentAt: undefined,
      viewedAt: undefined,
      decidedAt: undefined,
      validUntil: ymd(addDays(new Date(), s.settings.quoteValidityDays)),
      createdBy: s.currentUserId,
      createdAt: nowIso(),
      sync: { status: 'not_synced' },
    }
    s.upsert('quotes', copy)
    s.log({ kind: 'quote', caseId: q!.caseId, text: `נפתחה גרסה ${copy.version} להצעה ${q!.number}` })
    toast.success(`נפתחה גרסה ${copy.version} כטיוטה`)
    nav(`/quotes/${copy.id}`)
  }

  const events: { label: string; at?: string }[] = [
    { label: 'נוצרה', at: q.createdAt },
    { label: 'נשלחה', at: q.sentAt },
    { label: 'נצפתה', at: q.viewedAt },
    { label: q.status === 'approved' ? 'אושרה' : q.status === 'rejected' ? 'נדחתה' : 'הוחלט', at: q.decidedAt },
  ]

  return (
    <>
      <Link to={`/cases/${k.id}`} className="qe-back"><ArrowRight size={16} /> {k.title}</Link>
      <div className="page-head">
        <div>
          <h1 className="qe-title">
            הצעת מחיר <span className="ltr">{q.number}</span>
            {q.version > 1 && <span className="muted" style={{ fontSize: 18 }}>גרסה {q.version}</span>}
          </h1>
          <div className="qe-sub">
            <Badge tone={expired && !locked ? 'warning' : quoteStatusTone[q.status]} dot>{expired && !locked ? 'פג תוקף' : quoteStatusLabel[q.status]}</Badge>
            <Badge tone="muted">גרסה {q.version}</Badge>
            <PrioritySyncBadge sync={q.sync} />
            <span className="sep">|</span>
            {customer && <Link to={`/customers/${customer.id}`}>{customer.name}</Link>}
            {address && <span className="small muted">{addressText(address)}</span>}
            <span className="small muted">· תיק <Link to={`/cases/${k.id}`}>{k.number}</Link></span>
          </div>
          <div className="qe-events">
            {events.filter((e) => e.at).map((e) => (
              <span key={e.label}><b>{e.label}</b> {dateTime(e.at)}</span>
            ))}
            {creator && <span><b>הכין/ה</b> {creator.name}</span>}
          </div>
        </div>
        <div className="qe-actions">
          {!locked && (
            <button className="btn primary" onClick={() => setDialog('send')} disabled={!q.lines.length}>
              <Send size={16} /> {atCustomer ? 'שליחה חוזרת' : 'שליחה ללקוח'}
            </button>
          )}
          <button className="btn" onClick={() => window.open(appUrl(`/quotes/${q.id}/print`), '_blank', 'noopener')}><Printer size={16} /> תצוגת הדפסה / PDF</button>
          {!locked && q.lines.length > 0 && <button className="btn" onClick={() => setDialog('approve')}><FileSignature size={16} /> סימון כאושרה</button>}
          <button className="btn" onClick={() => setDialog('version')}><FilePlus2 size={16} /> גרסה חדשה</button>
          {!locked && <button className="btn ghost danger" onClick={() => setDialog('reject')}><Ban size={16} /> דחייה</button>}
        </div>
      </div>

      <div className="col mb16" style={{ gap: 10 }}>
        {q.status === 'approved' && (
          <Callout tone="success" icon={<Lock size={18} />}>
            <div className="qe-sig">
              <div className="grow">
                <div className="strong">ההצעה אושרה ונחתמה{q.signature ? ` ע״י ${q.signature.name}` : ''}{q.decidedAt ? ` ב-${dateTime(q.decidedAt)}` : ''}</div>
                <div>
                  {q.deposit
                    ? q.deposit.paidAt
                      ? `מקדמה של ${money(q.deposit.amount)} התקבלה${q.deposit.method ? ` (${depositMethodLabel[q.deposit.method]})` : ''}.`
                      : `מקדמה של ${money(q.deposit.amount)} ממתינה${q.deposit.method ? ` (${depositMethodLabel[q.deposit.method]})` : ''}.`
                    : 'לא נרשמה מקדמה.'}{' '}
                  ההצעה נעולה לעריכה. לשינוי פותחים גרסה חדשה.
                </div>
              </div>
              {q.signature && <img src={q.signature.dataUrl} alt={`חתימה של ${q.signature.name}`} />}
            </div>
          </Callout>
        )}
        {q.status === 'rejected' && (
          <Callout tone="danger" icon={<Lock size={18} />}>
            ההצעה נדחתה{q.decidedAt ? ` ב-${date(q.decidedAt)}` : ''} ונעולה לעריכה. אם הלקוח חוזר, פותחים גרסה חדשה ומעדכנים אותה.
          </Callout>
        )}
        {!locked && atCustomer && (
          <Callout>
            ההצעה כבר אצל הלקוח. כל שינוי כאן מתעדכן מיד בקישור שלו. לשינוי מהותי עדיף לפתוח גרסה חדשה.
          </Callout>
        )}
        {!locked && expired && (
          <Callout tone="warning">
            <div className="row between wrap">
              <span>תוקף ההצעה הסתיים ב-{date(q.validUntil)}. הלקוח לא יוכל לאשר אותה עד שהתוקף יוארך.</span>
              <button className="btn sm" onClick={() => set({ validUntil: ymd(addDays(new Date(), settings.quoteValidityDays)), status: q.status === 'expired' ? 'sent' : q.status })}>
                <CalendarClock size={15} /> הארכה ב-{settings.quoteValidityDays} יום
              </button>
            </div>
          </Callout>
        )}
      </div>

      <div className="qe-grid">
        <div className="qe-main">
          <Card
            title={<h2>שורות ההצעה <span className="muted small" style={{ fontWeight: 400 }}>({q.lines.length})</span></h2>}
            actions={!locked && (
              <>
                <button className="btn sm" onClick={addFree}><PenLine size={15} /> שורה חופשית</button>
                <button className="btn sm primary" onClick={() => setDialog('catalog')}><Plus size={15} /> מהקטלוג</button>
              </>
            )}
          >
            <div className="qe-lines">
              <datalist id="qe-rooms">{rooms.map((r) => <option key={r} value={r} />)}</datalist>
              {q.lines.length === 0 ? (
                <div className="qe-empty">
                  <div className="strong" style={{ color: 'var(--text-2)' }}>אין עדיין שורות</div>
                  <div className="small mt8">מוסיפים פריטים מהקטלוג, שורה חופשית, או בונים טיוטה מהסקר.</div>
                  {!locked && (
                    <div className="row mt12" style={{ justifyContent: 'center' }}>
                      <button className="btn sm primary" onClick={() => setDialog('catalog')}><Plus size={15} /> מהקטלוג</button>
                      <button className="btn sm" onClick={() => setDialog('ai')}><Sparkles size={15} /> טיוטה מהסקר</button>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div className="qe-line head">
                    <span className="a-ord">#</span><span className="a-desc">תיאור וחדר</span><span className="a-qty">כמות</span><span className="a-price">מחיר ליח׳</span><span className="a-total">סה״כ</span><span className="a-del" />
                  </div>
                  {q.lines.map((l, i) => (
                    <LineRow
                      key={l.id}
                      line={l}
                      index={i}
                      count={q.lines.length}
                      item={catalog.find((c) => c.id === l.itemId)}
                      locked={locked}
                      flash={flashId === l.id}
                      onChange={(c) => setLine(l.id, c)}
                      onMove={(d) => move(i, d)}
                      onRemove={() => setLines(q.lines.filter((x) => x.id !== l.id))}
                    />
                  ))}
                </>
              )}
            </div>
            {q.lines.length > 0 && (
              <div className="qe-lines-foot">
                <span className="small muted">{countText(q.lines.reduce((s, l) => s + (catalog.find((c) => c.id === l.itemId)?.category === 'unit' ? l.qty : 0), 0), 'יחידת מיזוג אחת', 'יחידות מיזוג')} · {countText(rooms.length, 'חדר אחד', 'חדרים')}</span>
                <span className="strong num">סה״כ שורות: {money(t.subtotal)}</span>
              </div>
            )}
          </Card>

          <Card title="הערות ותנאים" pad>
            <div className="col" style={{ gap: 14 }}>
              <Field label="הערות ללקוח" hint="מופיעות בהצעה ובאזור האישי">
                {locked ? <div className="small">{q.notes || <span className="muted">אין</span>}</div> : (
                  <textarea className="textarea" rows={3} value={q.notes ?? ''} placeholder="למשל: היחידות החיצוניות יותקנו במרפסת השירות" onChange={(e) => set({ notes: e.target.value })} />
                )}
              </Field>
              <div className="field">
                <div className="row between">
                  <span className="label">תנאי ההצעה</span>
                  {!locked && q.terms !== defaultTerms && (
                    <button className="btn sm ghost" onClick={() => set({ terms: defaultTerms })}><RotateCcw size={14} /> לתנאים הרגילים</button>
                  )}
                </div>
                {locked ? (
                  <ol className="small" style={{ margin: 0, paddingInlineStart: 20, color: 'var(--text-2)' }}>
                    {q.terms.split('\n').filter(Boolean).map((x, i) => <li key={i}>{x}</li>)}
                  </ol>
                ) : (
                  <textarea className="textarea" rows={6} value={q.terms} onChange={(e) => set({ terms: e.target.value })} />
                )}
                {!locked && <span className="hint">כל שורה היא סעיף נפרד בהצעה.</span>}
              </div>
            </div>
          </Card>
        </div>

        <aside className="qe-side">
          <Card title="סיכום" pad className="qe-totals">
            <div className="qe-fields mb12">
              <Field label="הנחה">
                {locked ? <span className="num">{pct(q.discountPct)}</span> : <NumInput label="הנחה באחוזים" value={q.discountPct} suffix="%" onChange={(n) => set({ discountPct: Math.min(100, n) })} />}
              </Field>
              <Field label="מע״מ">
                {locked ? <span className="num">{pct(q.vatPct)}</span> : <NumInput label="מע״מ באחוזים" value={q.vatPct} suffix="%" onChange={(n) => set({ vatPct: Math.min(100, n) })} />}
              </Field>
              <Field label="בתוקף עד" className="full">
                {locked ? <span>{date(q.validUntil)}</span> : <input type="date" className="input sm" value={q.validUntil} onChange={(e) => e.target.value && set({ validUntil: e.target.value })} />}
              </Field>
            </div>
            <div className="money-line"><span className="muted">סה״כ שורות</span><span className="num">{money(t.subtotal)}</span></div>
            {t.discount > 0 && <div className="money-line"><span className="muted">הנחה {pct(q.discountPct)}</span><span className="num" style={{ color: 'var(--danger)' }}>−{money(t.discount)}</span></div>}
            <div className="money-line"><span className="muted">לפני מע״מ</span><span className="num">{money(t.net)}</span></div>
            <div className="money-line"><span className="muted">מע״מ {pct(q.vatPct)}</span><span className="num">{money(t.vat)}</span></div>
            <div className="money-line total"><span>סה״כ לתשלום</span><span className="num">{money(t.total)}</span></div>
            <div className="tiny muted mt8">
              {q.deposit ? `מקדמה ${q.deposit.paidAt ? 'ששולמה' : 'שממתינה'}: ${money(q.deposit.amount)}` : `מקדמה באישור (${settings.depositPct}%): ${money(deposit)}`}
            </div>

            {showCost && (
              <div className="qe-profit">
                <div className="hd"><TrendingUp size={14} /> רווחיות · רק להנהלה ולמשרד</div>
                <div className="money-line"><span className="muted">עלות משוערת</span><span className="num">{money(t.cost)}</span></div>
                <div className="money-line"><span className="muted">רווח</span><span className="num strong" style={{ color: t.profit < 0 ? 'var(--danger)' : undefined }}>{money(t.profit)}</span></div>
                <div className="money-line"><span className="muted">מרווח</span><span className="num strong" style={{ color: t.marginPct < MIN_MARGIN ? 'var(--danger)' : 'var(--success)' }}>{pct(t.marginPct)}</span></div>
                <div className={`qe-margin ${t.marginPct < MIN_MARGIN ? 'low' : ''}`} title={`הקו מסמן ${MIN_MARGIN}%, המרווח המינימלי`}>
                  <div style={{ width: `${Math.max(0, Math.min(100, t.marginPct))}%` }} />
                </div>
                {q.lines.length > 0 && t.marginPct < MIN_MARGIN && (
                  <div className="row mt8 small" style={{ color: 'var(--danger)', alignItems: 'flex-start', gap: 6 }}>
                    <AlertTriangle size={15} style={{ flex: 'none', marginTop: 2 }} />
                    <span>המרווח נמוך מ-{MIN_MARGIN}%. כדאי לבדוק את ההנחה ואת המחירים שהשתנו מהמחירון.</span>
                  </div>
                )}
                {q.lines.some((l) => !l.itemId) && <div className="tiny muted mt8">בשורות חופשיות העלות מוערכת ב-60% מהמחיר.</div>}
              </div>
            )}
          </Card>

          {q.ai && (
            <Card title={<h2 className="row" style={{ gap: 7 }}><Sparkles size={16} color="var(--brand)" /> טיוטה מהסקר</h2>} pad>
              <AiInsights meta={q.ai} />
              <div className="tiny muted mt12">נבנתה ב-{dateTime(q.ai.createdAt)}. השורות נבדקו ונערכו כאן.</div>
            </Card>
          )}

          <Card title="גרסאות בתיק" className="qe-versions">
            <div className="list">
              {versions.map((v) => {
                const vt = totals(v, catalog)
                return (
                  <Link key={v.id} to={`/quotes/${v.id}`} className={`list-item ${v.id === q.id ? 'cur' : ''}`}>
                    <div className="grow">
                      <div className="strong small"><span className="ltr">{v.number}</span> · גרסה {v.version}</div>
                      <div className="tiny muted">{date(v.createdAt)} · {money(vt.total)}</div>
                    </div>
                    <Badge tone={quoteStatusTone[v.status]}>{quoteStatusLabel[v.status]}</Badge>
                  </Link>
                )
              })}
            </div>
            <div className="card-body" style={{ borderTop: '1px solid var(--line-2)' }}>
              <button className="btn sm block" onClick={() => setDialog('ai')}><Sparkles size={15} /> הצעה חדשה מהסקר (AI)</button>
            </div>
          </Card>
        </aside>
      </div>

      {dialog === 'catalog' && <CatalogPicker catalog={catalog} rooms={rooms} onAdd={addItem} onClose={() => setDialog(null)} />}
      {dialog === 'send' && customer && <SendDialog q={q} k={k} customer={customer} contact={contact} onClose={() => setDialog(null)} />}
      {dialog === 'approve' && <ApproveDialog q={q} total={t.total} defaultName={contact?.name ?? customer?.name ?? ''} onClose={() => setDialog(null)} />}
      {dialog === 'reject' && <RejectDialog q={q} onClose={() => setDialog(null)} />}
      {dialog === 'version' && (
        <Confirm
          title="גרסה חדשה"
          text={`תיפתח גרסה ${Math.max(...versions.map((v) => v.version)) + 1} כטיוטה, עם אותן שורות, הנחה ותנאים. הגרסה הנוכחית נשארת כמו שהיא.`}
          confirmLabel="פתיחת גרסה"
          onConfirm={newVersion}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'ai' && <AIQuoteDialog caseId={k.id} onClose={() => setDialog(null)} onCreated={(qid) => nav(`/quotes/${qid}`)} />}
    </>
  )
}

function LineRow({
  line: l, index, count, item, locked, flash, onChange, onMove, onRemove,
}: {
  line: QuoteLine
  index: number
  count: number
  item?: CatalogItem
  locked: boolean
  flash: boolean
  onChange: (c: Partial<QuoteLine>) => void
  onMove: (d: -1 | 1) => void
  onRemove: () => void
}) {
  if (locked) {
    return (
      <div className="qe-line">
        <span className="a-ord qe-ord" style={{ paddingTop: 7 }}>{index + 1}</span>
        <div className="a-desc">
          <div className="qe-ro-desc">{l.description}</div>
          {(item || l.aiReason || l.room) && (
            <div className="qe-meta">
              {l.room && <span className="qe-room ro"><MapPin size={12} /> {l.room}</span>}
              {item && <span className="ltr">{item.sku}</span>}
              {l.aiReason && <span className="ai"><Sparkles size={12} /> {l.aiReason}</span>}
            </div>
          )}
        </div>
        <span className="a-qty qe-ro">{l.qty} {l.unit}</span>
        <span className="a-price qe-ro">{money(l.unitPrice)}</span>
        <span className="a-total">{money(lineTotal(l))}</span>
        <span className="a-del" />
      </div>
    )
  }
  return (
    <div className={`qe-line ${flash ? 'flash' : ''}`}>
      <div className="a-ord qe-ord">
        <button onClick={() => onMove(-1)} disabled={index === 0} aria-label="הזזה למעלה" title="הזזה למעלה"><ArrowUp size={14} /></button>
        <span>{index + 1}</span>
        <button onClick={() => onMove(1)} disabled={index === count - 1} aria-label="הזזה למטה" title="הזזה למטה"><ArrowDown size={14} /></button>
      </div>
      <div className="a-desc">
        <textarea
          className="input sm qe-desc-input"
          rows={1}
          value={l.description}
          placeholder="תיאור השורה"
          aria-label="תיאור"
          autoFocus={flash && !l.itemId}
          onChange={(e) => onChange({ description: e.target.value })}
        />
        <div className="qe-meta">
          <label className="qe-room" title="חדר">
            <MapPin size={12} />
            <input list="qe-rooms" placeholder="חדר" aria-label="חדר" value={l.room ?? ''} onChange={(e) => onChange({ room: e.target.value || undefined })} />
          </label>
          {item ? <span className="ltr">{item.sku}</span> : (
            <span className="row" style={{ gap: 4 }}>
              שורה חופשית ·
              <select value={l.unit} aria-label="יחידת מידה" onChange={(e) => onChange({ unit: e.target.value })}>
                {freeUnits.map((u) => <option key={u}>{u}</option>)}
              </select>
            </span>
          )}
          {item && l.unitPrice !== item.price && (
            <span className="diff" title="המחיר שונה מהמחירון">
              מחירון {money(item.price)}{' '}
              <button className="btn ghost" style={{ height: 18, padding: '0 4px', fontSize: 11.5 }} onClick={() => onChange({ unitPrice: item.price })}>שחזור</button>
            </span>
          )}
          {l.aiReason && <span className="ai"><Sparkles size={12} /> {l.aiReason}</span>}
        </div>
      </div>
      <div className="a-qty"><NumInput label="כמות" value={l.qty} suffix={l.unit} onChange={(qty) => onChange({ qty })} /></div>
      <div className="a-price"><NumInput label="מחיר ליחידה" value={l.unitPrice} suffix="₪" onChange={(unitPrice) => onChange({ unitPrice })} /></div>
      <span className="a-total">{money(lineTotal(l))}</span>
      <button className="a-del icon-btn qe-del" onClick={onRemove} aria-label="מחיקת שורה" title="מחיקת שורה"><Trash2 size={16} /></button>
    </div>
  )
}

// ---------- בוחר מהקטלוג ----------
function CatalogPicker({ catalog, rooms, onAdd, onClose }: { catalog: CatalogItem[]; rooms: string[]; onAdd: (item: CatalogItem, room?: string) => void; onClose: () => void }) {
  const [term, setTerm] = useState('')
  const [cat, setCat] = useState<ItemCategory | 'all'>('all')
  const [room, setRoom] = useState('')
  const [added, setAdded] = useState<Record<string, number>>({})
  const cats = useMemo(() => [...new Set(catalog.filter((i) => i.active).map((i) => i.category))], [catalog])
  const list = useMemo(() => {
    const s = term.trim().toLowerCase()
    return catalog
      .filter((i) => i.active && (cat === 'all' || i.category === cat))
      .filter((i) => !s || i.name.toLowerCase().includes(s) || i.sku.toLowerCase().includes(s) || categoryLabel[i.category].includes(s))
  }, [catalog, term, cat])
  const total = Object.values(added).reduce((a, b) => a + b, 0)

  return (
    <Modal
      title="הוספה מהקטלוג"
      onClose={onClose}
      footer={
        <>
          <span className="grow small muted">{total ? `נוספו ${total} שורות` : 'לחיצה על פריט מוסיפה אותו להצעה'}</span>
          <button className="btn primary" onClick={onClose}>סיום</button>
        </>
      }
    >
      <div className="qe-pick-tools">
        <div className="qe-pick-search">
          <Search size={17} />
          <input className="input" autoFocus placeholder="חיפוש לפי שם, מק״ט או קטגוריה" value={term} onChange={(e) => setTerm(e.target.value)} />
        </div>
        <div className="row between wrap" style={{ gap: 8 }}>
          <div className="qe-chips">
            <button className={`chip ${cat === 'all' ? 'on' : ''}`} onClick={() => setCat('all')}>הכל</button>
            {cats.map((c) => (
              <button key={c} className={`chip ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>{categoryLabel[c]}</button>
            ))}
          </div>
          {rooms.length > 0 && (
            <select className="select sm" style={{ width: 'auto' }} value={room} onChange={(e) => setRoom(e.target.value)} aria-label="חדר לשורות שנוספות">
              <option value="">בלי חדר</option>
              {rooms.map((r) => <option key={r} value={r}>לחדר: {r}</option>)}
            </select>
          )}
        </div>
      </div>
      {list.length === 0 ? (
        <Empty title="לא נמצאו פריטים">נסו מילה אחרת או מק״ט. אפשר גם להוסיף שורה חופשית.</Empty>
      ) : (
        <div className="qe-pick-list">
          {list.map((i) => (
            <div key={i.id} className="qe-pick">
              <div className="grow">
                <div className="nm">{i.name}</div>
                <div className="meta">
                  <span className="ltr">{i.sku}</span>
                  <span>{categoryLabel[i.category]}</span>
                  {i.warrantyMonths && <span>אחריות {i.warrantyMonths / 12 >= 1 ? `${i.warrantyMonths / 12} שנים` : `${i.warrantyMonths} חודשים`}</span>}
                </div>
              </div>
              <div className="pr">
                <b>{money(i.price)}</b>
                <small>ל{i.unit}</small>
              </div>
              <button
                className={`btn sm ${added[i.id] ? '' : 'primary'}`}
                onClick={() => {
                  onAdd(i, i.category === 'unit' || i.category === 'heating' || i.category === 'accessory' ? room : undefined)
                  setAdded((a) => ({ ...a, [i.id]: (a[i.id] ?? 0) + 1 }))
                }}
              >
                {added[i.id] ? <><Check size={14} className="added" /> נוסף{added[i.id] > 1 ? ` ×${added[i.id]}` : ''}</> : <><Plus size={14} /> הוספה</>}
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

// ---------- שליחה ללקוח ----------
function SendDialog({ q, k, customer, contact, onClose }: { q: Quote; k: Case; customer: Customer; contact?: Contact; onClose: () => void }) {
  const me = useMe()
  const link = portalUrl(k.portal.token)
  const [channel, setChannel] = useState<'whatsapp' | 'email'>('whatsapp')
  const [to, setTo] = useState(contact?.phone ?? customer.phone)
  const [email, setEmail] = useState(contact?.email ?? customer.email ?? '')
  const [body, setBody] = useState(() => fill(templates.quote.text, { name: greetName(contact, customer), portal: link }))
  const questions = q.status === 'draft' ? q.ai?.questions.length ?? 0 : 0

  async function send() {
    if (channel === 'whatsapp') {
      if (to.replace(/\D/g, '').length < 9) return toast.error('מספר הטלפון לא נראה תקין')
      await sendMessage({ to, body, caseId: k.id, customerId: customer.id, templateKey: 'quote' })
    } else {
      if (!/^\S+@\S+\.\S+$/.test(email)) return toast.error('כתובת המייל לא נראית תקינה')
      const signature = `\n\n${me.name}\n${brand.name} · ${brand.phone}\n${brand.website}`
      window.location.href = mailLink(email, `הצעת מחיר ${q.number} · ${brand.name}`, body + signature)
      await sendMessage({ to: email, body, channel: 'email', caseId: k.id, customerId: customer.id, templateKey: 'quote' })
    }
    markQuoteSent(q.id)
    toast.success(channel === 'whatsapp' ? 'וואטסאפ נפתח עם ההודעה. ההצעה סומנה כנשלחה' : 'המייל נפתח. ההצעה סומנה כנשלחה')
    onClose()
  }

  return (
    <Modal
      title={`שליחת ${q.number} ללקוח`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>ביטול</button>
          {channel === 'whatsapp' ? (
            <button className="btn wa" onClick={send}><MessageCircle size={16} /> פתיחה בוואטסאפ</button>
          ) : (
            <button className="btn primary" onClick={send}><Mail size={16} /> פתיחה במייל</button>
          )}
        </>
      }
    >
      <div className="col" style={{ gap: 14 }}>
        {!k.portal.enabled && (
          <Callout tone="warning">
            <div className="row between wrap">
              <span>האזור האישי של התיק כבוי, ולכן הלקוח לא יוכל לפתוח את הקישור.</span>
              <button className="btn sm" onClick={() => app().patch('cases', k.id, { portal: { ...k.portal, enabled: true } })}>הפעלה</button>
            </div>
          </Callout>
        )}
        {questions > 0 && <Callout tone="warning">בטיוטה יש {questions} שאלות פתוחות מהסקר. כדאי לוודא שנסגרו לפני השליחה.</Callout>}
        <div className="qe-chips">
          <button className={`chip ${channel === 'whatsapp' ? 'on' : ''}`} onClick={() => setChannel('whatsapp')}><MessageCircle size={14} /> וואטסאפ</button>
          <button className={`chip ${channel === 'email' ? 'on' : ''}`} onClick={() => setChannel('email')}><Mail size={14} /> מייל</button>
        </div>
        {channel === 'whatsapp' ? (
          <Field label="טלפון" hint={contact ? `איש קשר: ${contact.name}` : undefined}>
            <input className="input" inputMode="tel" dir="ltr" style={{ textAlign: 'right' }} value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        ) : (
          <Field label="מייל">
            <input className="input" type="email" dir="ltr" style={{ textAlign: 'right' }} value={email} placeholder="name@example.com" onChange={(e) => setEmail(e.target.value)} />
          </Field>
        )}
        <Field label="ההודעה">
          <textarea className="textarea" rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <div className="row wrap" style={{ gap: 8 }}>
          <span className="small muted grow">הקישור פותח ללקוח את האזור האישי: ההצעה, שאלות, חתימה ומקדמה.</span>
          <button className="btn sm" onClick={async () => {
            const r = await shareOrCopy({ title: `הצעת מחיר ${q.number}`, text: 'קישור לאזור האישי', url: link })
            if (r === 'copied') toast.success('הקישור הועתק')
          }}><Copy size={14} /> העתקת קישור</button>
          <a className="btn sm" href={link} target="_blank" rel="noreferrer"><Eye size={14} /> מה הלקוח רואה <ExternalLink size={12} /></a>
        </div>
      </div>
    </Modal>
  )
}

// ---------- אישור במשרד ----------
function ApproveDialog({ q, total, defaultName, onClose }: { q: Quote; total: number; defaultName: string; onClose: () => void }) {
  const settings = useSettings()
  const [name, setName] = useState(defaultName)
  const [sig, setSig] = useState<string | null>(null)
  const [dep, setDep] = useState<'paid' | 'later' | 'none'>('paid')
  const [amount, setAmount] = useState(Math.round((total * settings.depositPct) / 100))
  const [method, setMethod] = useState<NonNullable<NonNullable<Quote['deposit']>['method']>>('credit')
  const ok = name.trim().length >= 2 && !!sig

  function approve() {
    if (!ok || !sig) return
    approveQuote(q.id, { name: name.trim(), dataUrl: sig, at: nowIso() }, dep === 'none' ? undefined : { amount, method, paidAt: dep === 'paid' ? nowIso() : undefined })
    toast.success(`ההצעה ${q.number} אושרה. המשרד קיבל התראה לתיאום התקנה`)
    onClose()
  }

  return (
    <Modal
      title="סימון כאושרה · חתימה במשרד"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>ביטול</button>
          <button className="btn success" disabled={!ok} onClick={approve}><Check size={16} /> אישור ההצעה</button>
        </>
      }
    >
      <div className="col" style={{ gap: 14 }}>
        <p className="small muted">כשהלקוח חותם במשרד או מול הסוכן. אחרי האישור ההצעה ננעלת, התיק עובר לשלב "אושר" ונשלחת הזמנה ל-Priority.</p>
        <Field label="שם החותם">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="field">
          <span className="label">חתימת הלקוח</span>
          <SignaturePad onChange={setSig} />
        </div>
        <div className="field">
          <span className="label">מקדמה</span>
          <div className="qe-chips">
            <button className={`chip ${dep === 'paid' ? 'on' : ''}`} onClick={() => setDep('paid')}>התקבלה עכשיו</button>
            <button className={`chip ${dep === 'later' ? 'on' : ''}`} onClick={() => setDep('later')}>תשולם בהמשך</button>
            <button className={`chip ${dep === 'none' ? 'on' : ''}`} onClick={() => setDep('none')}>בלי מקדמה</button>
          </div>
        </div>
        {dep !== 'none' && (
          <div className="grid g2" style={{ gap: 10 }}>
            <Field label="סכום" hint={`${settings.depositPct}% מ-${money(total)}`}>
              <NumInput label="סכום המקדמה" value={amount} suffix="₪" onChange={setAmount} />
            </Field>
            <Field label="אמצעי תשלום">
              <select className="select sm" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                {Object.entries(depositMethodLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
          </div>
        )}
      </div>
    </Modal>
  )
}

// ---------- דחייה ----------
const rejectReasons = ['המחיר גבוה מדי', 'בחר בהצעה של מתחרה', 'הפרויקט נדחה', 'אין מענה מהלקוח']

function RejectDialog({ q, onClose }: { q: Quote; onClose: () => void }) {
  const [reason, setReason] = useState('')
  return (
    <Modal
      title={`דחיית ${q.number}`}
      size="narrow"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>ביטול</button>
          <button className="btn danger" onClick={() => { rejectQuote(q.id, reason.trim() || undefined); toast.info('ההצעה סומנה כנדחתה'); onClose() }}><Ban size={16} /> סימון כנדחתה</button>
        </>
      }
    >
      <div className="col" style={{ gap: 12 }}>
        <div className="qe-chips">
          {rejectReasons.map((r) => (
            <button key={r} className={`chip ${reason === r ? 'on' : ''}`} onClick={() => setReason(r)}>{r}</button>
          ))}
        </div>
        <Field label="סיבה" hint="עוזר להבין למה עסקאות לא נסגרות">
          <textarea className="textarea" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="אפשר לכתוב בחופשיות" />
        </Field>
      </div>
    </Modal>
  )
}
