// האזור האישי של הלקוח: איפה הפרויקט עומד, ההצעה עם חתימה ומקדמה, מועדים, מסמכים, אחריות, קריאת שירות וצ'אט עם המשרד.
// שני מקורות נתונים לאותו מסך: במצב הדגמה — המאגר בדפדפן; במסד המשותף — השרת (/api/portal/:token, בלי התחברות,
// רק הנתונים של התיק הזה). הלקוח לא שולח ישויות לשרת: רק פעולות (אישור, דחייה, קריאה, קובץ, הודעה).
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import {
  CalendarDays, CalendarPlus, Check, CheckCircle2, ClipboardCheck, Clock, CreditCard, FileSignature, FileText, Landmark, Mail, MapPin, MessageCircle, Phone,
  Printer, ShieldCheck, Smartphone, Snowflake, Sparkles, Wrench, Hammer, Ruler, Search, Hourglass, XCircle, Paperclip, Send, RefreshCw,
} from 'lucide-react'
import { brand } from '../../brand'
import { app, useDB, useSettings } from '../../lib/store'
import { approveQuote, markQuoteViewed, rejectQuote } from '../../lib/actions'
import { lineTotal, totals } from '../../lib/quote'
import { appointmentTypeLabel } from '../../lib/labels'
import { date, dateLong, dateTime, daysBetween, money, nowIso, pct, sameDay, time, uid, ymd } from '../../lib/format'
import { addressText, googleCalendarLink, safeHref, telLink, whatsappLink } from '../../lib/integrations/links'
import type { Address, Appointment, CatalogItem, Case, Doc, InstalledUnit, Message, Quote, ServiceCall, Signature } from '../../lib/types'
import { Wordmark } from '../../components/Layout'
import { Callout, Field, Modal, SignaturePad, toast } from '../../components/ui'
import { appUrl, caseContact, customerQuote, firstName, viaMethod, greetName, groupByRoom, isQuoteExpired } from '../../features/quotes/util'
import { publicHeaders, publicServerUrl } from '../../lib/sync/bridge'
import { docBlob, saveLocalBlob, sizeLabel } from '../../lib/files'
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

const docVisible = (d: Doc) => d.customerVisible ?? (d.folder === 'customer' || (d.folder === 'installer' && /מסירה|אחריות|הוראות/.test(d.name)))
const UPLOAD_MAX = 10 * 1024 * 1024

// ---------- מודל משותף לשני מקורות הנתונים ----------

type PortalCase = Pick<Case, 'id' | 'number' | 'title' | 'stage' | 'installWindow'>
interface PortalAppt { id: string; type: Appointment['type']; start: string; end: string; allDay?: boolean; status: Appointment['status']; team: string[] }
interface PortalDoc { id: string; name: string; size?: number; uploadedAt: string; fromCustomer?: boolean; href?: string; doc?: Doc }
interface PortalMsg { id: string; direction: 'in' | 'out'; body: string; at: string; by?: string }
interface ServiceInput { unitId?: string; symptom?: ServiceCall['symptom']; errorCode?: string; text: string }

interface Model {
  k: PortalCase
  customerName: string
  signerName: string
  hello: string
  addressLabel: string
  agent?: { name: string; phone?: string }
  quote?: Quote
  depositPct: number
  upcoming: PortalAppt[]
  units: InstalledUnit[]
  docs: PortalDoc[]
  messages: PortalMsg[]
  catalog: CatalogItem[]
}

interface Actions {
  remote: boolean
  view: () => void
  approve: (q: Quote, sig: { name: string; dataUrl: string }, method: Method, deposit: number) => Promise<Quote['deposit']>
  reject: (q: Quote, reason: string) => Promise<void>
  service: (p: ServiceInput) => Promise<{ number: string; underWarranty?: boolean | null }>
  upload: (file: File) => Promise<void>
  send: (body: string) => Promise<void>
  openDoc: (d: PortalDoc) => Promise<void>
  printQuote: (q: Quote) => void
  logAsk?: (q: Quote) => void
}

