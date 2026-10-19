import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  CalendarPlus, ClipboardList, Copy, ExternalLink, FileText, FolderOpen, History, Link2, MessageCircle, MessagesSquare, Pencil, Plus, Send, Sparkles, Trash2, Wallet, Ruler, Upload, Eye,
} from 'lucide-react'
import { useApp, useMe } from '../../lib/store'
import { Avatar, Badge, Callout, Card, Empty, Field, Modal, PhotoInput, Tabs, toast } from '../../components/ui'
import { Dictate, QR, QuickContact } from '../../components/extras'
import {
  appointmentStatusLabel, appointmentTypeColor, appointmentTypeLabel, customerTypeLabel, pipeline, projectTypeLabel, quoteStatusLabel, quoteStatusTone, roleLabel, sourceLabel, stageLabel, stageTone, syncLabel, syncTone,
} from '../../lib/labels'
import { date, dateTime, money, nowIso, phone, relative, time, uid, ymd } from '../../lib/format'
import { totals } from '../../lib/quote'
import { createQuote, setStage, touchCase } from '../../lib/actions'
import { addressText, mapsEmbed, portalUrl, shareOrCopy } from '../../lib/integrations/links'
import { fill, sendMessage, templates, type TemplateKey } from '../../lib/messaging'
import { AIQuoteDialog } from '../../features/quotes/AIQuoteDialog'
import { ScheduleDialog } from '../../features/schedule/ScheduleDialog'
import type { AppointmentType, CaseStage, Doc, MoneyLine, Photo, Survey, SurveyRoom } from '../../lib/types'

type Tab = 'overview' | 'survey' | 'quotes' | 'schedule' | 'docs' | 'money' | 'messages' | 'history' | 'portal'

