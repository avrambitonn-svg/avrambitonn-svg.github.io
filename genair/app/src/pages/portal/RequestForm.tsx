// טופס "השאירו פרטים" ציבורי: לקישור מהאתר, מאינסטגרם או מוואטסאפ. כל פנייה נפתחת כליד בתיק חדש.
// מקור הפנייה נקבע מהקישור: #/request?src=instagram | facebook | whatsapp (ברירת מחדל: אתר)
// במסד המשותף הפנייה נשלחת לשרת (/api/public/leads), שפותח לקוח, איש קשר ותיק; במצב הדגמה — בדפדפן הזה.
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Building, Building2, CheckCircle2, CircleHelp, Flame, Home, Landmark, MessageCircle, Phone, RefreshCw, Send, Snowflake, Store, Wind, X, ArrowLeft, Gem,
} from 'lucide-react'
import { brand } from '../../brand'
import { app } from '../../lib/store'
import { publicHeaders, publicServerUrl } from '../../lib/sync/bridge'
import { createCase, createCustomer, touchCase } from '../../lib/actions'
import { projectTypeLabel, sourceLabel } from '../../lib/labels'
import { nowIso, uid } from '../../lib/format'
import { telLink, whatsappLink } from '../../lib/integrations/links'
import type { CustomerType, LeadSource, ProjectType } from '../../lib/types'
import { Wordmark } from '../../components/Layout'
import { PhotoInput } from '../../components/ui'
import { firstName } from '../../features/quotes/util'
import './portal.css'

const typeIcon: Record<ProjectType, ReactNode> = {
  replacement: <RefreshCw size={18} />,
  apartment: <Home size={18} />,
  luxury: <Gem size={18} />,
  commercial: <Store size={18} />,
  institution: <Landmark size={18} />,
  residential_building: <Building2 size={18} />,
  underfloor_heating: <Flame size={18} />,
  smoke_ventilation: <Wind size={18} />,
  other: <CircleHelp size={18} />,
}
const typeOrder: ProjectType[] = ['replacement', 'apartment', 'luxury', 'commercial', 'institution', 'residential_building', 'underfloor_heating', 'smoke_ventilation', 'other']

// כותרת התיק כפי שהמשרד יראה אותה
const titleOf: Record<ProjectType, string> = {
  replacement: 'החלפת מזגן',
  apartment: 'מיזוג דירה',
  luxury: 'מיזוג בית פרטי',
  commercial: 'מיזוג לעסק',
  institution: 'מיזוג מבנה ציבור',
  residential_building: 'בנייה רוויה',
  underfloor_heating: 'חימום תת-רצפתי',
  smoke_ventilation: 'מערכת שחרור עשן',
  other: 'פנייה כללית',
}

const customerTypeOf = (t: ProjectType): CustomerType => (t === 'commercial' ? 'business' : t === 'institution' ? 'institution' : t === 'residential_building' ? 'developer' : 'private')

const cities = ['ירושלים', 'בית שמש', 'מבשרת ציון', 'מעלה אדומים', 'גבעת זאב', 'מודיעין', 'צור הדסה', 'אפרת', 'גוש עציון', 'קריית יערים', 'אבו גוש']

const sourceOf = (src: string | null): LeadSource => {
  const s = (src ?? '').toLowerCase()
  if (s === 'instagram' || s === 'facebook' || s === 'ig' || s === 'fb') return 'facebook'
  if (s === 'whatsapp' || s === 'wa') return 'whatsapp'
  return 'website'
}

// 054-1234567 / 02-1234567 / +972...
function normalizePhone(p: string): string | null {
  let d = p.replace(/\D/g, '')
  if (d.startsWith('972')) d = '0' + d.slice(3)
  if (/^05\d{8}$/.test(d) || /^0[2-9]\d{7}$/.test(d) || /^07\d{8}$/.test(d)) return d
  return null
}