export default function Portal() {
  const { token = '' } = useParams()
  const [params] = useSearchParams()
  const server = publicServerUrl(params.get('server'))

  useEffect(() => {
    const prev = document.title
    document.title = `האזור האישי · ${brand.name}`
    return () => {
      document.title = prev
    }
  }, [])

  return server ? <RemotePortal token={token} server={server} /> : <LocalPortal token={token} />
}

// ---------- מצב הדגמה: מהמאגר בדפדפן ----------

function LocalPortal({ token }: { token: string }) {
  const cases = useDB((d) => d.cases)
  const customers = useDB((d) => d.customers)
  const contacts = useDB((d) => d.contacts)
  const quotes = useDB((d) => d.quotes)
  const appointments = useDB((d) => d.appointments)
  const users = useDB((d) => d.users)
  const docs = useDB((d) => d.docs)
  const units = useDB((d) => d.units)
  const catalog = useDB((d) => d.catalog)
  const messages = useDB((d) => d.messages)
  const contracts = useDB((d) => d.contracts)
  const settings = useSettings()

  const k = cases.find((c) => c.portal.token === token)
  const ok = !!k && k.portal.enabled
  const customer = k ? customers.find((c) => c.id === k.customerId) : undefined

  const model = useMemo<Model | null>(() => {
    if (!k || !ok || !customer) return null
    const contact = caseContact(k, contacts)
    const address = customer.addresses.find((a) => a.id === k.addressId) ?? customer.addresses[0]
    const agent = users.find((u) => u.id === k.agentId)
    const today = ymd()
    return {
      k,
      customerName: customer.name,
      signerName: contact?.name ?? customer.name,
      hello: greetName(contact, customer),
      addressLabel: addressText(address),
      agent: agent && { name: agent.name, phone: agent.phone },
      quote: customerQuote(quotes, k.id),
      depositPct: settings.depositPct,
      upcoming: appointments
        .filter((a) => (a.caseId === k.id || (!a.caseId && a.customerId === k.customerId)) && a.status !== 'cancelled' && a.status !== 'done' && ymd(a.end) >= today)
        .sort((a, b) => a.start.localeCompare(b.start))
        .map((a) => ({ ...a, team: a.userIds.map((id) => users.find((u) => u.id === id)).filter(Boolean).map((u) => firstName(u!.name)) })),
      units: units.filter((u) => u.customerId === k.customerId && (u.caseId === k.id || u.addressId === k.addressId)),
      docs: docs
        .filter((d) => d.caseId === k.id && docVisible(d))
        .map((d) => ({ id: d.id, name: d.name, size: d.size, uploadedAt: d.uploadedAt, fromCustomer: d.source === 'portal', href: safeHref(d.url ?? d.dataUrl), doc: d })),
      messages: messages
        .filter((m) => m.caseId === k.id && m.channel === 'portal')
        .sort((a, b) => a.at.localeCompare(b.at))
        .map((m) => ({ id: m.id, direction: m.direction, body: m.body, at: m.at, by: m.direction === 'out' ? firstName(users.find((u) => u.id === m.by)?.name) : undefined })),
      catalog,
    }
  }, [k, ok, customer, contacts, users, quotes, settings.depositPct, appointments, units, docs, messages, catalog])

  const staff = useCallback(() => {
    const s = app()
    return k?.agentId ? [k.agentId] : s.db.users.filter((u) => u.role === 'office' || u.role === 'admin').map((u) => u.id)
  }, [k?.agentId])

  const actions = useMemo<Actions>(() => ({
    remote: false,
    view: () => {
      if (!k || seen.has(k.portal.token)) return
      seen.add(k.portal.token)
      const s = app()
      s.patch('cases', k.id, { portal: { ...k.portal, lastViewedAt: nowIso() } })
      s.log({ kind: 'portal', caseId: k.id, customerId: k.customerId, text: 'הלקוח נכנס לאזור האישי' })
      const q = customerQuote(s.db.quotes, k.id)
      if (q?.status === 'sent') markQuoteViewed(q.id)
    },
    approve: async (q, sig, method, deposit) => {
      // הדגמה: אין חיוב אמיתי. בייצור כאן נפתח דף תשלום מאובטח של חברת הסליקה.
      // כמו בשרת: המקדמה נרשמת כממתינה, והמשרד מסמן אותה כשולמה אחרי שבדק שהכסף התקבל (approveQuote מתריע להם)
      await new Promise((r) => setTimeout(r, 900))
      const at = nowIso()
      const dep: Quote['deposit'] = { amount: deposit, method, status: 'pending' }
      approveQuote(q.id, { name: sig.name, dataUrl: sig.dataUrl, at } as Signature, dep)
      return dep
    },
    reject: async (q, reason) => {
      const s = app()
      rejectQuote(q.id, `מהאזור האישי${reason ? `: ${reason}` : ''}`)
      if (k?.agentId) s.notify(k.agentId, `הלקוח דחה את ההצעה ${q.number}${reason ? `: ${reason}` : ''}`, `/cases/${k.id}`)
    },
    service: async (p) => {
      const s = app()
      if (!k || !customer) throw new Error('התיק לא נמצא')
      const unit = s.db.units.find((u) => u.id === p.unitId)
      const contract = contracts.find((c) => c.customerId === customer.id && c.status !== 'cancelled' && c.status !== 'expired' && (!unit || c.unitIds.includes(unit.id)))
      const label = symptoms.find((x) => x.id === p.symptom)?.label
      const sc: ServiceCall = {
        id: uid('sc'), number: s.nextNumber('service', 'SC-', 4), customerId: customer.id, addressId: unit?.addressId ?? k.addressId, unitId: unit?.id, contractId: contract?.id,
        description: [label, p.text].filter(Boolean).join(': ') + (unit?.location ? ` (${unit.location})` : ''),
        symptom: p.symptom, errorCode: p.errorCode, urgency: p.symptom === 'leak' || p.symptom === 'no_power' ? 'high' : 'normal', status: 'new',
        underWarranty: unit ? unit.warrantyUntil >= ymd() : undefined, source: 'portal', createdAt: nowIso(),
      }
      s.upsert('serviceCalls', sc)
      s.log({ kind: 'service', serviceCallId: sc.id, customerId: customer.id, caseId: k.id, text: `קריאת שירות ${sc.number} נפתחה מהאזור האישי` })
      s.db.users.filter((u) => u.role === 'office' || u.role === 'admin').forEach((u) => s.notify(u.id, `קריאת שירות מהאזור האישי: ${customer.name}`, `/service/${sc.id}`))
      return { number: sc.number, underWarranty: sc.underWarranty }
    },
    upload: async (file) => {
      if (!k) return
      const s = app()
      const id = uid('d')
      const blobKey = await saveLocalBlob(id, file)
      s.upsert('docs', { id, caseId: k.id, customerId: k.customerId, folder: 'customer', name: file.name, mime: file.type || 'application/octet-stream', size: file.size, uploadedAt: nowIso(), blobKey, source: 'portal', customerVisible: true })
      s.log({ kind: 'document', caseId: k.id, customerId: k.customerId, text: `הלקוח העלה קובץ מהאזור האישי: ${file.name}` })
      staff().forEach((u) => s.notify(u, `קובץ חדש מהלקוח: ${file.name}`, `/cases/${k.id}`))
    },
    send: async (body) => {
      if (!k) return
      const s = app()
      const m: Message = { id: uid('m'), caseId: k.id, customerId: k.customerId, channel: 'portal', direction: 'in', body, at: nowIso(), status: 'delivered' }
      s.upsert('messages', m)
      staff().forEach((u) => s.notify(u, `הודעה מ${customer?.name ?? 'הלקוח'}: ${body.slice(0, 60)}`, `/cases/${k.id}`))
    },
    openDoc: async (d) => {
      if (d.href) return void window.open(d.href, '_blank', 'noopener')
      const b = d.doc && (await docBlob(d.doc))
      if (!b) return openWhatsApp(`שלום, אשמח לקבל את המסמך "${d.name}" (תיק ${k?.number}). תודה!`)
      const url = URL.createObjectURL(b)
      window.open(url, '_blank', 'noopener')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    },
    printQuote: (q) => window.open(appUrl(`/quotes/${q.id}/print`), '_blank', 'noopener'),
    logAsk: (q) => k && app().log({ kind: 'portal', caseId: k.id, customerId: k.customerId, text: `הלקוח פתח שאלה בוואטסאפ על ההצעה ${q.number}` }),
  }), [k, customer, contracts, staff])

  if (!model) return <NotFound />
  return <PortalView m={model} a={actions} />
}

