// האזור האישי של הלקוח: איפה הפרויקט עומד, ההצעה עם חתימה ומקדמה, מועדים, מסמכים, אחריות וקריאת שירות
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import {
  CalendarDays, CalendarPlus, Check, CheckCircle2, ClipboardCheck, Clock, CreditCard, FileSignature, FileText, Landmark, Mail, MapPin, MessageCircle, Phone,
  Printer, ShieldCheck, Smartphone, Snowflake, Sparkles, Wrench, Hammer, Ruler, Search, Hourglass, XCircle,
} from 'lucide-react'
import { brand } from '../../brand'
import { app, useDB, useSettings } from '../../lib/store'
import { approveQuote, markQuoteViewed, rejectQuote } from '../../lib/actions'
import { lineTotal, totals } from '../../lib/quote'
import { appointmentTypeLabel } from '../../lib/labels'
import { date, dateLong, dateTime, daysBetween, money, nowIso, pct, sameDay, time, uid, ymd } from '../../lib/format'
import { addressText, googleCalendarLink, telLink, whatsappLink } from '../../lib/integrations/links'
import type { Appointment, Case, Customer, InstalledUnit, Quote, ServiceCall, User } from '../../lib/types'
import { Wordmark } from '../../components/Layout'
import { Callout, Field, Modal, SignaturePad, toast } from '../../components/ui'
import { appUrl, caseContact, customerQuote, firstName, viaMethod, greetName, groupByRoom, isQuoteExpired } from '../../features/quotes/util'
import './portal.css'

// כל כניסה נרשמת פעם אחת לכל ביקור בדף
const seen = new Set<string>()

type Method = 'credit' | 'bit' | 'transfer'

const steps = [
  { key: 'lead', label: 'פנייה', icon: <Search size={14} /> },
  { key: 'survey', label: 'סקר', icon: <Ruler size={14} /> },
  { key: 'quote', label: 'הצעה', icon: <FileText size={14} /> },
  { key: 'approved', label: 'אישור', icon: <FileSignature size={14} /> },
  { key: 'scheduled', label: 'תיאום', icon: <CalendarDays size={14} /> },
  { key: 'installed', label: 'התקנה', icon: <Hammer size={14} /> },
]

const stageIdx: Record<Case['stage'], number> = { lead: 0, survey: 1, quote: 2, approved: 3, scheduled: 4, installing: 5, completed: 6, closed: 6, lost: -1 }

const symptoms: { id: NonNullable<ServiceCall['symptom']>; label: string }[] = [
  { id: 'not_cooling', label: 'לא מקרר / לא מחמם' },
  { id: 'leak', label: 'נזילת מים' },
  { id: 'noise', label: 'רעש חריג' },
  { id: 'error_code', label: 'קוד שגיאה' },
  { id: 'no_power', label: 'לא נדלק' },
  { id: 'remote', label: 'שלט' },
  { id: 'smell', label: 'ריח' },
  { id: 'other', label: 'משהו אחר' },
]

// כך הלקוח קורא לסוגי הביקורים
const visitLabel: Record<Appointment['type'], string> = { ...appointmentTypeLabel, service: 'ביקור טכנאי' }

