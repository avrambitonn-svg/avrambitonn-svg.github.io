import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  CalendarPlus, ClipboardList, Copy, ExternalLink, FileText, FolderOpen, History, Link2, MessageCircle, MessagesSquare, Pencil, Plus, Send, Sparkles, Trash2, Wallet, Ruler, Eye, ListChecks,
} from 'lucide-react'
import { useApp, useMe } from '../../lib/store'
import { Badge, Callout, Card, Empty, Field, Modal, PhotoInput, Tabs, toast } from '../../components/ui'
import { Dictate, QR } from '../../components/extras'
import {
  appointmentStatusLabel, appointmentTypeColor, appointmentTypeLabel, pipeline, projectTypeLabel, quoteStatusLabel, quoteStatusTone, sourceLabel, stageLabel, stageTone, syncLabel, syncTone, tagLabel,
} from '../../lib/labels'
import { date, dateTime, money, nowIso, phone, relative, time, uid } from '../../lib/format'
import { totals } from '../../lib/quote'
import { createQuote, setStage, touchCase } from '../../lib/actions'
import { addressText, mapsEmbed, portalUrl, shareOrCopy } from '../../lib/integrations/links'
import { fill, sendMessage, templates, type TemplateKey } from '../../lib/messaging'
import { AIQuoteDialog } from '../../features/quotes/AIQuoteDialog'
import { ScheduleDialog } from '../../features/schedule/ScheduleDialog'
import { DocsPanel } from '../../features/docs/DocsPanel'
import { MoneyTab } from '../../features/money/MoneyTab'
import { CaseCustomerCard } from '../../features/case/CaseCustomerCard'
import { CaseTeamCard } from '../../features/case/CaseTeamCard'
import { CaseChat } from '../../features/chat/CaseChat'
import { TasksPanel } from '../../features/tasks/TasksPanel'
import { FlowPanel } from '../../features/flow/FlowPanel'
import type { Activity, AppointmentType, CaseStage, Photo, Survey, SurveyRoom } from '../../lib/types'

type Tab = 'overview' | 'survey' | 'quotes' | 'schedule' | 'tasks' | 'docs' | 'money' | 'chat' | 'history' | 'portal'

const photoTags: Record<NonNullable<Photo['tag']>, string> = {
  existing_unit: 'מזגן קיים', nameplate: 'לוחית יצרן', wall: 'קיר / מיקום', electric_panel: 'לוח חשמל', outdoor: 'מיקום חיצוני', room: 'חדר', before: 'לפני', after: 'אחרי', other: 'אחר',
}
const nextStepText: Partial<Record<CaseStage, string>> = {
  lead: 'לחזור ללקוח ולקבוע סקר בשטח',
  survey: 'להשלים את הסקר (חדרים, מידות ותמונות) ולבנות טיוטת הצעה',
  quote: 'לשלוח את ההצעה ולעקוב אחרי הצפייה של הלקוח',
  approved: 'לתאם מועד התקנה ולהזמין ציוד',
  scheduled: 'לוודא ציוד, צוות ומנוף לפני יום ההתקנה',
  installing: 'הצוות בשטח: מעקב אחרי הצ׳קליסט וחתימת מסירה',
  completed: 'לגבות יתרה, להציע חוזה תחזוקה ולבקש חוות דעת',
}