export default function RequestForm() {
  const [params] = useSearchParams()
  const source = useMemo(() => sourceOf(params.get('src')), [params])
  const [name, setName] = useState('')
  const [phoneText, setPhone] = useState('')
  const [city, setCity] = useState('')
  const [type, setType] = useState<ProjectType | null>(null)
  const [text, setText] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const [trap, setTrap] = useState('')
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sendError, setSendError] = useState('')
  const [done, setDone] = useState<Done | null>(null)
  const serverParam = params.get('server')
  const server = publicServerUrl(serverParam)

  useEffect(() => {
    const prev = document.title
    document.title = `השאירו פרטים · ${brand.name}`
    return () => {
      document.title = prev
    }
  }, [])

  const phone = normalizePhone(phoneText)
  const errors = {
    name: name.trim().length < 2 ? 'איך קוראים לכם?' : '',
    phone: !phone ? 'צריך מספר טלפון תקין, למשל 054-1234567' : '',
    type: !type ? 'בחרו את סוג הפרויקט' : '',
  }
  const valid = !errors.name && !errors.phone && !errors.type

  async function submit(e: FormEvent) {
    e.preventDefault()
    setTried(true)
    if (!valid || !phone || !type) return
    if (trap) {
      // בוט: מציגים תודה בלי לפתוח ליד
      setDone({ number: '' })
      return
    }
    if (server) {
      setBusy(true)
      setSendError('')
      try {
        const res = await fetch(`${server}/api/public/leads`, {
          method: 'POST',
          headers: { ...publicHeaders(), 'content-type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), phone, city: city.trim(), type, text: text.trim(), photos, source, website: trap }),
        })
        const body = (await res.json().catch(() => ({}))) as { number?: string; portalToken?: string; error?: { message?: string } }
        if (!res.ok) throw new Error(body.error?.message ?? 'השליחה נכשלה')
        setDone({ number: body.number ?? '', portalToken: body.portalToken ?? undefined })
        window.scrollTo({ top: 0 })
      } catch (err) {
        setSendError((err as Error).message === 'Failed to fetch' ? 'אין חיבור. נסו שוב, או כתבו לנו בוואטסאפ.' : (err as Error).message)
      } finally {
        setBusy(false)
      }
      return
    }
    const s = app()
    const addressId = uid('ad')
    const customer = createCustomer({
      name: name.trim(),
      type: customerTypeOf(type),
      phone,
      addresses: [{ id: addressId, city: city.trim() || 'לא צוין', street: '' }],
      tags: ['פנייה מהאתר'],
      pendingReview: true, // כמו בשרת: לא נשלח ל-Priority עד שהמשרד בודק שאינו כפילות ומאשר
    })
    const contactId = uid('ct')
    s.upsert('contacts', { id: contactId, customerId: customer.id, name: name.trim(), phone, primary: true })
    const k = createCase({
      title: `${titleOf[type]} — ${name.trim()}${city.trim() ? `, ${city.trim()}` : ''}`,
      customerId: customer.id,
      contactIds: [contactId],
      addressId,
      projectType: type,
      source,
      priority: 'normal',
      stage: 'lead',
      notes: text.trim() ? `מהטופס: "${text.trim()}"` : undefined,
    })
    if (photos.length) {
      touchCase(k.id, {
        survey: { ...k.survey, photos: photos.map((dataUrl, i) => ({ id: uid('p'), dataUrl, caption: `תמונה מהלקוח ${i + 1}`, tag: 'other' as const, takenAt: nowIso() })) },
      })
    }
    s.log({ kind: 'created', caseId: k.id, customerId: customer.id, text: `ליד חדש מטופס "השאירו פרטים" (${sourceLabel[source]})${photos.length ? `, ${photos.length} תמונות` : ''}` })
    // createCase כבר מתריע למנהלים; כאן מוסיפים את המשרד
    const me = s.db.users.find((u) => u.id === s.currentUserId)
    s.db.users
      .filter((u) => u.role === 'office' || (u.id === me?.id && u.role === 'admin'))
      .forEach((u) => s.notify(u.id, `ליד חדש מהאתר: ${customer.name}${city.trim() ? `, ${city.trim()}` : ''}`, `/cases/${k.id}`))
    setDone({ number: k.number, portalToken: k.portal.enabled ? k.portal.token : undefined })
    window.scrollTo({ top: 0 })
  }

  if (done) return <ThankYou done={done} name={name.trim()} serverParam={serverParam} />

  return (
    <div className="pt-page" dir="rtl">
      <header className="pt-hero rq-hero">
        <div className="pt-hero-in">
          <div className="pt-top">
            <Wordmark />
            <a className="pt-call" href={telLink(brand.phone)}><Phone size={15} /> <span className="ltr">{brand.phone}</span></a>
          </div>
          <div className="pt-eyebrow">מיזוג אוויר, חימום ואוורור · ירושלים והסביבה</div>
          <h1>השאירו פרטים, ונחזור אליכם</h1>
          <div className="meta" style={{ fontSize: 15, color: '#c9d4de', marginTop: 8 }}>יועץ שלנו יחזור אליכם עוד היום בשעות הפעילות, לייעוץ ולתיאום סקר בשטח. בלי התחייבות.</div>
          <div className="rq-points">
            <span><CheckCircle2 size={15} /> סקר בשטח והצעה מסודרת</span>
            <span><CheckCircle2 size={15} /> התקנה נקייה ובזמן</span>
            <span><CheckCircle2 size={15} /> שירות ואחריות אחרי ההתקנה</span>
          </div>
        </div>
      </header>

      <main className="pt-wrap">
        <form className="pt-card pt-form" onSubmit={submit} noValidate>
          <div className="rq-grid">
            <label className="field">
              <span>שם מלא</span>
              <input className={`input ${tried && errors.name ? 'bad' : ''}`} value={name} autoComplete="name" placeholder="ישראל ישראלי" onChange={(e) => setName(e.target.value)} />
              {tried && errors.name && <span className="rq-err">{errors.name}</span>}
            </label>
            <label className="field">
              <span>טלפון</span>
              <input
                className={`input ${tried && errors.phone ? 'bad' : ''}`}
                value={phoneText}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                dir="ltr"
                style={{ textAlign: 'right' }}
                placeholder="054-1234567"
                onChange={(e) => setPhone(e.target.value)}
              />
              {tried && errors.phone && <span className="rq-err">{errors.phone}</span>}
            </label>
          </div>
          <label className="field">
            <span>עיר / יישוב</span>
            <input className="input" list="rq-cities" value={city} autoComplete="address-level2" placeholder="ירושלים" onChange={(e) => setCity(e.target.value)} />
            <datalist id="rq-cities">{cities.map((c) => <option key={c} value={c} />)}</datalist>
          </label>

          <div className="field">
            <span className="label">מה צריך?</span>
            <div className="rq-types" role="radiogroup" aria-label="סוג הפרויקט">
              {typeOrder.map((t) => (
                <button key={t} type="button" role="radio" aria-checked={type === t} className={`choice ${type === t ? 'on' : ''}`} onClick={() => setType(t)}>
                  {typeIcon[t]}
                  <b>{projectTypeLabel[t]}</b>
                </button>
              ))}
            </div>
            {tried && errors.type && <span className="rq-err">{errors.type}</span>}
          </div>

          <label className="field">
            <span>ספרו לנו בקצרה</span>
            <textarea className="textarea" rows={3} value={text} placeholder="למשל: דירת 4 חדרים, צריך מזגן לכל חדר. יש מזגן ישן בסלון." onChange={(e) => setText(e.target.value)} />
          </label>

          <div className="field">
            <span className="label">תמונות (לא חובה)</span>
            <span className="hint" style={{ marginTop: -2 }}>המזגן הקיים, הקיר, לוח החשמל או המרפסת. עוזר לנו להגיע מוכנים.</span>
            <div className="rq-photos mt8">
              {photos.map((p, i) => (
                <div key={i} className="photo">
                  <img src={p} alt={`תמונה ${i + 1}`} />
                  <button type="button" className="x" aria-label="הסרת תמונה" onClick={() => setPhotos((ps) => ps.filter((_, j) => j !== i))}><X size={14} /></button>
                </div>
              ))}
              {photos.length < 6 && <PhotoInput label="הוספת תמונה" onAdd={(list) => setPhotos((ps) => [...ps, ...list].slice(0, 6))} />}
            </div>
          </div>

          {/* מלכודת לבוטים: שדה שאנשים לא רואים */}
          <label className="rq-hp" aria-hidden="true">
            אתר
            <input tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} />
          </label>

          {sendError && <span className="rq-err" role="alert">{sendError}</span>}
          <button className="btn primary block rq-submit" type="submit" disabled={busy}><Send size={18} /> {busy ? 'שולחים...' : 'שליחה'}</button>
          <p className="rq-privacy">הפרטים משמשים רק כדי לחזור אליכם בנוגע לפנייה. {brand.hours}.</p>
        </form>

        <div className="pt-card rq-alt">
          <div className="txt">
            <div className="strong">מעדיפים לדבר?</div>
            <div className="small muted">אפשר גם לכתוב לנו ישר בוואטסאפ</div>
          </div>
          <a className="btn wa" href={whatsappLink(brand.whatsapp, 'שלום, אשמח לקבל הצעה למיזוג.')} target="_blank" rel="noreferrer"><MessageCircle size={17} /> וואטסאפ</a>
          <a className="btn" href={telLink(brand.phone)}><Phone size={17} /> <span className="ltr">{brand.phone}</span></a>
        </div>
      </main>

      <footer className="pt-foot">
        <Wordmark />
        <div className="slogan">{brand.slogan}</div>
        <div>{brand.address} · <span className="ltr">{brand.phone}</span></div>
      </footer>
    </div>
  )
}