const joinNames = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} ו${names[names.length - 1]}`)

function openWhatsApp(text: string) {
  window.open(whatsappLink(brand.whatsapp, text), '_blank', 'noopener')
}

export default function Portal() {
  const { token } = useParams()
  const cases = useDB((d) => d.cases)
  const customers = useDB((d) => d.customers)
  const contacts = useDB((d) => d.contacts)
  const quotes = useDB((d) => d.quotes)
  const appointments = useDB((d) => d.appointments)
  const users = useDB((d) => d.users)
  const docs = useDB((d) => d.docs)
  const units = useDB((d) => d.units)
  const catalog = useDB((d) => d.catalog)

  const k = cases.find((c) => c.portal.token === token)
  const ok = !!k && k.portal.enabled
  const customer = k ? customers.find((c) => c.id === k.customerId) : undefined
  const contact = caseContact(k, contacts)
  const quote = useMemo(() => (k ? customerQuote(quotes, k.id) : undefined), [quotes, k])

  useEffect(() => {
    const prev = document.title
    document.title = `האזור האישי · ${brand.name}`
    return () => {
      document.title = prev
    }
  }, [])

  // רישום כניסה ועדכון "נצפה לאחרונה"
  useEffect(() => {
    if (!k || !k.portal.enabled || seen.has(k.portal.token)) return
    seen.add(k.portal.token)
    const s = app()
    s.patch('cases', k.id, { portal: { ...k.portal, lastViewedAt: nowIso() } })
    s.log({ kind: 'portal', caseId: k.id, customerId: k.customerId, text: 'הלקוח נכנס לאזור האישי' })
  }, [k])

  // צפייה ראשונה בהצעה
  useEffect(() => {
    if (ok && quote?.status === 'sent') markQuoteViewed(quote.id)
  }, [ok, quote?.id, quote?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  const upcoming = useMemo(() => {
    if (!k) return []
    const today = ymd()
    return appointments
      .filter((a) => (a.caseId === k.id || (!a.caseId && a.customerId === k.customerId)) && a.status !== 'cancelled' && a.status !== 'done' && ymd(a.end) >= today)
      .sort((a, b) => a.start.localeCompare(b.start))
  }, [appointments, k])

  const myDocs = useMemo(
    () => (k ? docs.filter((d) => d.caseId === k.id && (d.folder === 'customer' || (d.folder === 'installer' && /מסירה|אחריות|הוראות/.test(d.name)))) : []),
    [docs, k],
  )
  const myUnits = useMemo(() => (k ? units.filter((u) => u.customerId === k.customerId && (u.caseId === k.id || u.addressId === k.addressId)) : []), [units, k])

  if (!k || !ok || !customer) return <NotFound />

  const address = customer.addresses.find((a) => a.id === k.addressId) ?? customer.addresses[0]
  const hello = greetName(contact, customer)
  const agent = users.find((u) => u.id === k.agentId)
  const idx = stageIdx[k.stage]
  const quoteFirst = !!quote && (quote.status === 'sent' || quote.status === 'viewed')
  const showService = myUnits.length > 0 || ['completed', 'closed'].includes(k.stage)

  const quoteCard = <QuoteSection key="q" k={k} quote={quote} customer={customer} defaultName={contact?.name ?? customer.name} catalog={catalog} />
  const apptCard = (upcoming.length > 0 || (k.installWindow && ['approved', 'scheduled', 'installing'].includes(k.stage))) && (
    <Appointments key="a" list={upcoming} users={users} k={k} addressLabel={addressText(address)} />
  )

  return (
    <div className="pt-page" dir="rtl">
      <header className="pt-hero">
        <div className="pt-hero-in">
          <div className="pt-top">
            <Wordmark />
            <a className="pt-call" href={telLink(brand.phone)}><Phone size={15} /> <span className="ltr">{brand.phone}</span></a>
          </div>
          <div className="pt-eyebrow">האזור האישי</div>
          <h1>שלום{hello ? ` ${hello}` : ''},</h1>
          <div className="proj">{k.title}</div>
          <div className="meta">
            {addressText(address)} · תיק <span className="ltr">{k.number}</span>
          </div>
          <div className="pt-promise"><Snowflake size={15} /> {brand.promise}</div>
        </div>
      </header>

      <main className="pt-wrap">
        <section className="pt-card">
          <div className="pt-card-head">
            <h2><Sparkles size={18} /> איפה הפרויקט עומד</h2>
          </div>
          {idx >= 0 ? (
            <div className="pt-track" role="list" aria-label="שלבי הפרויקט">
              {steps.map((s, i) => {
                const state = i < idx || idx === 6 ? 'done' : i === idx || (idx === 5 && i === 5) ? 'now' : ''
                return (
                  <div key={s.key} role="listitem" className={`pt-step ${state}`} aria-current={state === 'now' ? 'step' : undefined}>
                    <span className="dot">{state === 'done' ? <Check size={15} strokeWidth={3} /> : s.icon}</span>
                    <span className="lbl">{i === 5 && k.stage === 'installing' ? 'בהתקנה' : s.label}</span>
                  </div>
                )
              })}
            </div>
          ) : null}
          <div className="pt-next">
            <Clock size={18} />
            <div>{nextStep(k, quote, upcoming)}</div>
          </div>
        </section>

        {quoteFirst ? [quoteCard, apptCard] : [apptCard, quoteCard]}

        {myUnits.length > 0 && <UnitsSection list={myUnits} />}
        {(myDocs.length > 0 || quote?.status === 'approved') && (
          <section className="pt-card">
            <div className="pt-card-head"><h2><FileText size={18} /> המסמכים שלכם</h2></div>
            <div className="pt-list">
              {quote?.status === 'approved' && (
                <a className="pt-item" href={appUrl(`/quotes/${quote.id}/print`)} target="_blank" rel="noreferrer">
                  <span className="ic"><FileSignature size={19} /></span>
                  <div className="grow">
                    <div className="nm">הצעת מחיר חתומה <span className="ltr">{quote.number}</span></div>
                    <div className="mt">נחתמה {quote.signature ? date(quote.signature.at) : ''} · לצפייה ולהורדה</div>
                  </div>
                  <Printer size={17} className="muted" />
                </a>
              )}
              {myDocs.map((d) => {
                const href = d.url ?? d.dataUrl
                const body = (
                  <>
                    <span className="ic"><FileText size={19} /></span>
                    <div className="grow">
                      <div className="nm">{d.name.replace(/\.pdf$/i, '')}</div>
                      <div className="mt">{date(d.uploadedAt)}{d.size ? ` · ${Math.max(1, Math.round(d.size / 1024 / 102.4) / 10)} MB` : ''}{href ? '' : ' · נשלח לפי בקשה'}</div>
                    </div>
                  </>
                )
                return href ? (
                  <a key={d.id} className="pt-item" href={href} target="_blank" rel="noreferrer" download={d.dataUrl ? d.name : undefined}>{body}</a>
                ) : (
                  <button key={d.id} className="pt-item" style={{ border: 0, borderBottom: '1px solid var(--line-2)', background: 'none', width: '100%', textAlign: 'start', cursor: 'pointer' }}
                    onClick={() => openWhatsApp(`שלום, אשמח לקבל את המסמך "${d.name}" (תיק ${k.number}). תודה!`)}>
                    {body}
                    <span className="small" style={{ color: 'var(--brand-700)', fontWeight: 600 }}>בקשת עותק</span>
                  </button>
                )
              })}
            </div>
          </section>
        )}

        {showService && <ServiceSection k={k} customer={customer} units={myUnits} />}

        <section className="pt-card">
          <div className="pt-card-head">
            <div>
              <h2><MessageCircle size={18} /> אנחנו כאן</h2>
              {agent && <div className="sub">היועץ שלכם: {agent.name}</div>}
            </div>
          </div>
          <div className="pt-contact">
            <a href={telLink(agent?.phone ?? brand.phone)}><Phone size={20} /> שיחה</a>
            <a className="wa" href={whatsappLink(brand.whatsapp, `שלום, אני ${customer.name} (תיק ${k.number}).`)} target="_blank" rel="noreferrer"><MessageCircle size={20} /> וואטסאפ</a>
            <a href={`mailto:${brand.email}?subject=${encodeURIComponent(`תיק ${k.number}`)}`}><Mail size={20} /> מייל</a>
          </div>
          <div className="pt-contact-meta">
            <div><Clock size={15} /> {brand.hours}</div>
            <div><MapPin size={15} /> {brand.address}</div>
          </div>
        </section>
      </main>

      <footer className="pt-foot">
        <Wordmark />
        <div className="slogan">{brand.slogan}</div>
        <div>{brand.name} · מיזוג אוויר, חימום ואוורור · <span className="ltr">{brand.phone}</span></div>
      </footer>
    </div>
  )
}

function nextStep(k: Case, quote: Quote | undefined, upcoming: Appointment[]) {
  const survey = upcoming.find((a) => a.type === 'survey')
  const install = upcoming.find((a) => a.type === 'installation')
  switch (k.stage) {
    case 'lead':
      return 'קיבלנו את הפנייה. נחזור אליכם בהקדם לתיאום סקר בשטח.'
    case 'survey':
      return survey ? `הסקר בשטח נקבע ל${dateLong(survey.start)} בשעה ${time(survey.start)}. נגיע עם מדידות וייעוץ.` : 'בשלב הבא נתאם סקר בשטח: מדידות, ייעוץ ובדיקת מיקומים למזגנים.'
    case 'quote':
      if (quote && (quote.status === 'sent' || quote.status === 'viewed'))
        return isQuoteExpired(quote) ? 'תוקף ההצעה הסתיים. כתבו לנו ונשלח הצעה מעודכנת.' : 'הצעת המחיר מחכה לכם כאן למטה. אפשר לעבור עליה, לשאול ולאשר ישירות מהנייד.'
      return 'אנחנו מכינים את הצעת המחיר לפי הסקר. נעדכן אתכם בוואטסאפ כשהיא מוכנה.'
    case 'approved':
      return 'תודה שבחרתם בנו! נחזור אליכם לתיאום מועד ההתקנה.'
    case 'scheduled':
      return install ? `ההתקנה נקבעה ל${dateLong(install.start)} בשעה ${time(install.start)}. יום לפני נשלח תזכורת.` : k.installWindow ? `ההתקנה מתוכננת בין ${date(k.installWindow.from)} ל-${date(k.installWindow.to)}.` : 'מתאמים את מועד ההתקנה.'
    case 'installing':
      return 'הצוות שלנו עובד אצלכם. בסיום נעבור יחד על המערכת ונחתום על טופס מסירה.'
    case 'completed':
    case 'closed':
      return 'ההתקנה הושלמה. כאן תמצאו את האחריות, המסמכים ופתיחת קריאת שירות, אם תצטרכו.'
    case 'lost':
      return 'התיק סגור כרגע. אם תרצו לחזור לפרויקט, נשמח לעזור.'
  }
}

// ---------- הצעת המחיר ----------
function QuoteSection({ k, quote, customer, defaultName, catalog }: { k: Case; quote?: Quote; customer: Customer; defaultName: string; catalog: Parameters<typeof totals>[1] }) {
  const settings = useSettings()
  const [dialog, setDialog] = useState<null | 'approve' | 'reject'>(null)
  const t = useMemo(() => (quote ? totals(quote, catalog) : undefined), [quote, catalog])
  const groups = useMemo(() => (quote ? groupByRoom(quote.lines, 'עבודה וחומרים') : []), [quote])

  if (!quote || !t) {
    if (['lead', 'survey', 'quote'].includes(k.stage)) {
      return (
        <section className="pt-card">
          <div className="pt-card-head"><h2><FileText size={18} /> הצעת המחיר</h2></div>
          <div className="pt-banner no" style={{ marginBottom: 0 }}>
            <span className="ico"><Hourglass size={19} /></span>
            <div>ההצעה בהכנה. אחרי הסקר נבנה הצעה מסודרת לפי החדרים שלכם, ותקבלו הודעה כשהיא מוכנה.</div>
          </div>
        </section>
      )
    }
    return null
  }

  const expired = isQuoteExpired(quote)
  const open = (quote.status === 'sent' || quote.status === 'viewed') && !expired
  const deposit = Math.round((t.total * settings.depositPct) / 100)
  const terms = quote.terms.split('\n').map((x) => x.trim()).filter(Boolean)
  const ask = () => {
    app().log({ kind: 'portal', caseId: k.id, customerId: customer.id, text: `הלקוח פתח שאלה בוואטסאפ על ההצעה ${quote.number}` })
    openWhatsApp(`שלום, יש לי שאלה לגבי הצעת המחיר ${quote.number} (${customer.name}):\n`)
  }

  return (
    <section className="pt-card">
      <div className="pt-card-head">
        <div>
          <h2><FileText size={18} /> הצעת המחיר שלכם</h2>
          <div className="sub">
            <span className="ltr">{quote.number}</span>{quote.version > 1 ? ` · גרסה ${quote.version}` : ''} · {open ? `בתוקף עד ${date(quote.validUntil)}` : date(quote.sentAt ?? quote.createdAt)}
          </div>
        </div>
        <a className="btn sm" href={appUrl(`/quotes/${quote.id}/print`)} target="_blank" rel="noreferrer"><Printer size={15} /> PDF</a>
      </div>

      {quote.status === 'approved' && (
        <div className="pt-banner ok">
          <span className="ico"><CheckCircle2 size={21} /></span>
          <div className="grow">
            <div className="strong">אישרתם את ההצעה{quote.decidedAt ? ` ב-${date(quote.decidedAt)}` : ''}. תודה!</div>
            <div className="small">
              {quote.deposit?.paidAt
                ? `המקדמה (${money(quote.deposit.amount)}) התקבלה${quote.deposit.method ? ` ${viaMethod(quote.deposit.method)}` : ''}.`
                : quote.deposit
                  ? `המקדמה (${money(quote.deposit.amount)}) ממתינה. פרטי ההעברה נשלחו אליכם.`
                  : 'נחזור אליכם לתיאום ההתקנה.'}
            </div>
          </div>
          {quote.signature && <img src={quote.signature.dataUrl} alt="החתימה שלכם" />}
        </div>
      )}
      {quote.status === 'rejected' && (
        <div className="pt-banner no">
          <span className="ico"><XCircle size={20} /></span>
          <div>ההצעה סומנה כלא רלוונטית. אם משהו השתנה, נשמח לבנות הצעה חדשה.</div>
        </div>
      )}
      {expired && (
        <div className="pt-banner warn">
          <span className="ico"><Clock size={19} /></span>
          <div>תוקף ההצעה הסתיים ב-{date(quote.validUntil)}. כתבו לנו ונשלח הצעה מעודכנת.</div>
        </div>
      )}

      {groups.map((g) => (
        <div key={g.key || '_'} className="pt-group">
          {(groups.length > 1 || g.key) && <div className="pt-group-h">{g.label}</div>}
          {g.lines.map((l) => (
            <div key={l.id} className="pt-line">
              <div className="d">
                {l.description}
                <span className="q">{l.qty.toLocaleString('he-IL')} {l.unit} × {money(l.unitPrice)}</span>
              </div>
              <span className="t">{money(lineTotal(l))}</span>
            </div>
          ))}
        </div>
      ))}

      <div className="pt-totals">
        {t.discount > 0 && <div className="r"><span>לפני הנחה</span><span>{money(t.subtotal)}</span></div>}
        {t.discount > 0 && <div className="r" style={{ color: 'var(--success)' }}><span>הנחה {pct(quote.discountPct)}</span><span>−{money(t.discount)}</span></div>}
        <div className="r"><span>לפני מע״מ</span><span>{money(t.net)}</span></div>
        <div className="r"><span>מע״מ {pct(quote.vatPct)}</span><span>{money(t.vat)}</span></div>
        <div className="r g"><span>סה״כ</span><span>{money(t.total)}</span></div>
        {open && <div className="dep">מקדמה באישור: {money(deposit)} ({settings.depositPct}%). היתרה בסיום ההתקנה.</div>}
      </div>

      {quote.notes && <div className="pt-note">{quote.notes}</div>}

      {terms.length > 0 && (
        <details className="pt-terms">
          <summary>תנאי ההצעה</summary>
          <ol>{terms.map((x, i) => <li key={i}>{x}</li>)}</ol>
        </details>
      )}

      {open && (
        <div className="pt-cta">
          <button className="btn primary block" onClick={() => setDialog('approve')}><FileSignature size={18} /> אישור ההצעה וחתימה</button>
          <button className="btn wa block" onClick={ask}><MessageCircle size={18} /> יש לי שאלה</button>
          <button className="link" onClick={() => setDialog('reject')}>ההצעה לא מתאימה לי כרגע</button>
        </div>
      )}
      {!open && quote.status !== 'approved' && (
        <div className="pt-cta">
          <button className="btn wa block" onClick={ask}><MessageCircle size={18} /> כתבו לנו בוואטסאפ</button>
        </div>
      )}

      {dialog === 'approve' && <ApproveFlow quote={quote} total={t.total} deposit={deposit} depositPct={settings.depositPct} defaultName={defaultName} terms={terms} onClose={() => setDialog(null)} />}
      {dialog === 'reject' && <RejectFlow k={k} quote={quote} onClose={() => setDialog(null)} />}
    </section>
  )
}

function ApproveFlow({ quote, total, deposit, depositPct, defaultName, terms, onClose }: { quote: Quote; total: number; deposit: number; depositPct: number; defaultName: string; terms: string[]; onClose: () => void }) {
  const [step, setStep] = useState<'sign' | 'pay' | 'done'>('sign')
  const [name, setName] = useState(defaultName.startsWith('משפחת') ? '' : defaultName)
  const [sig, setSig] = useState<string | null>(null)
  const [agree, setAgree] = useState(false)
  const [showTerms, setShowTerms] = useState(false)
  const [method, setMethod] = useState<Method>('credit')
  const [busy, setBusy] = useState(false)
  const [signedAt, setSignedAt] = useState('')
  const canSign = name.trim().length >= 2 && !!sig && agree

  async function confirm() {
    if (!sig) return
    setBusy(true)
    // הדגמה: אין חיוב אמיתי. בייצור כאן נפתח דף תשלום מאובטח של חברת הסליקה.
    await new Promise((r) => setTimeout(r, 900))
    const at = nowIso()
    approveQuote(quote.id, { name: name.trim(), dataUrl: sig, at }, { amount: deposit, method, paidAt: method === 'transfer' ? undefined : at })
    setSignedAt(at)
    setBusy(false)
    setStep('done')
  }

  const methods: { id: Method; label: string; sub: string; icon: ReactNode }[] = [
    { id: 'credit', label: 'אשראי', sub: 'תשלום מאובטח', icon: <CreditCard size={22} /> },
    { id: 'bit', label: 'Bit', sub: 'מהנייד בשניות', icon: <Smartphone size={22} /> },
    { id: 'transfer', label: 'העברה', sub: 'פרטי חשבון בוואטסאפ', icon: <Landmark size={22} /> },
  ]

  return (
    <Modal
      title={step === 'done' ? 'ההצעה אושרה' : step === 'sign' ? 'אישור ההצעה' : 'מקדמה'}
      onClose={onClose}
      footer={
        step === 'sign' ? (
          <>
            <button className="btn" onClick={onClose}>ביטול</button>
            <button className="btn primary" disabled={!canSign} onClick={() => setStep('pay')}>המשך למקדמה</button>
          </>
        ) : step === 'pay' ? (
          <>
            <button className="btn" onClick={() => setStep('sign')} disabled={busy}>חזרה</button>
            <button className="btn primary" onClick={confirm} disabled={busy}>
              {busy ? 'מאשר...' : method === 'transfer' ? 'אישור ההזמנה' : `אישור ותשלום ${money(deposit)}`}
            </button>
          </>
        ) : (
          <button className="btn primary" onClick={onClose}>סגירה</button>
        )
      }
    >
      {step !== 'done' && (
        <div className="pt-steps" aria-hidden>
          <span className="on" />
          <span className={step === 'pay' ? 'on' : ''} />
        </div>
      )}

      {step === 'sign' && (
        <div className="col" style={{ gap: 14 }}>
          <p className="small muted">
            הצעה <span className="ltr">{quote.number}</span> על סך {money(total)} כולל מע״מ. החתימה מאשרת את ההצעה ואת התנאים שלה.
          </p>
          <Field label="שם מלא">
            <input className="input" value={name} autoComplete="name" placeholder="השם של החותם/ת" onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="field">
            <span className="label">חתימה</span>
            <SignaturePad onChange={setSig} />
          </div>
          <div>
            <label className="check">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span className="small">קראתי ואני מאשר/ת את ההצעה ואת תנאיה</span>
            </label>
            <button type="button" className="btn ghost sm" style={{ marginInlineStart: 18 }} onClick={() => setShowTerms((v) => !v)}>
              {showTerms ? 'הסתרת התנאים' : 'קריאת התנאים'}
            </button>
            {showTerms && (
              <ol className="small" style={{ margin: '6px 0 0', paddingInlineStart: 36, color: 'var(--text-2)', display: 'grid', gap: 3 }}>
                {terms.map((x, i) => <li key={i}>{x}</li>)}
              </ol>
            )}
          </div>
        </div>
      )}

      {step === 'pay' && (
        <div className="col" style={{ gap: 14 }}>
          <div className="pt-amount">
            <span>מקדמה לאישור ההזמנה</span>
            <b>{money(deposit)}</b>
            <span>{depositPct}% מ-{money(total)}. היתרה משולמת בסיום ההתקנה.</span>
          </div>
          <div className="field">
            <span className="label">איך נוח לשלם?</span>
            <div className="pt-methods">
              {methods.map((m) => (
                <button key={m.id} type="button" className={`choice ${method === m.id ? 'on' : ''}`} onClick={() => setMethod(m.id)} aria-pressed={method === m.id}>
                  {m.icon}
                  <b>{m.label}</b>
                  <small>{m.sub}</small>
                </button>
              ))}
            </div>
          </div>
          {method === 'transfer' && <p className="small muted">ההזמנה תאושר עכשיו, ופרטי החשבון יישלחו אליכם בוואטסאפ. המקדמה תסומן כששולמה.</p>}
          <Callout tone="warning">
            <b>תשלום בהדגמה.</b> זו גרסת הדגמה: לא יבוצע חיוב ולא נאספים פרטי כרטיס. במערכת האמיתית ייפתח כאן דף תשלום מאובטח.
          </Callout>
        </div>
      )}

      {step === 'done' && (
        <div className="pt-success">
          <span className="big"><Check size={34} strokeWidth={3} /></span>
          <h3>תודה, ההצעה אושרה!</h3>
          <p>המשרד קיבל את האישור ויחזור אליכם בהקדם לתיאום מועד ההתקנה. עותק חתום של ההצעה זמין בכל רגע באזור האישי.</p>
          <div className="pt-summary">
            <div><span>הצעה</span><b className="ltr">{quote.number}</b></div>
            <div><span>נחתם ע״י</span><b>{name}</b></div>
            <div><span>מועד</span><b>{dateTime(signedAt)}</b></div>
            <div><span>מקדמה</span><b>{money(deposit)} · {method === 'transfer' ? 'ממתינה להעברה' : `שולמה ${viaMethod(method)}`}</b></div>
          </div>
        </div>
      )}
    </Modal>
  )
}

const rejectReasons = ['המחיר גבוה בשבילי', 'בחרתי בהצעה אחרת', 'דחינו את הפרויקט']

function RejectFlow({ k, quote, onClose }: { k: Case; quote: Quote; onClose: () => void }) {
  const [reason, setReason] = useState('')
  function send() {
    const s = app()
    rejectQuote(quote.id, `מהאזור האישי${reason.trim() ? `: ${reason.trim()}` : ''}`)
    if (k.agentId) s.notify(k.agentId, `הלקוח דחה את ההצעה ${quote.number}${reason.trim() ? `: ${reason.trim()}` : ''}`, `/cases/${k.id}`)
    toast.info('תודה על העדכון')
    onClose()
  }
  return (
    <Modal
      title="ההצעה לא מתאימה?"
      size="narrow"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>חזרה להצעה</button>
          <button className="btn dark" onClick={send}>שליחה</button>
        </>
      }
    >
      <div className="col" style={{ gap: 12 }}>
        <p className="small muted">נשמח לדעת למה. לפעמים אפשר להתאים את ההצעה, ואם לא, זה עוזר לנו להשתפר.</p>
        <div className="pt-chips">
          {rejectReasons.map((r) => (
            <button key={r} type="button" className={`chip ${reason === r ? 'on' : ''}`} onClick={() => setReason(reason === r ? '' : r)}>{r}</button>
          ))}
        </div>
        <Field label="משהו נוסף? (לא חובה)">
          <textarea className="textarea" rows={3} value={rejectReasons.includes(reason) ? '' : reason} placeholder="אפשר לכתוב כאן" onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}

// ---------- מועדים ----------
function Appointments({ list, users, k, addressLabel }: { list: Appointment[]; users: User[]; k: Case; addressLabel: string }) {
  const today = new Date()
  return (
    <section className="pt-card">
      <div className="pt-card-head"><h2><CalendarDays size={18} /> המועדים הקרובים</h2></div>
      {list.length === 0 && k.installWindow && (
        <div className="pt-appt">
          <div className="pt-date"><b>{new Date(k.installWindow.from + 'T00:00').getDate()}</b><small>{new Intl.DateTimeFormat('he-IL', { month: 'short' }).format(new Date(k.installWindow.from + 'T00:00'))}</small></div>
          <div>
            <div className="t">חלון התקנה</div>
            <div className="s">{date(k.installWindow.from)}{k.installWindow.to !== k.installWindow.from ? ` עד ${date(k.installWindow.to)}` : ''}. את השעה המדויקת נאשר מראש.</div>
          </div>
        </div>
      )}
      {list.map((a) => {
        const team = a.userIds.map((id) => users.find((u) => u.id === id)).filter(Boolean).map((u) => firstName(u!.name))
        const isToday = sameDay(a.start, today)
        const days = daysBetween(ymd(today), ymd(a.start))
        return (
          <div key={a.id} className="pt-appt">
            <div className={`pt-date ${isToday ? 'today' : ''}`}>
              <b>{new Date(a.start).getDate()}</b>
              <small>{isToday ? 'היום' : new Intl.DateTimeFormat('he-IL', { month: 'short' }).format(new Date(a.start))}</small>
            </div>
            <div className="grow">
              <div className="t">{visitLabel[a.type]}{a.status === 'on_the_way' ? ' · הצוות בדרך אליכם' : a.status === 'in_progress' ? ' · בביצוע עכשיו' : ''}</div>
              <div className="s">
                {dateLong(a.start)}{a.allDay ? '' : `, ${time(a.start)}–${time(a.end)}`}
                {!isToday && days > 0 && days <= 7 ? ` · בעוד ${days === 1 ? 'יום' : `${days} ימים`}` : ''}
              </div>
              {team.length > 0 && <div className="s">{a.type === 'service' || a.type === 'maintenance' ? 'הטכנאי' : 'הצוות'}: {joinNames(team)}</div>}
              <div className="acts">
                <a className="btn sm" href={googleCalendarLink({ title: `${brand.name}: ${visitLabel[a.type]}`, start: a.start, end: a.end, location: addressLabel, details: k.title })} target="_blank" rel="noreferrer">
                  <CalendarPlus size={14} /> הוספה ליומן
                </a>
                <a className="btn sm ghost" href={whatsappLink(brand.whatsapp, `שלום, לגבי ${visitLabel[a.type]} ב-${date(a.start)} (תיק ${k.number}):\n`)} target="_blank" rel="noreferrer">
                  שינוי מועד
                </a>
              </div>
            </div>
          </div>
        )
      })}
    </section>
  )
}

// ---------- יחידות ואחריות ----------
function UnitsSection({ list }: { list: InstalledUnit[] }) {
  const today = ymd()
  return (
    <section className="pt-card">
      <div className="pt-card-head">
        <div>
          <h2><ShieldCheck size={18} /> המזגנים והאחריות</h2>
          <div className="sub">{list.length} יחידות רשומות על שמכם</div>
        </div>
      </div>
      <div className="pt-units">
        {list.map((u) => {
          const left = daysBetween(today, u.warrantyUntil)
          const tone = left < 0 ? 'muted' : left <= 60 ? 'warning' : 'success'
          return (
            <div key={u.id} className="pt-unit">
              <div className="nm">{u.model}</div>
              {u.location && <div className="loc">{u.location}{u.btu ? <> · <span className="ltr">{u.btu.toLocaleString('he-IL')} BTU</span></> : ''}</div>}
              <div className="sn">מס׳ סידורי <span className="ltr">{u.serial}</span> · הותקן {date(u.installedAt)}</div>
              <span className={`badge ${tone} dot`}>{left < 0 ? 'האחריות הסתיימה' : `באחריות עד ${date(u.warrantyUntil)}`}</span>
              {u.nextServiceAt && <div className="sn">טיפול מומלץ הבא: {date(u.nextServiceAt)}</div>}
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ---------- קריאת שירות ----------
function ServiceSection({ k, customer, units }: { k: Case; customer: Customer; units: InstalledUnit[] }) {
  const contracts = useDB((d) => d.contracts)
  const [unitId, setUnitId] = useState('')
  const [symptom, setSymptom] = useState<ServiceCall['symptom']>()
  const [code, setCode] = useState('')
  const [text, setText] = useState('')
  const [done, setDone] = useState<ServiceCall | null>(null)

  function submit() {
    if (!symptom && text.trim().length < 3) return toast.error('ספרו לנו בקצרה מה קרה')
    const s = app()
    const unit = units.find((u) => u.id === unitId)
    const contract = contracts.find((c) => c.customerId === customer.id && c.status !== 'cancelled' && c.status !== 'expired' && (!unit || c.unitIds.includes(unit.id)))
    const label = symptoms.find((x) => x.id === symptom)?.label
    const sc: ServiceCall = {
      id: uid('sc'),
      number: s.nextNumber('service', 'SC-', 4),
      customerId: customer.id,
      addressId: unit?.addressId ?? k.addressId,
      unitId: unit?.id,
      contractId: contract?.id,
      description: [label, text.trim()].filter(Boolean).join(': ') + (unit?.location ? ` (${unit.location})` : ''),
      symptom,
      errorCode: symptom === 'error_code' && code.trim() ? code.trim().toUpperCase() : undefined,
      urgency: symptom === 'leak' || symptom === 'no_power' ? 'high' : 'normal',
      status: 'new',
      underWarranty: unit ? unit.warrantyUntil >= ymd() : undefined,
      source: 'website',
      createdAt: nowIso(),
    }
    s.upsert('serviceCalls', sc)
    s.log({ kind: 'service', serviceCallId: sc.id, customerId: customer.id, caseId: k.id, text: `קריאת שירות ${sc.number} נפתחה מהאזור האישי` })
    s.db.users.filter((u) => u.role === 'office' || u.role === 'admin').forEach((u) => s.notify(u.id, `קריאת שירות מהאזור האישי: ${customer.name}`, `/service/${sc.id}`))
    setDone(sc)
  }

  return (
    <section className="pt-card">
      <div className="pt-card-head">
        <div>
          <h2><Wrench size={18} /> צריכים שירות?</h2>
          <div className="sub">פותחים קריאה כאן, ואנחנו חוזרים לתיאום ביקור</div>
        </div>
      </div>
      {done ? (
        <div className="pt-banner ok" style={{ marginBottom: 0 }}>
          <span className="ico"><ClipboardCheck size={20} /></span>
          <div className="grow">
            <div className="strong">הקריאה התקבלה · <span className="ltr">{done.number}</span></div>
            <div className="small">נחזור אליכם לתיאום ביקור, בדרך כלל באותו יום עבודה.{done.underWarranty ? ' היחידה באחריות.' : ''}</div>
            <button className="btn sm wa mt8" onClick={() => openWhatsApp(`שלום, פתחתי קריאת שירות ${done.number}. מצרף/ת תמונה:`)}>
              <MessageCircle size={14} /> שליחת תמונה בוואטסאפ
            </button>
          </div>
        </div>
      ) : (
        <div className="pt-form">
          {units.length > 0 && (
            <Field label="איזה מזגן?">
              <select className="select" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                <option value="">לא בטוח/ה / כמה מזגנים</option>
                {units.map((u) => <option key={u.id} value={u.id}>{u.location ? `${u.location} · ` : ''}{u.model}</option>)}
              </select>
            </Field>
          )}
          <div className="field">
            <span className="label">מה קורה?</span>
            <div className="pt-chips">
              {symptoms.map((x) => (
                <button key={x.id} type="button" className={`chip ${symptom === x.id ? 'on' : ''}`} onClick={() => setSymptom(symptom === x.id ? undefined : x.id)}>{x.label}</button>
              ))}
            </div>
          </div>
          {symptom === 'error_code' && (
            <Field label="הקוד שמופיע על המזגן">
              <input className="input" dir="ltr" style={{ textAlign: 'right' }} placeholder="למשל E4" value={code} onChange={(e) => setCode(e.target.value)} />
            </Field>
          )}
          <Field label="כמה מילים (לא חובה)">
            <textarea className="textarea" rows={3} value={text} placeholder="מתי זה התחיל, מה שמתם לב" onChange={(e) => setText(e.target.value)} />
          </Field>
          <button className="btn dark lg block" onClick={submit}><Wrench size={17} /> פתיחת קריאת שירות</button>
        </div>
      )}
    </section>
  )
}

function NotFound() {
  return (
    <div className="pt-page" dir="rtl">
      <header className="pt-hero">
        <div className="pt-hero-in">
          <div className="pt-top"><Wordmark /></div>
          <div className="pt-eyebrow">האזור האישי</div>
          <h1>הקישור לא נמצא</h1>
          <div className="pt-promise"><Snowflake size={15} /> {brand.promise}</div>
        </div>
      </header>
      <main className="pt-wrap">
        <section className="pt-card">
          <p style={{ lineHeight: 1.7 }}>
            ייתכן שהקישור לא הועתק עד הסוף, או שהאזור האישי נסגר. כתבו לנו או התקשרו, ונשלח לכם קישור חדש.
          </p>
          <div className="pt-cta">
            <a className="btn wa block" href={whatsappLink(brand.whatsapp, 'שלום, הקישור לאזור האישי לא נפתח לי. אפשר קישור חדש?')} target="_blank" rel="noreferrer"><MessageCircle size={18} /> וואטסאפ</a>
            <a className="btn block" href={telLink(brand.phone)}><Phone size={18} /> <span className="ltr">{brand.phone}</span></a>
          </div>
        </section>
      </main>
      <footer className="pt-foot">
        <Wordmark />
        <div className="slogan">{brand.slogan}</div>
      </footer>
    </div>
  )
}