// ---------- מסד משותף: מהשרת, לפי הקישור בלבד ----------

interface RemoteData {
  case: PortalCase
  customer: { firstName: string; name?: string }
  contact: { firstName: string; name: string } | null
  address?: Pick<Address, 'id' | 'city' | 'street' | 'number' | 'floor' | 'apartment' | 'label'>
  agent: { firstName: string; name: string; phone?: string } | null
  quote: Quote | null
  appointments: PortalAppt[]
  units: InstalledUnit[]
  docs: { id: string; name: string; size?: number; uploadedAt: string; url?: string; fromCustomer?: boolean }[]
  messages: PortalMsg[]
  settings: { depositPct: number }
}

async function call<T>(server: string, path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(server + path, { ...init, headers: { ...publicHeaders(), ...(init.json !== undefined ? { 'content-type': 'application/json' } : {}), ...(init.headers as Record<string, string>) }, body: init.json !== undefined ? JSON.stringify(init.json) : init.body })
  } catch {
    throw Object.assign(new Error('אין חיבור. בדקו את האינטרנט ונסו שוב.'), { status: 0 })
  }
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }
  if (!res.ok) throw Object.assign(new Error((body as { error?: { message?: string } })?.error?.message ?? `שגיאה ${res.status}`), { status: res.status })
  return body as T
}