interface Done {
  number: string
  portalToken?: string
}

function ThankYou({ done, name, serverParam }: { done: Done; name: string; serverParam: string | null }) {
  const first = firstName(name)
  const k = { number: done.number || '—' }
  return (
    <div className="pt-page" dir="rtl">
      <header className="pt-hero rq-hero">
        <div className="pt-hero-in">
          <div className="pt-top"><Wordmark /></div>
          <div className="pt-eyebrow">הפנייה התקבלה</div>
          <h1>תודה{first ? ` ${first}` : ''}!</h1>
          <div className="pt-promise"><Snowflake size={15} /> {brand.promise}</div>
        </div>
      </header>
      <main className="pt-wrap">
        <section className="pt-card">
          <div className="pt-success" style={{ paddingTop: 4 }}>
            <span className="big"><CheckCircle2 size={34} /></span>
            <h3>קיבלנו את הפרטים</h3>
            <p>יועץ שלנו יחזור אליכם בהקדם, בדרך כלל באותו יום עבודה. {k.number !== '—' && <>מספר הפנייה: <b className="ltr">{k.number}</b></>}</p>
          </div>
          <div className="pt-list mt16">
            {[
              { icon: <Phone size={18} />, t: 'שיחת היכרות', s: 'מבינים מה צריך ומתאמים מועד שנוח לכם' },
              { icon: <Building size={18} />, t: 'סקר בשטח', s: 'מדידות, בדיקת מיקומים ולוח החשמל' },
              { icon: <Send size={18} />, t: 'הצעת מחיר מסודרת', s: 'לאזור האישי שלכם, עם אפשרות לאשר מהנייד' },
            ].map((x, i) => (
              <div key={i} className="pt-item">
                <span className="ic">{x.icon}</span>
                <div className="grow">
                  <div className="nm">{i + 1}. {x.t}</div>
                  <div className="mt">{x.s}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="pt-cta">
            <a className="btn wa block" href={whatsappLink(brand.whatsapp, `שלום, השארתי פרטים באתר${k.number !== '—' ? ` (פנייה ${k.number})` : ''}.`)} target="_blank" rel="noreferrer">
              <MessageCircle size={18} /> המשך בוואטסאפ
            </a>
            <a className="btn block" href={telLink(brand.phone)}><Phone size={18} /> <span className="ltr">{brand.phone}</span></a>
          </div>
          {done.portalToken && (
            <Link to={`/portal/${done.portalToken}${serverParam ? `?server=${encodeURIComponent(serverParam)}` : ''}`} className="row mt16" style={{ justifyContent: 'center', fontWeight: 600 }}>
              מעקב אחרי הפנייה באזור האישי <ArrowLeft size={16} />
            </Link>
          )}
        </section>
      </main>
      <footer className="pt-foot">
        <Wordmark />
        <div className="slogan">{brand.slogan}</div>
      </footer>
    </div>
  )
}
