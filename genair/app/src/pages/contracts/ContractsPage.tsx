// חוזי שירות, טיפולים תקופתיים ואישורים שנתיים (שחרור עשן: דרישה של כבאות והצלה)
import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  AlarmClock, BellRing, CalendarCheck, CalendarClock, CalendarPlus, FileSignature, Flame, MessageCircle, Plus, RefreshCw, Search, Server, ShieldAlert, Snowflake,
  Thermometer, Wallet,
} from 'lucide-react'
import type { Appointment, Contract, ContractType, Customer, ID, InstalledUnit } from '../../lib/types'
import { app, useDB } from '../../lib/store'
import { contractTypeLabel, type Tone } from '../../lib/labels'
import { date, dateShortDay, daysBetween, money, time, uid, ymd } from '../../lib/format'
import { fill, sendMessage, templates } from '../../lib/messaging'
import { Badge, Card, Confirm, Empty, Field, Modal, PageHead, Stat, Tabs, toast } from '../../components/ui'
import { ScheduleDialog } from '../../features/schedule/ScheduleDialog'
import { greetName } from '../../features/quotes/util'
import './contracts.css'

type Live = Contract['status']
type Tab = 'contracts' | 'visits' | 'renewals'

const statusLabel: Record<Live, string> = { proposed: 'הוצע ללקוח', active: 'פעיל', expiring: 'מסתיים בקרוב', expired: 'הסתיים', cancelled: 'בוטל' }
const statusTone: Record<Live, Tone> = { proposed: 'brand', active: 'success', expiring: 'warning', expired: 'danger', cancelled: 'muted' }
const typeColor: Record<ContractType, string> = { maintenance: '#00aeef', smoke_annual: '#e11d48', heating: '#ea580c', vrf_service: '#7c3aed' }
const typeIcon = (t: ContractType, size = 18): ReactNode =>
  t === 'smoke_annual' ? <Flame size={size} /> : t === 'heating' ? <Thermometer size={size} /> : t === 'vrf_service' ? <Server size={size} /> : <Snowflake size={size} />
const typeShort: Record<ContractType, string> = { maintenance: 'מזגנים', smoke_annual: 'שחרור עשן', heating: 'חימום', vrf_service: 'VRF' }

const freqLabel = (m: number) => (m === 1 ? 'כל חודש' : m === 3 ? 'כל רבעון' : m === 6 ? 'כל חצי שנה' : m === 12 ? 'פעם בשנה' : `כל ${m} חודשים`)

function liveStatus(c: Contract, today: string): Live {
  if (c.status === 'cancelled') return 'cancelled'
  if (c.status === 'proposed') return 'proposed'
  if (c.endDate < today) return 'expired'
  if (daysBetween(today, c.endDate) <= 30) return 'expiring'
  return 'active'
}

const inDays = (n: number) => (n === 0 ? 'היום' : n === 1 ? 'מחר' : n === -1 ? 'אתמול' : n > 0 ? `בעוד ${n} ימים` : `לפני ${-n} ימים`)

const addYear = (d: string) => {
  const x = new Date(d + 'T00:00:00')
  x.setFullYear(x.getFullYear() + 1)
  return ymd(x)
}
const addMonths = (d: string, m: number) => {
  const x = new Date(d + 'T00:00:00')
  x.setMonth(x.getMonth() + m)
  return ymd(x)
}

interface Row {
  c: Contract
  customer?: Customer
  live: Live
  visit?: Appointment // ביקור שכבר שובץ
  daysToVisit: number
  daysToEnd: number
  legalDue: boolean
}