function RemotePortal({ token, server }: { token: string; server: string }) {
  const [data, setData] = useState<RemoteData | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'missing' | 'offline'>('loading')
  const base = `/api/portal/${encodeURIComponent(token)}`

  const load = useCallback(async () => {
    try {
      const d = await call<RemoteData>(server, base)
      setData(d)
      setState('ok')
    } catch (e) {
      const status = (e as { status?: number }).status
      setState((s) => (status === 404 ? 'missing' : s === 'ok' ? 'ok' : 'offline'))
    }
  }, [server, base])

  // אחרי שהלקוח כתב או פעל, בודקים כל 5 שניות (מחכים לתשובה); אחרת כל 15
  const active = useRef(0)
  useEffect(() => {
    void load()
    // תשובות מהמשרד ועדכוני מועדים מגיעים בלי לרענן את הדף
    let tick = 0
    const t = setInterval(() => {
      tick++
      const busy = Date.now() - active.current < 3 * 60_000
      if (document.visibilityState === 'visible' && (busy || tick % 3 === 0)) void load()
    }, 5_000)
    const onVis = () => document.visibilityState === 'visible' && void load()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [load])

  const model = useMemo<Model | null>(() => {
    if (!data) return null
    const today = ymd()
    return {
      k: data.case,
      customerName: data.customer.name ?? data.customer.firstName,
      signerName: data.contact?.name ?? data.customer.name ?? '',
      hello: data.contact?.firstName || data.customer.firstName,
      addressLabel: data.address ? addressText(data.address as Address) : '',
      agent: data.agent ? { name: data.agent.name, phone: data.agent.phone } : undefined,
      quote: data.quote ?? undefined,
      depositPct: data.settings.depositPct,
      upcoming: data.appointments.filter((a) => a.status !== 'done' && ymd(a.end) >= today),
      units: data.units,
      docs: data.docs.map((d) => ({ ...d, href: d.url ? safeHref(d.url.startsWith('/api/') ? server + d.url : d.url) : undefined })),
      messages: data.messages,
      catalog: [],
    }
  }, [data, server])

  const actions = useMemo<Actions>(() => ({
    remote: true,
    view: () => {
      if (seen.has(token)) return
      seen.add(token)
      void call(server, `${base}/view`, { method: 'POST', json: {} }).catch(() => {})
    },
    approve: async (q, sig, method) => {
      const r = await call<{ deposit: Quote['deposit'] }>(server, `${base}/approve`, { method: 'POST', json: { quoteId: q.id, signature: sig, deposit: { method } } })
      void load()
      return r.deposit
    },
    reject: async (q, reason) => {
      await call(server, `${base}/reject`, { method: 'POST', json: { quoteId: q.id, reason } })
      void load()
    },
    service: async (p) => {
      const r = await call<{ number: string; underWarranty: boolean | null }>(server, `${base}/service`, { method: 'POST', json: p })
      void load()
      return r
    },
    upload: async (file) => {
      await call(server, `${base}/upload`, { method: 'POST', headers: { 'content-type': file.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name) }, body: file })
      void load()
    },
    send: async (body) => {
      await call(server, `${base}/messages`, { method: 'POST', json: { body } })
      active.current = Date.now()
      await load()
    },
    openDoc: async (d) => {
      if (d.href) return void window.open(d.href, '_blank', 'noopener')
      openWhatsApp(`שלום, אשמח לקבל את המסמך "${d.name}" (תיק ${data?.case.number}). תודה!`)
    },
    printQuote: () => {
      document.body.classList.add('pt-print-quote')
      window.print()
      setTimeout(() => document.body.classList.remove('pt-print-quote'), 500)
    },
  }), [server, base, token, load, data?.case.number])

  if (state === 'missing') return <NotFound />
  if (!model) {
    return (
      <div className="pt-page" dir="rtl">
        <header className="pt-hero"><div className="pt-hero-in"><div className="pt-top"><Wordmark /></div><div className="pt-eyebrow">האזור האישי</div><h1>{state === 'offline' ? 'אין חיבור כרגע' : 'טוען...'}</h1></div></header>
        {state === 'offline' && (
          <main className="pt-wrap">
            <section className="pt-card">
              <p>לא הצלחנו לטעון את הפרטים. בדקו את החיבור לאינטרנט ונסו שוב.</p>
              <div className="pt-cta"><button className="btn primary block" onClick={() => void load()}><RefreshCw size={18} /> לנסות שוב</button></div>
            </section>
          </main>
        )}
      </div>
    )
  }
  return <PortalView m={model} a={actions} />
}