export default function CasePage() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const nav = useNavigate()
  const me = useMe()
  const db = useApp((s) => s.db)
  const patch = useApp((s) => s.patch)
  const k = db.cases.find((x) => x.id === id)
  const [tab, setTab] = useState<Tab>('overview')
  const [aiOpen, setAiOpen] = useState(false)
  const [sched, setSched] = useState<AppointmentType | null>(null)
  const [msgOpen, setMsgOpen] = useState<TemplateKey | null>(null)
  const [lostOpen, setLostOpen] = useState(false)

  useEffect(() => {
    if (params.get('schedule') === 'survey') {
      setSched('survey')
      params.delete('schedule')
      setParams(params, { replace: true })
    }
  }, [])

  const quotes = useMemo(() => db.quotes.filter((q) => q.caseId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [db.quotes, id])
  const appts = useMemo(() => db.appointments.filter((a) => a.caseId === id).sort((a, b) => a.start.localeCompare(b.start)), [db.appointments, id])
  const msgs = useMemo(() => db.messages.filter((m) => m.caseId === id).sort((a, b) => a.at.localeCompare(b.at)), [db.messages, id])
  const docs = useMemo(() => db.docs.filter((d) => d.caseId === id), [db.docs, id])
  const tasks = useMemo(() => db.tasks.filter((t) => t.caseId === id), [db.tasks, id])

  if (!k) return <Card><Empty title="התיק לא נמצא"><Link to="/cases">חזרה לתיקים</Link></Empty></Card>

  const c = db.customers.find((x) => x.id === k.customerId)
  const addr = c?.addresses.find((a) => a.id === k.addressId) ?? c?.addresses[0]
  const contacts = db.contacts.filter((x) => k.contactIds.includes(x.id))
  const primary = contacts.find((x) => x.primary) ?? contacts[0]
  const team = [k.agentId, k.engineerId, k.managerId, ...k.installerIds].filter(Boolean).map((u) => db.users.find((x) => x.id === u)).filter((u, i, arr) => u && arr.indexOf(u) === i)
  const activeQuote = quotes.find((q) => q.status === 'approved') ?? quotes[0]
  const canSeeMoney = me.role === 'admin' || me.role === 'office'
  const firstName = (c?.name ?? '').replace(/^משפחת /, '')
  const portal = portalUrl(k.portal.token)
  const stageIdx = pipeline.indexOf(k.stage)

  const openWhatsapp = (key: TemplateKey) => setMsgOpen(key)

  return (
    <div className="col" style={{ gap: 16 }}>
      {params.get('welcome') === '1' && c && (
        <Callout tone="success">
          <div className="row between wrap">
            <span>התיק נפתח. שלחו ללקוח קישור לאזור האישי שלו, כדי שיוכל לעקוב ולשלוח תמונות.</span>
            <button className="btn sm wa" onClick={() => { void sendMessage({ to: primary?.phone ?? c.phone, body: fill(templates.portal.text, { name: firstName, portal }), caseId: k.id, customerId: c.id, templateKey: 'portal' }); params.delete('welcome'); setParams(params, { replace: true }) }}>
              <MessageCircle size={15} /> שליחה בוואטסאפ
            </button>
          </div>
        </Callout>
      )}

      <Card>
        <div className="card-body">
          <div className="row between wrap" style={{ alignItems: 'flex-start' }}>
            <div className="grow" style={{ minWidth: 260 }}>
              <div className="row wrap" style={{ gap: 8 }}>
                <span className="badge muted num">{k.number}</span>
                <Badge tone={stageTone[k.stage]} dot>{stageLabel[k.stage]}</Badge>
                <Badge>{projectTypeLabel[k.projectType]}</Badge>
                {k.priority !== 'normal' && <Badge tone="danger">{k.priority === 'urgent' ? 'דחוף' : 'עדיפות גבוהה'}</Badge>}
                {k.tags.map((t) => <Badge key={t} tone="brand">{tagLabel(t)}</Badge>)}
              </div>
              <h1 className="mt8" style={{ fontSize: 24 }}>{k.title}</h1>
              <div className="small muted mt8">
                {c ? <><Link to={`/customers/${c.id}`}>{c.name}</Link> · {addressText(addr)}{addr?.floor ? `, קומה ${addr.floor}` : ''}</> : <span style={{ color: 'var(--warning)', fontWeight: 600 }}>ללא לקוח</span>} · נפתח {date(k.createdAt)} · {sourceLabel[k.source]}
              </div>
            </div>
            <div className="row wrap">
              <select
                className="select sm"
                style={{ width: 'auto' }}
                value={k.stage}
                onChange={(e) => {
                  const v = e.target.value as CaseStage
                  if (v === 'lost') setLostOpen(true)
                  else setStage(k.id, v)
                }}
              >
                {[...pipeline, 'lost' as const].map((s) => <option key={s} value={s}>{stageLabel[s]}</option>)}
              </select>
              <button className="btn sm" onClick={() => setSched(k.stage === 'lead' ? 'survey' : 'installation')}><CalendarPlus size={15} /> שיבוץ</button>
              <button className="btn sm primary" onClick={() => setAiOpen(true)}><Sparkles size={15} /> הצעה מ-AI</button>
              <button className="btn sm wa" onClick={() => openWhatsapp(k.stage === 'quote' ? 'quote' : 'portal')}><MessageCircle size={15} /> וואטסאפ</button>
            </div>
          </div>

          {k.stage !== 'lost' && (
            <div className="row mt16" style={{ gap: 4 }}>
              {pipeline.slice(0, 7).map((s, i) => (
                <div key={s} className="grow" title={stageLabel[s]}>
                  <div style={{ height: 6, borderRadius: 4, background: i <= stageIdx ? 'var(--brand)' : 'var(--line)' }} />
                  <div className="tiny mt8 hide-mobile" style={{ color: i === stageIdx ? 'var(--ink)' : 'var(--text-3)', fontWeight: i === stageIdx ? 700 : 400 }}>{stageLabel[s]}</div>
                </div>
              ))}
            </div>
          )}
          {k.stage === 'lost' && k.lostReason && <div className="mt12"><Callout tone="danger">לא נסגר: {k.lostReason}</Callout></div>}
        </div>
      </Card>

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'overview', label: 'סקירה', icon: <ClipboardList size={15} /> },
          { id: 'survey', label: 'סקר בשטח', icon: <Ruler size={15} />, count: k.survey.photos.length },
          { id: 'quotes', label: 'הצעות מחיר', icon: <FileText size={15} />, count: quotes.length },
          { id: 'schedule', label: 'תיאום', icon: <CalendarPlus size={15} />, count: appts.length },
          { id: 'tasks', label: 'משימות', icon: <ListChecks size={15} />, count: tasks.filter((t) => !t.done).length },
          { id: 'docs', label: 'מסמכים', icon: <FolderOpen size={15} />, count: docs.length },
          ...(canSeeMoney ? [{ id: 'money' as Tab, label: 'כספים', icon: <Wallet size={15} /> }] : []),
          { id: 'chat', label: 'צ׳אט והודעות', icon: <MessagesSquare size={15} />, count: msgs.length },
          { id: 'history', label: 'היסטוריה', icon: <History size={15} /> },
          { id: 'portal', label: 'אזור אישי ללקוח', icon: <Link2 size={15} /> },
        ]}
      />

      {tab === 'overview' && (
        <div className="grid g-side">
          <div className="col" style={{ gap: 16 }}>
            <FlowPanel caseId={k.id} />
            {nextStepText[k.stage] && (
              <Callout>
                <b>הצעד הבא: </b>{nextStepText[k.stage]}
              </Callout>
            )}
            <Card title="הצעת המחיר" actions={activeQuote && <Link className="btn sm" to={`/quotes/${activeQuote.id}`}>פתיחה</Link>}>
              {activeQuote ? (
                <div className="card-body">
                  <div className="row between wrap">
                    <div>
                      <div className="row" style={{ gap: 8 }}>
                        <b className="num">{activeQuote.number}</b>
                        <Badge tone={quoteStatusTone[activeQuote.status]}>{quoteStatusLabel[activeQuote.status]}</Badge>
                        {activeQuote.ai && <Badge tone="brand"><Sparkles size={12} /> AI</Badge>}
                      </div>
                      <div className="tiny muted mt8">
                        {activeQuote.lines.length} שורות · בתוקף עד {date(activeQuote.validUntil)}
                        {activeQuote.viewedAt && ` · הלקוח צפה ${relative(activeQuote.viewedAt)}`}
                      </div>
                    </div>
                    <div style={{ textAlign: 'end' }}>
                      <div className="strong num" style={{ fontSize: 22 }}>{money(totals(activeQuote).total)}</div>
                      <div className="tiny muted">כולל מע״מ</div>
                    </div>
                  </div>
                </div>
              ) : (
                <Empty title="אין עדיין הצעת מחיר">
                  <button className="btn sm primary mt8" onClick={() => setAiOpen(true)}><Sparkles size={15} /> טיוטה מהסקר בעזרת AI</button>
                </Empty>
              )}
            </Card>
            <Card title="מועדים קרובים" actions={<button className="btn sm" onClick={() => setSched('installation')}><Plus size={15} /> שיבוץ</button>}>
              {appts.filter((a) => a.status !== 'cancelled' && a.end >= nowIso()).length === 0 ? (
                <Empty title="אין מועדים קרובים" />
              ) : (
                <div className="list">
                  {appts.filter((a) => a.status !== 'cancelled' && a.end >= nowIso()).map((a) => (
                    <Link key={a.id} to={`/field/${a.id}`} className="list-item">
                      <div style={{ width: 4, alignSelf: 'stretch', borderRadius: 4, background: appointmentTypeColor[a.type] }} />
                      <div className="grow">
                        <div className="small strong">{a.title}</div>
                        <div className="tiny muted">{date(a.start)} · <span className="ltr">{time(a.start)}–{time(a.end)}</span> · {appointmentTypeLabel[a.type]}</div>
                      </div>
                      <Badge tone="muted">{appointmentStatusLabel[a.status]}</Badge>
                    </Link>
                  ))}
                </div>
              )}
            </Card>
            {k.notes && <Card title="מה הלקוח ביקש" pad><p className="small" style={{ whiteSpace: 'pre-wrap' }}>{k.notes}</p></Card>}
            <TasksPanel caseId={k.id} compact />
          </div>

          <div className="col" style={{ gap: 16 }}>
            <CaseCustomerCard caseId={k.id} onWhatsapp={() => openWhatsapp('free')} />
            <CaseTeamCard caseId={k.id} />
            {addr && (
              <Card>
                <iframe title="מפה" src={mapsEmbed(addr)} style={{ width: '100%', height: 200, border: 0, borderRadius: 14, display: 'block' }} loading="lazy" />
              </Card>
            )}
          </div>
        </div>
      )}

      {tab === 'survey' && <SurveyTab survey={k.survey} onSave={(s) => { touchCase(k.id, { survey: s }); toast.success('הסקר נשמר') }} onAI={() => setAiOpen(true)} />}

      {tab === 'quotes' && (
        <Card
          title="הצעות מחיר"
          actions={
            <>
              <button className="btn sm" onClick={() => { const q = createQuote(k.id, []); nav(`/quotes/${q.id}`) }}><Plus size={15} /> הצעה ידנית</button>
              <button className="btn sm primary" onClick={() => setAiOpen(true)}><Sparkles size={15} /> טיוטה מ-AI</button>
            </>
          }
        >
          {quotes.length === 0 ? (
            <Empty title="אין הצעות בתיק" />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>מספר</th><th>גרסה</th><th>סטטוס</th><th className="hide-mobile">נוצרה</th><th className="hide-mobile">Priority</th><th className="end">סה״כ כולל מע״מ</th></tr>
                </thead>
                <tbody>
                  {quotes.map((q) => (
                    <tr key={q.id} className="click" onClick={() => nav(`/quotes/${q.id}`)}>
                      <td className="num strong small">{q.number} {q.ai && <Sparkles size={13} color="var(--brand)" />}</td>
                      <td className="small">{q.version}</td>
                      <td><Badge tone={quoteStatusTone[q.status]}>{quoteStatusLabel[q.status]}</Badge></td>
                      <td className="small hide-mobile">{date(q.createdAt)}</td>
                      <td className="hide-mobile"><Badge tone={syncTone[q.sync.status]}>{syncLabel[q.sync.status]}</Badge></td>
                      <td className="end num strong">{money(totals(q).total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'schedule' && (
        <Card
          title="תיאום וביצוע"
          actions={
            <>
              <button className="btn sm" onClick={() => setSched('survey')}>סקר</button>
              <button className="btn sm primary" onClick={() => setSched('installation')}><CalendarPlus size={15} /> התקנה</button>
            </>
          }
        >
          {k.installWindow && <div className="card-body small">חלון התקנה: <b>{date(k.installWindow.from)}{k.installWindow.to !== k.installWindow.from ? ` – ${date(k.installWindow.to)}` : ''}</b></div>}
          {appts.length === 0 ? (
            <Empty title="עוד לא נקבעו מועדים" />
          ) : (
            <div className="list">
              {appts.map((a) => (
                <Link key={a.id} to={`/field/${a.id}`} className="list-item">
                  <div style={{ width: 4, alignSelf: 'stretch', borderRadius: 4, background: appointmentTypeColor[a.type] }} />
                  <div className="grow">
                    <div className="small strong">{a.title}</div>
                    <div className="tiny muted">{dateTime(a.start)} · {a.userIds.map((u) => db.users.find((x) => x.id === u)?.name).join(', ')}</div>
                    {a.checklist.length > 0 && <div className="tiny muted">צ׳קליסט: {a.checklist.filter((x) => x.done).length}/{a.checklist.length}</div>}
                  </div>
                  <Badge tone={a.status === 'done' ? 'success' : a.status === 'in_progress' ? 'warning' : 'muted'}>{appointmentStatusLabel[a.status]}</Badge>
                </Link>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === 'tasks' && <TasksPanel caseId={k.id} />}

      {tab === 'docs' && <DocsPanel caseId={k.id} />}

      {tab === 'money' && canSeeMoney && <MoneyTab caseId={k.id} />}

      {tab === 'chat' && <CaseChat caseId={k.id} onCompose={() => openWhatsapp('free')} />}

      {tab === 'history' && <HistoryTab caseId={k.id} />}

      {tab === 'portal' && (
        <div className="grid g2">
          <Card title="האזור האישי של הלקוח" pad>
            <p className="small muted">דף אישי שבו הלקוח רואה את ההצעה, מאשר וחותם, משלם מקדמה, רואה את מועד ההתקנה ושולח תמונות או קריאת שירות. בלי הורדת אפליקציה ובלי סיסמה.</p>
            <label className="check mt16">
              <input type="checkbox" checked={k.portal.enabled} onChange={(e) => touchCase(k.id, { portal: { ...k.portal, enabled: e.target.checked } })} />
              האזור האישי פעיל
            </label>
            <div className="input mt12 ltr small" style={{ display: 'flex', alignItems: 'center', overflow: 'hidden', whiteSpace: 'nowrap' }}>{portal}</div>
            <div className="row wrap mt12">
              <button className="btn sm" onClick={async () => { const r = await shareOrCopy({ title: k.title, text: `האזור האישי — ${k.title}`, url: portal }); if (r === 'copied') toast.success('הקישור הועתק') }}><Copy size={15} /> העתקה / שיתוף</button>
              <a className="btn sm" href={portal} target="_blank" rel="noreferrer"><ExternalLink size={15} /> תצוגה כמו הלקוח</a>
              <button className="btn sm wa" onClick={() => openWhatsapp('portal')}><Send size={15} /> שליחה בוואטסאפ</button>
            </div>
            <div className="small muted mt12">{k.portal.lastViewedAt ? <><Eye size={14} /> נצפה לאחרונה {relative(k.portal.lastViewedAt)}</> : 'הלקוח עוד לא פתח את הקישור'}</div>
          </Card>
          <Card title="סריקה מהטלפון" pad>
            <div className="row" style={{ justifyContent: 'center' }}><QR text={portal} size={180} /></div>
            <p className="tiny muted mt12" style={{ textAlign: 'center' }}>אפשר להדפיס על הצעת המחיר או על טופס המסירה</p>
          </Card>
        </div>
      )}

      {aiOpen && <AIQuoteDialog caseId={k.id} onClose={() => setAiOpen(false)} onCreated={(qid) => { setAiOpen(false); nav(`/quotes/${qid}`) }} />}
      {sched && <ScheduleDialog type={sched} caseId={k.id} customerId={k.customerId} onClose={() => setSched(null)} />}
      {msgOpen && c && (
        <MessageDialog
          initial={msgOpen}
          vars={{ name: firstName, portal, valid: activeQuote ? date(activeQuote.validUntil) : '', date: k.installWindow ? date(k.installWindow.from) : '', team: team.filter((u) => u?.role === 'installer').map((u) => u!.name.split(' ')[0]).join(' ו') }}
          to={primary?.phone ?? c.phone}
          onClose={() => setMsgOpen(null)}
          onSend={(body, key) => {
            void sendMessage({ to: primary?.phone ?? c.phone, body, caseId: k.id, customerId: c.id, templateKey: key })
            if (key === 'quote' && activeQuote?.status === 'draft') patch('quotes', activeQuote.id, { status: 'sent', sentAt: nowIso() })
            setMsgOpen(null)
          }}
        />
      )}
      {lostOpen && <LostDialog onClose={() => setLostOpen(false)} onSave={(r) => { setStage(k.id, 'lost', r); setLostOpen(false) }} />}
    </div>
  )
}

// ציר הזמן של התיק, עם סינון לפי סוג והוספת הערה
const historyFilters: { id: string; label: string; match: (a: Activity) => boolean }[] = [
  { id: 'all', label: 'הכל', match: () => true },
  { id: 'note', label: 'הערות', match: (a) => a.kind === 'note' && !/^(פלואו|שלב הושלם)/.test(a.text) },
  { id: 'flow', label: 'פלואו', match: (a) => /^(פלואו|שלב הושלם)/.test(a.text) },
  { id: 'stage', label: 'התקדמות', match: (a) => a.kind === 'created' || a.kind === 'stage' },
  { id: 'money', label: 'הצעות ותשלומים', match: (a) => a.kind === 'quote' || a.kind === 'payment' },
  { id: 'appointment', label: 'מועדים', match: (a) => a.kind === 'appointment' },
  { id: 'docs', label: 'מסמכים', match: (a) => a.kind === 'document' },
  { id: 'msg', label: 'הודעות', match: (a) => a.kind === 'message' || a.kind === 'portal' },
  { id: 'sync', label: 'סנכרון', match: (a) => a.kind === 'sync' },
]

function HistoryTab({ caseId }: { caseId: string }) {
  const activities = useApp((s) => s.db.activities)
  const users = useApp((s) => s.db.users)
  const log = useApp((s) => s.log)
  const [filter, setFilter] = useState('all')
  const [note, setNote] = useState('')
  const acts = useMemo(() => activities.filter((a) => a.caseId === caseId), [activities, caseId])
  const f = historyFilters.find((x) => x.id === filter) ?? historyFilters[0]
  const shown = acts.filter(f.match)
  return (
    <Card title={<div className="row"><h2>ציר זמן</h2><span className="badge muted">{acts.length} רשומות</span></div>} pad>
      <form className="row" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (!note.trim()) return; log({ kind: 'note', caseId, text: note.trim() }); setNote(''); setFilter('all') }}>
        <input className="input grow" placeholder="הוספת הערה לתיק..." value={note} onChange={(e) => setNote(e.target.value)} />
        <Dictate onText={(t) => setNote((v) => (v ? `${v} ${t}` : t))} />
        <button className="btn primary" type="submit" disabled={!note.trim()}><Plus size={15} /> הוספה</button>
      </form>
      <div className="row wrap mt12" style={{ gap: 6 }}>
        {historyFilters.filter((x) => x.id === 'all' || acts.some(x.match)).map((x) => (
          <button key={x.id} type="button" className={`chip ${filter === x.id ? 'on' : ''}`} onClick={() => setFilter(x.id)}>{x.label}</button>
        ))}
      </div>
      {shown.length === 0 ? <Empty title="אין רשומות מהסוג הזה" /> : (
        <div className="timeline mt16">
          {shown.map((a) => (
            <div key={a.id} className="tl-item">
              <div className="small">{a.kind === 'note' && !/^(פלואו|שלב הושלם)/.test(a.text) ? <><Badge tone="muted">הערה</Badge> </> : null}{a.text}</div>
              <div className="when">{dateTime(a.at)}{a.userId ? ` · ${users.find((u) => u.id === a.userId)?.name ?? ''}` : ''}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function SurveyTab({ survey, onSave, onAI }: { survey: Survey; onSave: (s: Survey) => void; onAI: () => void }) {
  const me = useMe()
  const [s, setS] = useState<Survey>(survey)
  const [tag, setTag] = useState<NonNullable<Photo['tag']>>('existing_unit')
  const dirty = JSON.stringify(s) !== JSON.stringify(survey)
  const setRoom = (rid: string, p: Partial<SurveyRoom>) => setS({ ...s, rooms: s.rooms.map((r) => (r.id === rid ? { ...r, ...p } : r)) })
  const totalArea = s.rooms.reduce((a, r) => a + (r.areaSqm ?? 0), 0)

  return (
    <div className="col" style={{ gap: 16 }}>
      <Callout>
        <div className="row between wrap">
          <span>ככל שהסקר מלא יותר (שטחים, חשיפה לשמש, תמונה של לוח החשמל ושל המזגן הקיים), טיוטת ההצעה מדויקת יותר.</span>
          <button className="btn sm primary" onClick={() => { if (dirty) onSave({ ...s, doneAt: s.doneAt ?? nowIso(), doneBy: s.doneBy ?? me.id }); onAI() }}><Sparkles size={15} /> בניית טיוטה מהסקר</button>
        </div>
      </Callout>

      <Card title={`חדרים${totalArea ? ` · ${totalArea} מ״ר` : ''}`} actions={<button className="btn sm" onClick={() => setS({ ...s, rooms: [...s.rooms, { id: uid('r'), name: `חדר ${s.rooms.length + 1}`, ceilingM: 2.7, sunExposure: 'medium' }] })}><Plus size={15} /> חדר</button>}>
        {s.rooms.length === 0 ? (
          <Empty title="עוד לא הוזנו חדרים" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>חדר</th><th>שטח (מ״ר)</th><th>תקרה (מ׳)</th><th>חשיפה לשמש</th><th className="hide-mobile">קומה</th><th className="hide-mobile">הערות</th><th /></tr>
              </thead>
              <tbody>
                {s.rooms.map((r) => (
                  <tr key={r.id}>
                    <td><input className="input sm" value={r.name} onChange={(e) => setRoom(r.id, { name: e.target.value })} style={{ minWidth: 120 }} /></td>
                    <td><input className="input sm num" type="number" inputMode="decimal" value={r.areaSqm ?? ''} onChange={(e) => setRoom(r.id, { areaSqm: e.target.value ? Number(e.target.value) : undefined })} style={{ width: 80 }} /></td>
                    <td><input className="input sm num" type="number" step="0.1" value={r.ceilingM ?? ''} onChange={(e) => setRoom(r.id, { ceilingM: e.target.value ? Number(e.target.value) : undefined })} style={{ width: 70 }} /></td>
                    <td>
                      <select className="select sm" value={r.sunExposure ?? ''} onChange={(e) => setRoom(r.id, { sunExposure: (e.target.value || undefined) as SurveyRoom['sunExposure'] })} style={{ width: 100 }}>
                        <option value="">?</option><option value="low">נמוכה</option><option value="medium">בינונית</option><option value="high">גבוהה</option>
                      </select>
                    </td>
                    <td className="hide-mobile"><input className="input sm num" type="number" value={r.floor ?? ''} onChange={(e) => setRoom(r.id, { floor: e.target.value ? Number(e.target.value) : undefined })} style={{ width: 64 }} /></td>
                    <td className="hide-mobile"><input className="input sm" value={r.notes ?? ''} onChange={(e) => setRoom(r.id, { notes: e.target.value })} /></td>
                    <td><button className="icon-btn" onClick={() => setS({ ...s, rooms: s.rooms.filter((x) => x.id !== r.id) })} aria-label="מחיקה"><Trash2 size={16} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="נתוני שטח" pad>
        <div className="grid g3">
          <Field label="אורך צנרת כולל (מ׳)"><input className="input" type="number" value={s.pipeLengthM ?? ''} onChange={(e) => setS({ ...s, pipeLengthM: e.target.value ? Number(e.target.value) : undefined })} /></Field>
          <Field label="מזגנים קיימים לפירוק"><input className="input" type="number" value={s.existingUnitsToRemove ?? ''} onChange={(e) => setS({ ...s, existingUnitsToRemove: e.target.value ? Number(e.target.value) : undefined })} /></Field>
          <Field label="לוח החשמל">
            <select className="select" value={s.electricalReady === undefined ? '' : s.electricalReady ? 'y' : 'n'} onChange={(e) => setS({ ...s, electricalReady: e.target.value === '' ? undefined : e.target.value === 'y' })}>
              <option value="">לא נבדק</option><option value="y">מוכן לנקודות חדשות</option><option value="n">צריך נקודות ייעודיות</option>
            </select>
          </Field>
        </div>
        <div className="row wrap mt12" style={{ gap: 18 }}>
          <label className="check"><input type="checkbox" checked={!!s.workAtHeight} onChange={(e) => setS({ ...s, workAtHeight: e.target.checked })} /> עבודה בגובה</label>
          <label className="check"><input type="checkbox" checked={!!s.craneNeeded} onChange={(e) => setS({ ...s, craneNeeded: e.target.checked })} /> צריך מנוף</label>
        </div>
        <div className="mt16">
          <Field label={<span className="row between"><span>הערות מהשטח</span><Dictate label="הכתבה קולית" onText={(t) => setS((p) => ({ ...p, voiceNotes: ((p.voiceNotes ?? '') + ' ' + t).trim() }))} /></span>}>
            <textarea className="textarea" value={s.voiceNotes ?? ''} onChange={(e) => setS({ ...s, voiceNotes: e.target.value })} placeholder="מה הלקוח ביקש, איפה היחידות החיצוניות, הגבלות של ועד הבית..." />
          </Field>
        </div>
      </Card>

      <Card title={`תמונות (${s.photos.length})`} actions={
        <select className="select sm" style={{ width: 'auto' }} value={tag} onChange={(e) => setTag(e.target.value as NonNullable<Photo['tag']>)}>
          {Object.entries(photoTags).map(([k, v]) => <option key={k} value={k}>תיוג: {v}</option>)}
        </select>
      }>
        <div className="card-body">
          <div className="photo-grid">
            {s.photos.map((p) => (
              <div key={p.id} className="photo">
                <img src={p.dataUrl} alt={p.caption ?? ''} />
                <div className="cap">{p.caption || (p.tag ? photoTags[p.tag] : '')}</div>
                <button className="x" onClick={() => setS({ ...s, photos: s.photos.filter((x) => x.id !== p.id) })} aria-label="הסרה">✕</button>
              </div>
            ))}
            <PhotoInput onAdd={(urls) => setS((p) => ({ ...p, photos: [...p.photos, ...urls.map((dataUrl) => ({ id: uid('p'), dataUrl, tag, caption: photoTags[tag], takenAt: nowIso(), by: me.id }))] }))} />
          </div>
        </div>
      </Card>

      <div className="row" style={{ justifyContent: 'flex-end', position: 'sticky', bottom: 76, zIndex: 5 }}>
        <button className="btn primary lg" disabled={!dirty} onClick={() => onSave({ ...s, doneAt: s.doneAt ?? nowIso(), doneBy: s.doneBy ?? me.id })}>שמירת הסקר</button>
      </div>
    </div>
  )
}

function MessageDialog({ initial, vars, to, onClose, onSend }: { initial: TemplateKey; vars: Record<string, string>; to: string; onClose: () => void; onSend: (body: string, key: TemplateKey) => void }) {
  const [key, setKey] = useState<TemplateKey>(initial)
  const [body, setBody] = useState(fill(templates[initial].text, vars))
  const mode = useApp((s) => s.settings.whatsappMode)
  return (
    <Modal title="הודעה בוואטסאפ" onClose={onClose} footer={<><button className="btn" onClick={onClose}>ביטול</button><button className="btn wa" disabled={!body.trim()} onClick={() => onSend(body, key)}><Send size={15} /> {mode === 'cloud_api' ? 'שליחה' : 'פתיחה בוואטסאפ'}</button></>}>
      <div className="col">
        <Field label="תבנית">
          <select className="select" value={key} onChange={(e) => { const k = e.target.value as TemplateKey; setKey(k); setBody(fill(templates[k].text, vars)) }}>
            {Object.entries(templates).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
          </select>
        </Field>
        <Field label={<span>אל: <span className="ltr">{phone(to)}</span></span>}>
          <textarea className="textarea" style={{ minHeight: 130 }} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <div className="tiny muted">{mode === 'cloud_api' ? 'ההודעה תישלח מהמספר העסקי דרך WhatsApp Business.' : 'ייפתח וואטסאפ עם ההודעה מוכנה. ההודעה תירשם בתיק.'}</div>
      </div>
    </Modal>
  )
}

function LostDialog({ onClose, onSave }: { onClose: () => void; onSave: (reason: string) => void }) {
  const [r, setR] = useState('')
  const reasons = ['מחיר', 'בחרו מתחרה', 'דחו את הפרויקט', 'לא חזרו אלינו', 'לא רלוונטי']
  return (
    <Modal title="למה התיק לא נסגר?" size="narrow" onClose={onClose} footer={<><button className="btn" onClick={onClose}>ביטול</button><button className="btn primary" onClick={() => onSave(r || 'לא צוין')}><Pencil size={15} /> שמירה</button></>}>
      <div className="row wrap mb12">{reasons.map((x) => <button key={x} className={`chip ${r === x ? 'on' : ''}`} onClick={() => setR(x)}>{x}</button>)}</div>
      <input className="input" placeholder="או פירוט חופשי" value={r} onChange={(e) => setR(e.target.value)} />
      <div className="tiny muted mt8">הסיבות מצטברות בדוחות ועוזרות להבין למה מפסידים עסקאות.</div>
    </Modal>
  )
}