const photoTags: Record<NonNullable<Photo['tag']>, string> = {
  existing_unit: 'מזגן קיים', nameplate: 'לוחית יצרן', wall: 'קיר / מיקום', electric_panel: 'לוח חשמל', outdoor: 'מיקום חיצוני', room: 'חדר', before: 'לפני', after: 'אחרי', other: 'אחר',
}
const folderLabel: Record<Doc['folder'], string> = { office: 'משרד', customer: 'מהלקוח', installer: 'מתקינים', engineering: 'הנדסה', suppliers: 'ספקים', archive: 'ארכיון' }
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
  const upsert = useApp((s) => s.upsert)
  const remove = useApp((s) => s.remove)
  const log = useApp((s) => s.log)
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
  const acts = useMemo(() => db.activities.filter((a) => a.caseId === id), [db.activities, id])
  const docs = useMemo(() => db.docs.filter((d) => d.caseId === id), [db.docs, id])
  const money_ = useMemo(() => db.money.filter((m) => m.caseId === id), [db.money, id])
  const tasks = useMemo(() => db.tasks.filter((t) => t.caseId === id), [db.tasks, id])

  if (!k) return <Card><Empty title="התיק לא נמצא"><Link to="/cases">חזרה לתיקים</Link></Empty></Card>

  const c = db.customers.find((x) => x.id === k.customerId)
  const payer = db.customers.find((x) => x.id === k.payerCustomerId)
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
                {k.tags.map((t) => <Badge key={t} tone="brand">{t}</Badge>)}
              </div>
              <h1 className="mt8" style={{ fontSize: 24 }}>{k.title}</h1>
              <div className="small muted mt8">
                <Link to={`/customers/${c?.id}`}>{c?.name}</Link> · {addressText(addr)}{addr?.floor ? `, קומה ${addr.floor}` : ''} · נפתח {date(k.createdAt)} · {sourceLabel[k.source]}
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
          { id: 'docs', label: 'מסמכים', icon: <FolderOpen size={15} />, count: docs.length },
          ...(canSeeMoney ? [{ id: 'money' as Tab, label: 'כספים', icon: <Wallet size={15} /> }] : []),
          { id: 'messages', label: 'הודעות', icon: <MessagesSquare size={15} />, count: msgs.length },
          { id: 'history', label: 'היסטוריה', icon: <History size={15} /> },
          { id: 'portal', label: 'אזור אישי ללקוח', icon: <Link2 size={15} /> },
        ]}
      />

      {tab === 'overview' && (
        <div className="grid g-side">
          <div className="col" style={{ gap: 16 }}>
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
            {tasks.length > 0 && (
              <Card title="משימות בתיק">
                <div className="list">
                  {tasks.map((t) => (
                    <label key={t.id} className="list-item check">
                      <input type="checkbox" checked={t.done} onChange={() => patch('tasks', t.id, { done: !t.done })} />
                      <span className="grow small" style={{ textDecoration: t.done ? 'line-through' : undefined }}>{t.title}</span>
                      <Avatar user={db.users.find((u) => u.id === t.assigneeId)} />
                    </label>
                  ))}
                </div>
              </Card>
            )}
          </div>

          <div className="col" style={{ gap: 16 }}>
            <Card title="לקוח" pad>
              <div className="strong">{c?.name}</div>
              <div className="small muted">{c && customerTypeLabel[c.type]} · <span className="ltr">{phone(c?.phone)}</span></div>
              {c && (
                <div className="row mt8" style={{ gap: 6 }}>
                  <Badge tone={syncTone[c.sync.status]}>{syncLabel[c.sync.status]} ב-Priority</Badge>
                  {c.temp && <Badge tone="warning">לקוח זמני</Badge>}
                </div>
              )}
              {payer && <div className="small mt8">משלם: <Link to={`/customers/${payer.id}`}>{payer.name}</Link></div>}
              <div className="mt12"><QuickContact phone={primary?.phone ?? c?.phone} address={addr} whatsapp={() => openWhatsapp('free')} /></div>
              {contacts.length > 0 && (
                <div className="mt12 col" style={{ gap: 6 }}>
                  {contacts.map((x) => (
                    <div key={x.id} className="small">{x.name}{x.role ? ` · ${x.role}` : ''} · <span className="ltr">{phone(x.phone)}</span></div>
                  ))}
                </div>
              )}
              {addr?.entryNotes && <div className="small muted mt8">כניסה: {addr.entryNotes}</div>}
            </Card>
            <Card title="צוות" pad>
              <div className="col" style={{ gap: 8 }}>
                {team.length === 0 && <div className="small muted">לא שובץ צוות</div>}
                {team.map((u) => u && (
                  <div key={u.id} className="row">
                    <Avatar user={u} />
                    <div className="grow">
                      <div className="small strong">{u.name}</div>
                      <div className="tiny muted">{roleLabel[u.role]}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
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

      {tab === 'docs' && (
        <DocsTab
          docs={docs}
          onAdd={(d) => { upsert('docs', { ...d, caseId: k.id, uploadedBy: me.id }); log({ kind: 'document', caseId: k.id, text: `הועלה מסמך: ${d.name}` }) }}
          onRemove={(docId) => remove('docs', docId)}
        />
      )}

      {tab === 'money' && canSeeMoney && <MoneyTab caseId={k.id} lines={money_} quoteTotal={activeQuote?.status === 'approved' ? totals(activeQuote, db.catalog) : undefined} />}

      {tab === 'messages' && (
        <Card title="הודעות עם הלקוח" actions={<button className="btn sm wa" onClick={() => openWhatsapp('free')}><MessageCircle size={15} /> הודעה חדשה</button>}>
          {msgs.length === 0 ? (
            <Empty title="אין הודעות עדיין" />
          ) : (
            <div className="card-body col" style={{ gap: 10, background: '#efeae2', borderRadius: '0 0 14px 14px' }}>
              {msgs.map((m) => (
                <div key={m.id} style={{ alignSelf: m.direction === 'out' ? 'flex-start' : 'flex-end', maxWidth: '78%', background: m.direction === 'out' ? '#d9fdd3' : '#fff', borderRadius: 10, padding: '8px 12px', boxShadow: '0 1px 1px rgba(0,0,0,.06)' }}>
                  <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{m.body.replace('{portal}', '🔗 קישור לאזור האישי').replace('{date}', date(k.installWindow?.from ?? m.at))}</div>
                  <div className="tiny muted" style={{ textAlign: 'end' }}>{dateTime(m.at)}{m.direction === 'out' && m.by ? ` · ${db.users.find((u) => u.id === m.by)?.name ?? ''}` : ''}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === 'history' && (
        <Card title="ציר זמן" pad>
          <div className="timeline">
            {acts.map((a) => (
              <div key={a.id} className="tl-item">
                <div className="small">{a.text}</div>
                <div className="when">{dateTime(a.at)}{a.userId ? ` · ${db.users.find((u) => u.id === a.userId)?.name ?? ''}` : ''}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

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

function DocsTab({ docs, onAdd, onRemove }: { docs: Doc[]; onAdd: (d: Doc) => void; onRemove: (id: string) => void }) {
  const [folder, setFolder] = useState<Doc['folder']>('office')
  return (
    <div className="col" style={{ gap: 16 }}>
      <Callout>מסמכים נשמרים בתיק. כשהשרת מחובר ל-Google Drive, לכל תיק נפתחת תיקייה עם אותן תיקיות משנה.</Callout>
      <div className="grid g3">
        {(Object.keys(folderLabel) as Doc['folder'][]).map((f) => {
          const list = docs.filter((d) => d.folder === f)
          return (
            <Card key={f} title={<div className="row"><FolderOpen size={16} color="var(--brand)" /><h2>{folderLabel[f]}</h2><span className="badge muted">{list.length}</span></div>}
              actions={<label className="btn sm ghost" onClick={() => setFolder(f)}><Upload size={15} /><input type="file" hidden onChange={async (e) => {
                const file = e.target.files?.[0]
                if (!file) return
                const small = file.size < 1_500_000
                const dataUrl = small ? await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(file) }) : undefined
                onAdd({ id: uid('d'), folder, name: file.name, mime: file.type || 'application/octet-stream', size: file.size, dataUrl, uploadedAt: nowIso() })
                if (!small) toast.info('קובץ גדול: נשמר שם הקובץ. בייצור הקובץ עצמו עולה ל-Drive.')
                e.target.value = ''
              }} /></label>}>
              {list.length === 0 ? <div className="empty small" style={{ padding: 18 }}>ריק</div> : (
                <div className="list">
                  {list.map((d) => (
                    <div key={d.id} className="list-item">
                      <FileText size={16} className="muted" />
                      <div className="grow">
                        {d.dataUrl ? <a className="small strong" href={d.dataUrl} download={d.name}>{d.name}</a> : <span className="small strong">{d.name}</span>}
                        <div className="tiny muted">{date(d.uploadedAt)}{d.size ? ` · ${Math.round(d.size / 1024)}KB` : ''}</div>
                      </div>
                      <button className="icon-btn" onClick={() => onRemove(d.id)} aria-label="מחיקה"><Trash2 size={15} /></button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}

function MoneyTab({ caseId, lines, quoteTotal }: { caseId: string; lines: MoneyLine[]; quoteTotal?: ReturnType<typeof totals> }) {
  const upsert = useApp((s) => s.upsert)
  const remove = useApp((s) => s.remove)
  const [draft, setDraft] = useState<{ kind: MoneyLine['kind']; category: string; description: string; amount: string }>({ kind: 'expense', category: 'ציוד', description: '', amount: '' })
  const sumOf = (k: MoneyLine['kind']) => lines.filter((l) => l.kind === k).reduce((s, l) => s + l.amount, 0)
  const paid = sumOf('payment')
  const expenses = sumOf('expense')
  const commission = sumOf('commission')
  const budget = sumOf('budget')
  const kindLabel: Record<MoneyLine['kind'], string> = { budget: 'תקציב', expense: 'הוצאה', commission: 'עמלה', payment: 'תשלום מהלקוח' }
  return (
    <div className="grid g-side">
      <Card title="תנועות">
        <form className="row wrap" style={{ padding: '12px 18px', borderBottom: '1px solid var(--line-2)' }} onSubmit={(e) => {
          e.preventDefault()
          if (!draft.amount || !draft.description) return
          upsert('money', { id: uid('mn'), caseId, kind: draft.kind, category: draft.category, description: draft.description, amount: Number(draft.amount), at: ymd() })
          setDraft({ ...draft, description: '', amount: '' })
        }}>
          <select className="select sm" style={{ width: 'auto' }} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as MoneyLine['kind'] })}>
            {Object.entries(kindLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input className="input sm" style={{ width: 110 }} placeholder="קטגוריה" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} />
          <input className="input sm grow" placeholder="תיאור" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          <input className="input sm" style={{ width: 110 }} type="number" placeholder="₪" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
          <button className="btn sm primary" type="submit"><Plus size={15} /></button>
        </form>
        {lines.length === 0 ? <Empty title="אין תנועות" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>תאריך</th><th>סוג</th><th>תיאור</th><th className="end">סכום</th><th /></tr></thead>
              <tbody>
                {lines.sort((a, b) => b.at.localeCompare(a.at)).map((l) => (
                  <tr key={l.id}>
                    <td className="small nowrap">{date(l.at)}</td>
                    <td><Badge tone={l.kind === 'payment' ? 'success' : l.kind === 'expense' ? 'warning' : l.kind === 'commission' ? 'brand' : 'muted'}>{kindLabel[l.kind]}</Badge></td>
                    <td className="small">{l.category} · {l.description}</td>
                    <td className="end num small strong">{money(l.amount)}</td>
                    <td><button className="icon-btn" onClick={() => remove('money', l.id)} aria-label="מחיקה"><Trash2 size={15} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="מאזן התיק" pad>
        {quoteTotal ? (
          <>
            <div className="money-line"><span>הצעה מאושרת (לפני מע״מ)</span><b className="num">{money(quoteTotal.net)}</b></div>
            <div className="money-line"><span>כולל מע״מ</span><span className="num">{money(quoteTotal.total)}</span></div>
            <div className="money-line"><span>שולם עד כה</span><span className="num" style={{ color: 'var(--success)' }}>{money(paid)}</span></div>
            <div className="money-line total"><span>יתרה לגבייה</span><span className="num">{money(Math.max(0, quoteTotal.total - paid))}</span></div>
            <hr className="hr" />
            <div className="money-line"><span>תקציב</span><span className="num">{money(budget)}</span></div>
            <div className="money-line"><span>הוצאות בפועל</span><span className="num">{money(expenses)}</span></div>
            <div className="money-line"><span>עמלות</span><span className="num">{money(commission)}</span></div>
            <div className="money-line total"><span>רווח משוער</span><span className="num" style={{ color: quoteTotal.net - expenses - commission > 0 ? 'var(--success)' : 'var(--danger)' }}>{money(quoteTotal.net - (expenses || quoteTotal.cost) - commission)}</span></div>
            {!expenses && <div className="tiny muted">אין עדיין הוצאות בפועל: הרווח חושב לפי עלות הקטלוג</div>}
          </>
        ) : (
          <Empty title="אין הצעה מאושרת">המאזן יחושב אחרי אישור הלקוח</Empty>
        )}
      </Card>
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