// ---------- המסך ----------

function PortalView({ m, a }: { m: Model; a: Actions }) {
  const { k, quote } = m
  useEffect(() => {
    a.view()
  }, [a])

  const idx = stageIdx[k.stage]
  const quoteFirst = !!quote && (quote.status === 'sent' || quote.status === 'viewed')
  const showService = m.units.length > 0 || ['completed', 'closed'].includes(k.stage)

  const quoteCard = <QuoteSection key="q" m={m} a={a} />
  const apptCard = (m.upcoming.length > 0 || (k.installWindow && ['approved', 'scheduled', 'installing'].includes(k.stage))) && (
    <Appointments key="a" list={m.upcoming} k={k} addressLabel={m.addressLabel} />
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
          <h1>שלום{m.hello ? ` ${m.hello}` : ''},</h1>
          <div className="proj">{k.title}</div>
          <div className="meta">
            {m.addressLabel}{m.addressLabel ? ' · ' : ''}תיק <span className="ltr">{k.number}</span>
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
            <div>{nextStep(k, quote, m.upcoming)}</div>
          </div>
        </section>

        {quoteFirst ? [quoteCard, apptCard] : [apptCard, quoteCard]}

        {m.units.length > 0 && <UnitsSection list={m.units} />}
        {k.stage !== 'lost' && <DocsSection m={m} a={a} />}
        {showService && <ServiceSection m={m} a={a} />}
        <ChatSection m={m} a={a} />

        <section className="pt-card">
          <div className="pt-card-head">
            <div>
              <h2><MessageCircle size={18} /> אנחנו כאן</h2>
              {m.agent && <div className="sub">היועץ שלכם: {m.agent.name}</div>}
            </div>
          </div>
          <div className="pt-contact">
            <a href={telLink(m.agent?.phone ?? brand.phone)}><Phone size={20} /> שיחה</a>
            <a className="wa" href={whatsappLink(brand.whatsapp, `שלום, אני ${m.customerName} (תיק ${k.number}).`)} target="_blank" rel="noreferrer"><MessageCircle size={20} /> וואטסאפ</a>
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

function nextStep(k: PortalCase, quote: Quote | undefined, upcoming: PortalAppt[]) {
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
function QuoteSection({ m, a }: { m: Model; a: Actions }) {
  const { k, quote } = m
  const [dialog, setDialog] = useState<null | 'approve' | 'reject'>(null)
  const t = useMemo(() => (quote ? totals(quote, m.catalog) : undefined), [quote, m.catalog])
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
  const deposit = Math.round((t.total * m.depositPct) / 100)
  const terms = quote.terms.split('\n').map((x) => x.trim()).filter(Boolean)
  const ask = () => {
    a.logAsk?.(quote)
    openWhatsApp(`שלום, יש לי שאלה לגבי הצעת המחיר ${quote.number} (${m.customerName}):\n`)
  }

  return (
    <section className="pt-card pt-quote-card">
      <div className="pt-card-head">
        <div>
          <h2><FileText size={18} /> הצעת המחיר שלכם</h2>
          <div className="sub">
            <span className="ltr">{quote.number}</span>{quote.version > 1 ? ` · גרסה ${quote.version}` : ''} · {open ? `בתוקף עד ${date(quote.validUntil)}` : date(quote.sentAt ?? quote.createdAt)}
          </div>
        </div>
        <button className="btn sm pt-noprint" onClick={() => a.printQuote(quote)}><Printer size={15} /> PDF</button>
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
                  ? quote.deposit.method === 'transfer'
                    ? `המקדמה (${money(quote.deposit.amount)}) ממתינה להעברה. פרטי החשבון נשלחו אליכם.`
                    : `המקדמה (${money(quote.deposit.amount)}) ממתינה לאימות במשרד.`
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
        {open && <div className="dep">מקדמה באישור: {money(deposit)} ({m.depositPct}%). היתרה בסיום ההתקנה.</div>}
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

      {dialog === 'approve' && <ApproveFlow quote={quote} a={a} total={t.total} deposit={deposit} depositPct={m.depositPct} defaultName={m.signerName} terms={terms} onClose={() => setDialog(null)} />}
      {dialog === 'reject' && <RejectFlow quote={quote} a={a} onClose={() => setDialog(null)} />}
    </section>
  )
}

function ApproveFlow({ quote, a, total, deposit, depositPct, defaultName, terms, onClose }: { quote: Quote; a: Actions; total: number; deposit: number; depositPct: number; defaultName: string; terms: string[]; onClose: () => void }) {
  const [step, setStep] = useState<'sign' | 'pay' | 'done'>('sign')
  const [name, setName] = useState(defaultName.startsWith('משפחת') ? '' : defaultName)
  const [sig, setSig] = useState<string | null>(null)
  const [agree, setAgree] = useState(false)
  const [showTerms, setShowTerms] = useState(false)
  const [method, setMethod] = useState<Method>('credit')
  const [busy, setBusy] = useState(false)
  const [signedAt, setSignedAt] = useState('')
  const [paid, setPaid] = useState(deposit)
  const [paidAt, setPaidAt] = useState<string | undefined>()
  const canSign = name.trim().length >= 2 && !!sig && agree

  async function confirm() {
    if (!sig) return
    setBusy(true)
    try {
      const dep = await a.approve(quote, { name: name.trim(), dataUrl: sig }, method, deposit)
      if (dep?.amount) setPaid(dep.amount)
      setPaidAt(dep?.paidAt)
      setSignedAt(nowIso())
      setStep('done')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
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
            <button className="btn primary" onClick={() => void confirm()} disabled={busy}>
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
              {methods.map((x) => (
                <button key={x.id} type="button" className={`choice ${method === x.id ? 'on' : ''}`} onClick={() => setMethod(x.id)} aria-pressed={method === x.id}>
                  {x.icon}
                  <b>{x.label}</b>
                  <small>{x.sub}</small>
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
            <div><span>מקדמה</span><b>{money(paid)} · {paidAt ? `שולמה ${viaMethod(method)}` : method === 'transfer' ? 'ממתינה להעברה' : 'ממתינה לאימות במשרד'}</b></div>
          </div>
        </div>
      )}
    </Modal>
  )
}

const rejectReasons = ['המחיר גבוה בשבילי', 'בחרתי בהצעה אחרת', 'דחינו את הפרויקט']

function RejectFlow({ quote, a, onClose }: { quote: Quote; a: Actions; onClose: () => void }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  async function send() {
    setBusy(true)
    try {
      await a.reject(quote, reason.trim())
      toast.info('תודה על העדכון')
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title="ההצעה לא מתאימה?"
      size="narrow"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>חזרה להצעה</button>
          <button className="btn dark" disabled={busy} onClick={() => void send()}>שליחה</button>
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
function Appointments({ list, k, addressLabel }: { list: PortalAppt[]; k: PortalCase; addressLabel: string }) {
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
                {dateLong(a.start)}{a.allDay ? '' : <>, <span className="ltr">{time(a.start)}–{time(a.end)}</span></>}
                {!isToday && days > 0 && days <= 7 ? ` · בעוד ${days === 1 ? 'יום' : `${days} ימים`}` : ''}
              </div>
              {a.team.length > 0 && <div className="s">{a.type === 'service' || a.type === 'maintenance' ? 'הטכנאי' : 'הצוות'}: {joinNames(a.team)}</div>}
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

// ---------- מסמכים (ושליחת קובץ למשרד) ----------
function DocsSection({ m, a }: { m: Model; a: Actions }) {
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const quote = m.quote
  async function pick(files: File[]) {
    for (const f of files) {
      if (f.size > UPLOAD_MAX) {
        toast.error(`${f.name}: עד 10MB לקובץ`)
        continue
      }
      setBusy(true)
      try {
        await a.upload(f)
        toast.success('הקובץ התקבל, תודה!')
      } catch (e) {
        toast.error((e as Error).message)
      } finally {
        setBusy(false)
      }
    }
  }
  return (
    <section className="pt-card">
      <div className="pt-card-head">
        <h2><FileText size={18} /> המסמכים שלכם</h2>
        <button className="btn sm" onClick={() => ref.current?.click()} disabled={busy}><Paperclip size={15} /> {busy ? 'שולח...' : 'שליחת תמונה או מסמך'}</button>
        <input ref={ref} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => { void pick(Array.from(e.target.files ?? [])); e.target.value = '' }} />
      </div>
      <div className="pt-list">
        {quote?.status === 'approved' && (
          <button className="pt-item pt-item-btn" onClick={() => a.printQuote(quote)}>
            <span className="ic"><FileSignature size={19} /></span>
            <div className="grow">
              <div className="nm">הצעת מחיר חתומה <span className="ltr">{quote.number}</span></div>
              <div className="mt">נחתמה {quote.signature ? date(quote.signature.at) : ''} · לצפייה ולהדפסה</div>
            </div>
            <Printer size={17} className="muted" />
          </button>
        )}
        {m.docs.map((d) => (
          <button key={d.id} className="pt-item pt-item-btn" onClick={() => void a.openDoc(d).catch((e) => toast.error((e as Error).message))}>
            <span className="ic"><FileText size={19} /></span>
            <div className="grow">
              <div className="nm">{d.name.replace(/\.pdf$/i, '')}</div>
              <div className="mt">{date(d.uploadedAt)}{d.size ? <> · <span className="ltr">{sizeLabel(d.size)}</span></> : ''}{d.fromCustomer ? ' · נשלח מכם' : ''}{d.href || d.doc?.blobKey || d.doc?.fileId ? '' : ' · נשלח לפי בקשה'}</div>
            </div>
            {!(d.href || d.doc?.blobKey || d.doc?.fileId) && <span className="small" style={{ color: 'var(--brand-700)', fontWeight: 600 }}>בקשת עותק</span>}
          </button>
        ))}
        {m.docs.length === 0 && quote?.status !== 'approved' && <div className="small muted">עוד אין מסמכים. אפשר לשלוח לנו כאן תמונות של המזגן הקיים, תוכניות או כל מסמך אחר.</div>}
      </div>
    </section>
  )
}

// ---------- קריאת שירות ----------
function ServiceSection({ m, a }: { m: Model; a: Actions }) {
  const units = m.units
  const [unitId, setUnitId] = useState('')
  const [symptom, setSymptom] = useState<ServiceCall['symptom']>()
  const [code, setCode] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ number: string; underWarranty?: boolean | null } | null>(null)

  async function submit() {
    if (!symptom && text.trim().length < 3) return toast.error('ספרו לנו בקצרה מה קרה')
    setBusy(true)
    try {
      setDone(await a.service({ unitId: unitId || undefined, symptom, errorCode: symptom === 'error_code' && code.trim() ? code.trim().toUpperCase() : undefined, text: text.trim() }))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
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
            <div className="small">נחזור אליכם לתיאום ביקור, בדרך כלל באותו יום עבודה.{done.underWarranty ? ' היחידה באחריות.' : ''} אפשר לשלוח תמונה בחלק "המסמכים שלכם".</div>
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
          <button className="btn dark lg block" disabled={busy} onClick={() => void submit()}><Wrench size={17} /> {busy ? 'שולח...' : 'פתיחת קריאת שירות'}</button>
        </div>
      )}
    </section>
  )
}

// ---------- צ'אט עם המשרד (Message, channel 'portal': in = מהלקוח, out = תשובת הצוות) ----------
function ChatSection({ m, a }: { m: Model; a: Actions }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  const count = m.messages.length
  useEffect(() => {
    if (count) end.current?.scrollIntoView({ block: 'nearest' })
  }, [count])
  async function send(e: FormEvent) {
    e.preventDefault()
    const body = text.trim()
    if (!body) return
    setBusy(true)
    try {
      await a.send(body)
      setText('')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="pt-card">
      <div className="pt-card-head">
        <div>
          <h2><MessageCircle size={18} /> כתבו לנו</h2>
          <div className="sub">הודעה כאן מגיעה ישר לצוות שמטפל בכם. התשובה תופיע כאן.</div>
        </div>
      </div>
      {count > 0 && (
        <div className="pt-chat" aria-live="polite">
          {m.messages.map((x) => (
            <div key={x.id} className={`pt-msg ${x.direction === 'in' ? 'me' : 'them'}`}>
              <div className="b">{x.body}</div>
              <div className="w">{x.direction === 'in' ? 'אתם' : x.by || brand.name} · <span className="ltr">{time(x.at)}</span>{sameDay(x.at, new Date()) ? '' : ` · ${date(x.at)}`}</div>
            </div>
          ))}
          <div ref={end} />
        </div>
      )}
      <form className="pt-chat-form" onSubmit={send}>
        <textarea className="textarea" rows={2} value={text} maxLength={2000} placeholder="למשל: אפשר להקדים את ההתקנה?" onChange={(e) => setText(e.target.value)} aria-label="ההודעה שלכם"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit() } }} />
        <button className="btn primary" type="submit" disabled={busy || !text.trim()} aria-label="שליחה"><Send size={17} /> שליחה</button>
      </form>
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