export default function ContractsPage() {
  const contracts = useDB((d) => d.contracts)
  const customers = useDB((d) => d.customers)
  const contacts = useDB((d) => d.contacts)
  const appointments = useDB((d) => d.appointments)
  const users = useDB((d) => d.users)
  const [tab, setTab] = useState<Tab>('contracts')
  const [type, setType] = useState<ContractType | 'all'>('all')
  const [term, setTerm] = useState('')
  const [schedule, setSchedule] = useState<Contract | null>(null)
  const [renew, setRenew] = useState<Contract | null>(null)
  const [details, setDetails] = useState<Contract | null>(null)
  const [creating, setCreating] = useState(false)
  const today = ymd()

  const rows: Row[] = useMemo(
    () =>
      contracts.map((c) => {
        const live = liveStatus(c, today)
        const visit = appointments
          .filter((a) => a.contractId === c.id && a.status !== 'cancelled' && a.status !== 'done' && ymd(a.end) >= today)
          .sort((a, b) => a.start.localeCompare(b.start))[0]
        const daysToVisit = daysBetween(today, c.nextVisit)
        const daysToEnd = daysBetween(today, c.endDate)
        const legalDue = c.type === 'smoke_annual' && live !== 'cancelled' && (daysToVisit <= 30 || daysToEnd <= 30)
        return { c, customer: customers.find((x) => x.id === c.customerId), live, visit, daysToVisit, daysToEnd, legalDue }
      }),
    [contracts, customers, appointments, today],
  )

  const running = rows.filter((r) => r.live === 'active' || r.live === 'expiring')
  const monthEnd = ymd(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0))
  const visitsThisMonth = running.filter((r) => r.c.nextVisit <= monthEnd)
  const expiring = rows.filter((r) => r.live === 'expiring')
  const renewals = rows.filter((r) => r.live !== 'cancelled' && r.live !== 'proposed' && (r.daysToEnd <= 60)).sort((a, b) => a.c.endDate.localeCompare(b.c.endDate))
  const legal = rows.filter((r) => r.legalDue).sort((a, b) => a.c.nextVisit.localeCompare(b.c.nextVisit))
  const recurring = running.reduce((s, r) => s + r.c.pricePerYear, 0)

  const filtered = useMemo(() => {
    const s = term.trim()
    return rows
      .filter((r) => type === 'all' || r.c.type === type)
      .filter((r) => !s || r.c.title.includes(s) || r.c.number.toLowerCase().includes(s.toLowerCase()) || (r.customer?.name ?? '').includes(s))
      .sort((a, b) => Number(b.legalDue) - Number(a.legalDue) || rank(a.live) - rank(b.live) || a.c.nextVisit.localeCompare(b.c.nextVisit))
  }, [rows, type, term])

  const contactOf = (customerId: ID) => contacts.find((x) => x.customerId === customerId && x.primary) ?? contacts.find((x) => x.customerId === customerId)

  async function remind(c: Contract) {
    const customer = customers.find((x) => x.id === c.customerId)
    if (!customer) return
    const contact = contactOf(customer.id)
    const name = greetName(contact, customer)
    const body =
      c.status === 'proposed'
        ? fill('שלום {name}, כדי שהמזגנים החדשים ימשיכו לעבוד כמו ביום הראשון, אנחנו מציעים טיפול תקופתי ({freq}) ב-{price} לשנה, כולל ניקוי, בדיקת גז וביקור עדיפות בתקלה. להשבת "כן" ונפעיל. {brand}', { name, freq: freqLabel(c.frequencyMonths), price: money(c.pricePerYear) })
        : c.type === 'smoke_annual'
        ? fill('שלום {name}, מתקרב מועד הבדיקה השנתית של מערכת שחרור העשן. הבדיקה והאישור נדרשים לכבאות והצלה. להשבת "כן" ונתאם מועד. {brand}', { name })
        : fill(templates.maintenance.text, { name })
    await sendMessage({ to: contact?.phone ?? customer.phone, body, customerId: customer.id, templateKey: 'maintenance' })
    toast.success('וואטסאפ נפתח עם התזכורת')
  }

  async function renewMessage(c: Contract) {
    const customer = customers.find((x) => x.id === c.customerId)
    if (!customer) return
    const contact = contactOf(customer.id)
    const body = fill('שלום {name}, חוזה השירות שלכם ({title}) מסתיים ב-{end}. נשמח לחדש לשנה נוספת ב-{price}, כדי שהמערכת תמשיך לעבוד בלי הפתעות. להשבת "כן" ונטפל בהכל. {brand}', {
      name: greetName(contact, customer), title: c.title, end: date(c.endDate), price: money(c.pricePerYear),
    })
    await sendMessage({ to: contact?.phone ?? customer.phone, body, customerId: customer.id, templateKey: 'free' })
    toast.success('וואטסאפ נפתח עם הצעת החידוש')
  }

  function activate(c: Contract) {
    const start = ymd(new Date())
    app().patch('contracts', c.id, { status: 'active', startDate: start, endDate: addYear(start) })
    app().log({ kind: 'note', customerId: c.customerId, text: `הלקוח אישר את חוזה ${c.number} (${money(c.pricePerYear)} לשנה)` })
    toast.success('החוזה הופעל')
  }

  function doRenew(c: Contract) {
    let end = addYear(c.endDate)
    if (end < today) end = addYear(today)
    app().patch('contracts', c.id, { endDate: end, status: 'active' })
    app().log({ kind: 'note', customerId: c.customerId, text: `חוזה ${c.number} חודש עד ${date(end)} (${money(c.pricePerYear)} לשנה)` })
    toast.success(`החוזה חודש עד ${date(end)}`)
  }

  const actions = (r: Row, compact = false) => r.live === 'proposed' ? (
    <>
      <button className="btn sm primary" onClick={() => activate(r.c)}><FileSignature size={15} /> הלקוח אישר</button>
      <button className="btn sm" onClick={() => remind(r.c)} title="הצעת החוזה ללקוח בוואטסאפ"><BellRing size={15} /> {compact ? 'הצעה' : 'הצעה ללקוח'}</button>
    </>
  ) : (
    <>
      <button className={`btn sm ${r.legalDue && !r.visit ? 'primary' : ''}`} onClick={() => setSchedule(r.c)}>
        <CalendarPlus size={15} /> {r.visit ? 'ביקור נוסף' : 'שיבוץ ביקור'}
      </button>
      <button className="btn sm" onClick={() => remind(r.c)} title="תזכורת ללקוח בוואטסאפ"><BellRing size={15} /> {compact ? 'תזכורת' : 'תזכורת ללקוח'}</button>
      {(r.live === 'expiring' || r.live === 'expired' || r.daysToEnd <= 60) && (
        <button className="btn sm" onClick={() => setRenew(r.c)}><RefreshCw size={15} /> חידוש</button>
      )}
    </>
  )

  return (
    <>
      <PageHead
        title="חוזים ותחזוקה"
        sub="חוזי שירות, טיפולים תקופתיים ואישורים שנתיים"
        actions={<button className="btn primary" onClick={() => setCreating(true)}><Plus size={16} /> חוזה חדש</button>}
      />

      {legal.length > 0 && (
        <div className={`ct-alert ${legal.every((r) => r.visit) ? 'ok' : ''}`} role="alert">
          <span className="ico"><ShieldAlert size={22} /></span>
          <div className="grow">
            <h3>אישור שנתי לשחרור עשן: {legal.length === 1 ? 'מערכת אחת דורשת' : `${legal.length} מערכות דורשות`} בדיקה בחודש הקרוב</h3>
            <p>הבדיקה והאישור השנתי נדרשים לכבאות והצלה. בלי אישור בתוקף, הלקוח חשוף לבעיה ברישוי העסק ובביטוח.</p>
            <div className="ct-alert-list">
              {legal.map((r) => (
                <div key={r.c.id} className="ct-alert-row">
                  <Flame size={16} color="#e11d48" />
                  <div className="grow">
                    <div className="strong small">{r.customer?.name}</div>
                    <div className="tiny muted">
                      {r.visit ? `נקבעה בדיקה ל${dateShortDay(r.visit.start)} ב-${time(r.visit.start)}` : `הבדיקה ${r.daysToVisit < 0 ? 'באיחור של' : 'נדרשת'} ${r.daysToVisit < 0 ? `${-r.daysToVisit} ימים` : inDays(r.daysToVisit)}`} · האישור בתוקף עד {date(r.c.endDate)}
                    </div>
                  </div>
                  {r.visit ? <Badge tone="success" dot>שובצה</Badge> : <button className="btn sm primary" onClick={() => setSchedule(r.c)}><CalendarPlus size={15} /> שיבוץ בדיקה</button>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="grid g4 mb16 ct-stats">
        <Stat icon={<FileSignature size={20} />} label="חוזים פעילים" value={running.length} delta={`${rows.filter((r) => r.live === 'expired').length} הסתיימו`} />
        <Stat icon={<AlarmClock size={20} />} tone="warning" label="מסתיימים ב-30 יום" value={expiring.length} delta={expiring.length ? `${money(expiring.reduce((s, r) => s + r.c.pricePerYear, 0))} לחידוש` : 'אין חידושים דחופים'} onClick={() => setTab('renewals')} />
        <Stat icon={<Wallet size={20} />} tone="success" label="הכנסה שנתית חוזרת" value={money(recurring)} delta={`ממוצע ${money(running.length ? recurring / running.length : 0)} לחוזה`} />
        <Stat icon={<CalendarClock size={20} />} tone="violet" label="ביקורים לביצוע החודש" value={visitsThisMonth.length} delta={`${visitsThisMonth.filter((r) => !r.visit).length} עוד לא שובצו`} onClick={() => setTab('visits')} />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'contracts', label: 'חוזים', count: rows.length },
          { id: 'visits', label: 'ביקורים קרובים', count: running.filter((r) => r.daysToVisit <= 30).length },
          { id: 'renewals', label: 'חידושים', count: renewals.length },
        ]}
      />

      {tab === 'contracts' && (
        <>
          <div className="ct-tools">
            <div className="row wrap" style={{ gap: 6 }}>
              <button className={`chip ${type === 'all' ? 'on' : ''}`} onClick={() => setType('all')}>הכל</button>
              {(Object.keys(contractTypeLabel) as ContractType[]).map((t) => (
                <button key={t} className={`chip ${type === t ? 'on' : ''}`} onClick={() => setType(t)}>{typeIcon(t, 14)} {typeShort[t]}</button>
              ))}
            </div>
            <div className="ct-search">
              <Search size={16} />
              <input className="input sm" placeholder="חיפוש לקוח או מספר חוזה" value={term} onChange={(e) => setTerm(e.target.value)} />
            </div>
          </div>
          {filtered.length === 0 ? (
            <Card><Empty title="לא נמצאו חוזים">נסו סינון אחר, או פתחו חוזה חדש.</Empty></Card>
          ) : (
            <div className="ct-grid">
              {filtered.map((r) => (
                <ContractCard key={r.c.id} r={r} onOpen={() => setDetails(r.c)} actions={actions(r, true)} users={users} />
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'visits' && <VisitsTab rows={running} users={users} actions={(r) => actions(r, true)} />}

      {tab === 'renewals' && (
        <Card className="mt16">
          {renewals.length === 0 ? (
            <Empty title="אין חוזים לחידוש ב-60 הימים הקרובים" />
          ) : (
            renewals.map((r) => (
              <div key={r.c.id} className="ct-row">
                <div className={`ct-day ${r.daysToEnd < 0 ? 'late' : ''}`}>
                  <b>{r.daysToEnd < 0 ? -r.daysToEnd : r.daysToEnd}</b>
                  <small>{r.daysToEnd < 0 ? 'ימים באיחור' : 'ימים'}</small>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="t">{r.customer?.name}</div>
                  <div className="s">{r.c.title} · <span className="ltr">{r.c.number}</span></div>
                  <div className="row wrap mt8" style={{ gap: 6 }}>
                    <Badge tone={statusTone[r.live]} dot>{r.daysToEnd < 0 ? `הסתיים ${date(r.c.endDate)}` : `מסתיים ${date(r.c.endDate)}`}</Badge>
                    <Badge tone={r.c.autoRenew ? 'brand' : 'muted'}>{r.c.autoRenew ? 'חידוש אוטומטי' : 'בלי חידוש אוטומטי'}</Badge>
                    <Badge tone="neutral">{money(r.c.pricePerYear)} לשנה</Badge>
                  </div>
                </div>
                <div className="acts">
                  <button className="btn sm" onClick={() => renewMessage(r.c)}><MessageCircle size={15} /> הצעת חידוש</button>
                  <button className="btn sm primary" onClick={() => setRenew(r.c)}><RefreshCw size={15} /> חידוש לשנה</button>
                </div>
              </div>
            ))
          )}
        </Card>
      )}

      {schedule && (
        <ScheduleDialog
          type={schedule.type === 'smoke_annual' ? 'inspection' : 'maintenance'}
          contractId={schedule.id}
          customerId={schedule.customerId}
          title={`${customers.find((c) => c.id === schedule.customerId)?.name ?? ''}: ${schedule.title}`}
          date={schedule.nextVisit >= today ? schedule.nextVisit : undefined}
          onClose={() => setSchedule(null)}
          onScheduled={() => app().log({ kind: 'appointment', customerId: schedule.customerId, text: `שובץ ביקור לחוזה ${schedule.number}` })}
        />
      )}
      {renew && (
        <Confirm
          title={`חידוש ${renew.number}`}
          text={`החוזה "${renew.title}" יוארך עד ${date(addYear(renew.endDate) < today ? addYear(today) : addYear(renew.endDate))} במחיר ${money(renew.pricePerYear)} לשנה, והסטטוס יחזור לפעיל.`}
          confirmLabel="חידוש לשנה"
          onConfirm={() => doRenew(renew)}
          onClose={() => setRenew(null)}
        />
      )}
      {details && <DetailsDialog c={details} onClose={() => setDetails(null)} onSchedule={() => { setSchedule(details); setDetails(null) }} />}
      {creating && <NewContractDialog onClose={() => setCreating(false)} />}
    </>
  )
}

const rank = (s: Live) => ({ proposed: 0, expiring: 1, active: 2, expired: 3, cancelled: 4 })[s]

function ContractCard({ r, actions, onOpen, users }: { r: Row; actions: ReactNode; onOpen: () => void; users: { id: ID; name: string }[] }) {
  const { c } = r
  const nextCls = r.visit ? 'set' : r.daysToVisit < 0 ? 'late' : r.daysToVisit <= 14 ? 'due' : ''
  const team = r.visit?.userIds.map((id) => users.find((u) => u.id === id)?.name.split(' ')[0]).filter(Boolean).join(', ')
  return (
    <div className={`card ct-card ${r.legalDue ? 'legal' : ''}`} style={{ ['--ct' as string]: typeColor[c.type] }}>
      <div className="hd">
        <span className="ct-ico">{typeIcon(c.type)}</span>
        <div className="grow">
          <div className="no">
            <span className="ltr">{c.number}</span>
            <Badge tone={statusTone[r.live]} dot>{statusLabel[r.live]}</Badge>
            {r.legalDue && <Badge tone="danger">נדרש לכבאות</Badge>}
          </div>
          <button className="ttl" onClick={onOpen} style={{ border: 0, background: 'none', padding: 0, textAlign: 'start', cursor: 'pointer', font: 'inherit', fontWeight: 700 }}>{c.title}</button>
          {r.customer && <div className="cust"><Link to={`/customers/${r.customer.id}`}>{r.customer.name}</Link></div>}
          <div className="ct-type">{contractTypeLabel[c.type]}</div>
        </div>
      </div>
      <div className="ct-facts">
        <div><span>יחידות</span><b>{c.unitIds.length || 'כל המבנה'}</b></div>
        <div><span>תדירות</span><b>{freqLabel(c.frequencyMonths)}</b></div>
        <div><span>מחיר שנתי</span><b>{money(c.pricePerYear)}</b></div>
        <div><span>תקופה</span><b>{date(c.startDate)} – {date(c.endDate)}</b></div>
      </div>
      {r.live === 'expired' && (
        <div className="ct-next late">
          <CalendarClock size={16} />
          <div className="grow">החוזה הסתיים {inDays(r.daysToEnd)}. מחדשים כדי להמשיך בביקורים.</div>
        </div>
      )}
      {(r.live === 'active' || r.live === 'expiring') && (
        <div className={`ct-next ${nextCls}`}>
          {r.visit ? <CalendarCheck size={16} /> : <CalendarClock size={16} />}
          <div className="grow">
            {r.visit ? (
              <>שובץ: <b>{dateShortDay(r.visit.start)} {time(r.visit.start)}</b>{team ? ` · ${team}` : ''}</>
            ) : (
              <>ביקור הבא: <b>{dateShortDay(c.nextVisit)}</b> · {r.daysToVisit < 0 ? `באיחור של ${-r.daysToVisit} ימים` : inDays(r.daysToVisit)}</>
            )}
          </div>
        </div>
      )}
      <div className="ct-acts">{actions}</div>
    </div>
  )
}

function VisitsTab({ rows, users, actions }: { rows: Row[]; users: { id: ID; name: string }[]; actions: (r: Row) => ReactNode }) {
  const sorted = [...rows].sort((a, b) => (a.visit?.start.slice(0, 10) ?? a.c.nextVisit).localeCompare(b.visit?.start.slice(0, 10) ?? b.c.nextVisit))
  const groups: { key: string; label: string; cls?: string; list: Row[] }[] = [
    { key: 'late', label: 'באיחור', cls: 'late', list: sorted.filter((r) => !r.visit && r.daysToVisit < 0) },
    { key: 'week', label: '7 הימים הקרובים', list: sorted.filter((r) => (r.visit || r.daysToVisit >= 0) && daysOf(r) <= 7) },
    { key: 'month', label: 'עד 30 יום', list: sorted.filter((r) => (r.visit || r.daysToVisit >= 0) && daysOf(r) > 7 && daysOf(r) <= 30) },
    { key: 'later', label: 'בהמשך', list: sorted.filter((r) => (r.visit || r.daysToVisit >= 0) && daysOf(r) > 30) },
  ].filter((g) => g.list.length)

  if (!groups.length) return <Card className="mt16"><Empty title="אין ביקורים מתוכננים" /></Card>
  return (
    <Card className="mt16">
      {groups.map((g) => (
        <div key={g.key}>
          <div className={`ct-group-h ${g.cls ?? ''}`}>{g.label} · {g.list.length}</div>
          {g.list.map((r) => {
            const day = r.visit ? r.visit.start : r.c.nextVisit
            const team = r.visit?.userIds.map((id) => users.find((u) => u.id === id)?.name).filter(Boolean).join(', ')
            return (
              <div key={r.c.id} className="ct-row">
                <div className={`ct-day ${g.cls ?? ''}`}>
                  <b>{new Date(day.length === 10 ? day + 'T00:00:00' : day).getDate()}</b>
                  <small>{new Intl.DateTimeFormat('he-IL', { month: 'short' }).format(new Date(day.length === 10 ? day + 'T00:00:00' : day))}</small>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="t row" style={{ gap: 6 }}>
                    <span style={{ color: typeColor[r.c.type], display: 'inline-flex' }}>{typeIcon(r.c.type, 15)}</span>
                    {r.customer?.name}
                  </div>
                  <div className="s">{r.c.title} · {r.c.unitIds.length ? `${r.c.unitIds.length} יחידות` : 'כל המבנה'}</div>
                  <div className="row wrap mt8" style={{ gap: 6 }}>
                    {r.visit ? <Badge tone="success" dot>שובץ {dateShortDay(r.visit.start)} {time(r.visit.start)}{team ? ` · ${team}` : ''}</Badge> : <Badge tone={g.cls ? 'danger' : 'warning'} dot>לא שובץ · {inDays(r.daysToVisit)}</Badge>}
                    {r.legalDue && <Badge tone="danger">נדרש לכבאות</Badge>}
                  </div>
                </div>
                <div className="acts">{actions(r)}</div>
              </div>
            )
          })}
        </div>
      ))}
    </Card>
  )
}

const daysOf = (r: Row) => (r.visit ? daysBetween(ymd(), ymd(r.visit.start)) : r.daysToVisit)

function DetailsDialog({ c, onClose, onSchedule }: { c: Contract; onClose: () => void; onSchedule: () => void }) {
  const contracts = useDB((d) => d.contracts)
  const customers = useDB((d) => d.customers)
  const units = useDB((d) => d.units)
  const appointments = useDB((d) => d.appointments)
  const users = useDB((d) => d.users)
  const cur = contracts.find((x) => x.id === c.id) ?? c
  const customer = customers.find((x) => x.id === cur.customerId)
  const myUnits = units.filter((u) => cur.unitIds.includes(u.id))
  const visits = appointments.filter((a) => a.contractId === cur.id).sort((a, b) => b.start.localeCompare(a.start))
  const [cancel, setCancel] = useState(false)
  const patch = (changes: Partial<Contract>) => app().patch('contracts', cur.id, changes)
  return (
    <Modal
      title={<span className="row" style={{ gap: 8 }}><span style={{ color: typeColor[cur.type], display: 'inline-flex' }}>{typeIcon(cur.type)}</span> {cur.title}</span>}
      onClose={onClose}
      footer={
        <>
          {cur.status !== 'cancelled' && <button className="btn ghost danger" onClick={() => setCancel(true)}>ביטול החוזה</button>}
          <span className="grow" />
          <button className="btn" onClick={onClose}>סגירה</button>
          {cur.status !== 'cancelled' && <button className="btn primary" onClick={onSchedule}><CalendarPlus size={15} /> שיבוץ ביקור</button>}
        </>
      }
    >
      <div className="col" style={{ gap: 16 }}>
        <div className="row wrap" style={{ gap: 6 }}>
          <Badge tone={statusTone[liveStatus(cur, ymd())]} dot>{statusLabel[liveStatus(cur, ymd())]}</Badge>
          <Badge tone="muted"><span className="ltr">{cur.number}</span></Badge>
          <Badge tone="neutral">{contractTypeLabel[cur.type]}</Badge>
          {customer && <Link to={`/customers/${customer.id}`} className="small strong">{customer.name}</Link>}
        </div>
        <div className="grid g3" style={{ gap: 10 }}>
          <div><div className="tiny muted">תקופה</div><div className="strong small">{date(cur.startDate)} – {date(cur.endDate)}</div></div>
          <div><div className="tiny muted">תדירות</div><div className="strong small">{freqLabel(cur.frequencyMonths)}</div></div>
          <div><div className="tiny muted">מחיר שנתי</div><div className="strong small">{money(cur.pricePerYear)}</div></div>
        </div>
        <label className="check">
          <input type="checkbox" checked={cur.autoRenew} disabled={cur.status === 'cancelled'} onChange={(e) => patch({ autoRenew: e.target.checked })} />
          <span className="small">חידוש אוטומטי בסוף התקופה</span>
        </label>
        <div>
          <div className="label mb8">יחידות בחוזה</div>
          {myUnits.length ? (
            <div className="ct-units">
              {myUnits.map((u) => (
                <div key={u.id} className="ct-unit" style={{ cursor: 'default' }}>
                  <div className="grow">
                    <div className="small strong">{u.location ? `${u.location} · ` : ''}{u.model}</div>
                    <div className="sn"><span className="ltr">{u.serial}</span> · טיפול אחרון {u.lastServiceAt ? date(u.lastServiceAt) : 'לא נרשם'}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : <div className="small muted">החוזה מכסה את כל המבנה, בלי רשימת יחידות.</div>}
        </div>
        <div>
          <div className="label mb8">ביקורים</div>
          {visits.length ? (
            <div className="col" style={{ gap: 6 }}>
              {visits.map((a) => (
                <div key={a.id} className="row small" style={{ gap: 8 }}>
                  <Badge tone={a.status === 'done' ? 'success' : a.status === 'cancelled' ? 'muted' : 'brand'} dot>{a.status === 'done' ? 'בוצע' : a.status === 'cancelled' ? 'בוטל' : 'מתוכנן'}</Badge>
                  <span>{dateShortDay(a.start)} {time(a.start)}</span>
                  <span className="muted truncate">{a.userIds.map((id) => users.find((u) => u.id === id)?.name).filter(Boolean).join(', ')}</span>
                </div>
              ))}
            </div>
          ) : <div className="small muted">עוד לא נרשמו ביקורים. הביקור הבא מתוכנן ל-{date(cur.nextVisit)}.</div>}
        </div>
        <Field label="הערות">
          <textarea className="textarea" rows={2} value={cur.notes ?? ''} onChange={(e) => patch({ notes: e.target.value })} placeholder="למשל: לתאם מול אב הבית, מפתח בשמירה" />
        </Field>
      </div>
      {cancel && (
        <Confirm
          title="ביטול החוזה"
          danger
          text="החוזה יסומן כמבוטל ולא יופיע בביקורים ובחידושים. אפשר לפתוח חוזה חדש בכל עת."
          confirmLabel="ביטול החוזה"
          onConfirm={() => {
            patch({ status: 'cancelled', autoRenew: false })
            app().log({ kind: 'note', customerId: cur.customerId, text: `חוזה ${cur.number} בוטל` })
            toast.info('החוזה בוטל')
          }}
          onClose={() => setCancel(false)}
        />
      )}
    </Modal>
  )
}

// ---------- חוזה חדש ----------
const rates: Record<ContractType, number> = { maintenance: 290, smoke_annual: 1450, heating: 950, vrf_service: 450 }
const defaultFreq: Record<ContractType, number> = { maintenance: 12, smoke_annual: 12, heating: 12, vrf_service: 6 }

function NewContractDialog({ onClose }: { onClose: () => void }) {
  const customers = useDB((d) => d.customers)
  const allUnits = useDB((d) => d.units)
  const today = ymd()
  const sortedCustomers = useMemo(() => [...customers].sort((a, b) => a.name.localeCompare(b.name, 'he')), [customers])
  const [customerId, setCustomerId] = useState('')
  const [type, setType] = useState<ContractType>('maintenance')
  const [unitIds, setUnitIds] = useState<ID[]>([])
  const [freq, setFreq] = useState(12)
  const [price, setPrice] = useState(0)
  const [priceTouched, setPriceTouched] = useState(false)
  const [title, setTitle] = useState('')
  const [titleTouched, setTitleTouched] = useState(false)
  const [start, setStart] = useState(today)
  const [end, setEnd] = useState(addYear(today))
  const [next, setNext] = useState(addMonths(today, 12))
  const [autoRenew, setAutoRenew] = useState(true)
  const [notes, setNotes] = useState('')

  const units: InstalledUnit[] = useMemo(() => allUnits.filter((u) => u.customerId === customerId), [allUnits, customerId])
  const suggested = rates[type] * (type === 'smoke_annual' || type === 'heating' ? 1 : Math.max(1, unitIds.length)) * Math.max(1, Math.round(12 / freq))
  const autoTitle = `${type === 'smoke_annual' ? 'בדיקה ואישור שנתי — שחרור עשן' : `${freq === 12 ? 'טיפול שנתי' : freq === 6 ? 'תחזוקה חצי-שנתית' : freq === 3 ? 'תחזוקה רבעונית' : 'תחזוקה'} — ${typeShort[type]}`}${unitIds.length && type !== 'smoke_annual' ? ` (${unitIds.length} יחידות)` : ''}`
  const shownPrice = priceTouched ? price : suggested
  const shownTitle = titleTouched ? title : autoTitle
  const ok = !!customerId && shownTitle.trim().length > 2 && shownPrice > 0 && end > start

  function pickType(t: ContractType) {
    setType(t)
    setFreq(defaultFreq[t])
    setNext(addMonths(start, defaultFreq[t]))
  }

  function save() {
    if (!ok) return
    const s = app()
    const c: Contract = {
      id: uid('kt'),
      number: s.nextNumber('contract', 'CT-', 4),
      customerId,
      title: shownTitle.trim(),
      type,
      unitIds,
      frequencyMonths: freq,
      pricePerYear: Math.round(shownPrice),
      startDate: start,
      endDate: end,
      nextVisit: next,
      autoRenew,
      status: 'active',
      notes: notes.trim() || undefined,
    }
    s.upsert('contracts', c)
    s.log({ kind: 'note', customerId, text: `נפתח חוזה ${c.number}: ${c.title}` })
    toast.success(`נפתח חוזה ${c.number}`)
    onClose()
  }

  return (
    <Modal
      title="חוזה חדש"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>ביטול</button>
          <button className="btn primary" disabled={!ok} onClick={save}><FileSignature size={16} /> פתיחת חוזה</button>
        </>
      }
    >
      <div className="col" style={{ gap: 14 }}>
        <Field label="לקוח">
          <select className="select" value={customerId} onChange={(e) => { setCustomerId(e.target.value); setUnitIds([]) }}>
            <option value="">בחירת לקוח</option>
            {sortedCustomers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <div className="field">
          <span className="label">סוג החוזה</span>
          <div className="ct-types">
            {(Object.keys(contractTypeLabel) as ContractType[]).map((t) => (
              <button key={t} type="button" className={`choice ${type === t ? 'on' : ''}`} onClick={() => pickType(t)} style={{ color: type === t ? undefined : 'inherit' }}>
                <span style={{ color: typeColor[t], display: 'inline-flex' }}>{typeIcon(t)}</span>
                <b>{contractTypeLabel[t]}</b>
              </button>
            ))}
          </div>
        </div>
        {customerId && (
          <div className="field">
            <span className="label">יחידות בחוזה {unitIds.length > 0 && <span className="muted">({unitIds.length})</span>}</span>
            {units.length ? (
              <div className="ct-units">
                {units.map((u) => {
                  const on = unitIds.includes(u.id)
                  return (
                    <label key={u.id} className={`ct-unit ${on ? 'on' : ''}`}>
                      <input type="checkbox" checked={on} onChange={() => setUnitIds((ids) => (on ? ids.filter((x) => x !== u.id) : [...ids, u.id]))} />
                      <div className="grow">
                        <div className="small strong">{u.location ? `${u.location} · ` : ''}{u.model}</div>
                        <div className="sn"><span className="ltr">{u.serial}</span> · אחריות עד {date(u.warrantyUntil)}</div>
                      </div>
                    </label>
                  )
                })}
              </div>
            ) : (
              <span className="hint">ללקוח הזה אין יחידות רשומות. אפשר לפתוח חוזה כללי למבנה.</span>
            )}
          </div>
        )}
        <Field label="שם החוזה">
          <input className="input" value={shownTitle} onChange={(e) => { setTitle(e.target.value); setTitleTouched(true) }} />
        </Field>
        <div className="grid g2" style={{ gap: 12 }}>
          <Field label="תדירות ביקורים">
            <select className="select" value={freq} onChange={(e) => { const f = Number(e.target.value); setFreq(f); setNext(addMonths(start, f)) }}>
              {[1, 3, 4, 6, 12].map((m) => <option key={m} value={m}>{freqLabel(m)}</option>)}
            </select>
          </Field>
          <Field label="מחיר לשנה (לפני מע״מ)" hint={!priceTouched ? 'לפי המחירון. אפשר לשנות.' : <button type="button" className="btn ghost sm" style={{ height: 22, padding: '0 6px' }} onClick={() => setPriceTouched(false)}>חזרה למחירון ({money(suggested)})</button>}>
            <input className="input num" inputMode="numeric" value={shownPrice} onChange={(e) => { setPrice(Number(e.target.value.replace(/\D/g, '')) || 0); setPriceTouched(true) }} />
          </Field>
          <Field label="תחילת החוזה">
            <input type="date" className="input" value={start} onChange={(e) => { const v = e.target.value; if (!v) return; setStart(v); setEnd(addYear(v)); setNext(addMonths(v, freq)) }} />
          </Field>
          <Field label="סיום">
            <input type="date" className="input" value={end} onChange={(e) => e.target.value && setEnd(e.target.value)} />
          </Field>
          <Field label="ביקור ראשון">
            <input type="date" className="input" value={next} onChange={(e) => e.target.value && setNext(e.target.value)} />
          </Field>
          <div className="field" style={{ justifyContent: 'flex-end' }}>
            <label className="check" style={{ height: 40 }}>
              <input type="checkbox" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} />
              <span className="small">חידוש אוטומטי</span>
            </label>
          </div>
        </div>
        <Field label="הערות">
          <textarea className="textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {type === 'smoke_annual' && (
          <div className="row small" style={{ gap: 8, color: '#be123c' }}>
            <ShieldAlert size={15} /> בדיקת שחרור עשן מסומנת אוטומטית כשהיא מתקרבת, כדי שהאישור לכבאות לא יפוג.
          </div>
        )}
      </div>
    </Modal>
  )
}

