// כפתור צ'אט צף: שיחות צוות ופניות לקוחות ("הצ'אטים שלי")
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, FolderKanban, Globe, MessageCircle, MessagesSquare, Plus, Search, X } from 'lucide-react'
import { useApp, useMe } from '../../lib/store'
import { Avatar } from '../../components/ui'
import { relative, time } from '../../lib/format'
import { useMedia } from '../ops/ops'
import type { ID } from '../../lib/types'
import { caseTeam, caseThread, customerConvs, dmThread, seesAllCases, teamThreads, threadInfo, type CustomerConv, type ThreadInfo } from './chat'
import { CustomerConversation, TeamConversation, fillPlaceholders } from './parts'
import './chat.css'

type Tab = 'team' | 'customers'
type View = { tab: Tab; id: string | null; picking?: boolean }

const shortWhen = (iso?: string) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Date.now() - d.getTime() < 20 * 3600_000 && d.getDate() === new Date().getDate() ? time(iso) : relative(iso)
}

export function ChatWidget() {
  const me = useMe()
  const chat = useApp((s) => s.db.chat)
  const cases = useApp((s) => s.db.cases)
  const users = useApp((s) => s.db.users)
  const customers = useApp((s) => s.db.customers)
  const messages = useApp((s) => s.db.messages)
  const serviceCalls = useApp((s) => s.db.serviceCalls)
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<View>({ tab: 'team', id: null })
  const [q, setQ] = useState('')
  const loc = useLocation()
  const nav = useNavigate()
  const mobile = useMedia('(max-width: 700px)')

  const threads = useMemo(() => teamThreads({ chat, cases, users, customers }, me), [chat, cases, users, customers, me])
  const convs = useMemo(() => customerConvs({ messages, cases, customers, serviceCalls }, me), [messages, cases, customers, serviceCalls, me])
  const teamUnread = threads.reduce((n, t) => n + t.unread, 0)
  const custUnread = convs.reduce((n, c) => n + c.unread, 0)
  const total = teamUnread + custUnread

  // קישור מהתראה: ?chat=case:<id> / dm:<a>:<b> / k:<caseId>
  useEffect(() => {
    const sp = new URLSearchParams(loc.search)
    const c = sp.get('chat')
    if (!c) return
    setOpen(true)
    setView({ tab: c.startsWith('k:') || c.startsWith('c:') ? 'customers' : 'team', id: c })
    sp.delete('chat')
    const rest = sp.toString()
    nav({ pathname: loc.pathname, search: rest ? `?${rest}` : '' }, { replace: true })
  }, [loc.search])

  // החלפת משתמש (בורר "צפייה בתור"): סוגרים וחוזרים לרשימה עוד לפני שהשיחה הפתוחה מסומנת כנקראה בשם המשתמש החדש
  const [who, setWho] = useState(me.id)
  if (who !== me.id) {
    setWho(me.id)
    setOpen(false)
    setView((v) => ({ tab: v.tab, id: null }))
  }

  // עבודה בסרגל העליון (חיפוש, התראות) סוגרת את החלון, כדי שלא יסתיר את מה שנפתח שם
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest?.('.topbar')) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('.modal-scrim')) return
      if (view.id || view.picking) setView({ tab: view.tab, id: null })
      else setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, view])

  const back = () => setView({ tab: view.tab, id: null })
  const goCase = (id: ID) => {
    nav(`/cases/${id}`)
    if (mobile) setOpen(false)
  }

  // כותרת השיחה הפתוחה
  const team = view.tab === 'team' && view.id ? threadInfo({ chat, cases, users, customers }, view.id, me) : null
  const conv = view.tab === 'customers' && view.id ? convs.find((c) => c.key === view.id) ?? null : null

  return (
    <>
      <button className={`cw-fab ${open ? 'on' : ''}`} onClick={() => setOpen((v) => !v)} aria-label={open ? 'סגירת הצ׳אט' : `הצ׳אטים שלי${total ? `, ${total} לא נקראו` : ''}`} aria-expanded={open}>
        {open ? <X size={22} /> : <MessagesSquare size={23} />}
        {!open && total > 0 && <span className="cw-badge">{total > 99 ? '99+' : total}</span>}
      </button>
      {open && (
        <div className="cw-panel" role="dialog" aria-label="הצ׳אטים שלי">
          <div className="cw-head">
            {view.id || view.picking ? (
              <>
                <button className="icon-btn" onClick={back} aria-label="חזרה"><ArrowRight size={19} /></button>
                {team ? (
                  <>
                    {team.kind === 'dm' ? <Avatar user={team.other} /> : <span className="cw-ico"><FolderKanban size={18} /></span>}
                    <div className="grow">
                      <div className="t truncate">{team.title}</div>
                      {team.kind === 'case' && team.caseId ? (
                        <div className="row" style={{ gap: 6 }}><span className="s truncate">{team.sub}</span><a className="s nowrap" href={`#/cases/${team.caseId}`} onClick={(e) => { e.preventDefault(); goCase(team.caseId!) }}>פתיחת התיק</a></div>
                      ) : <div className="s truncate">{team.sub}</div>}
                    </div>
                  </>
                ) : conv ? (
                  <>
                    <span className={`cw-ico ${conv.last.channel === 'portal' ? 'portal' : 'wa'}`}>{conv.last.channel === 'portal' ? <Globe size={18} /> : <MessageCircle size={18} />}</span>
                    <div className="grow">
                      <div className="t truncate">{conv.title}</div>
                      <div className="row" style={{ gap: 6 }}><span className="s truncate">{conv.sub}</span>{conv.caseId && <a className="s nowrap" href={`#/cases/${conv.caseId}`} onClick={(e) => { e.preventDefault(); goCase(conv.caseId!) }}>פתיחת התיק</a>}</div>
                    </div>
                  </>
                ) : (
                  <div className="grow"><div className="t">שיחה חדשה</div></div>
                )}
              </>
            ) : (
              <div className="grow"><h2>הצ׳אטים שלי</h2></div>
            )}
            <button className="icon-btn" onClick={() => setOpen(false)} aria-label="סגירה"><X size={19} /></button>
          </div>

          {!view.id && !view.picking && (
            <div className="cw-tabs" role="tablist">
              <button role="tab" aria-selected={view.tab === 'team'} className={view.tab === 'team' ? 'on' : ''} onClick={() => setView({ tab: 'team', id: null })}>שיחות פנים {teamUnread > 0 && <span className="cw-n">{teamUnread}</span>}</button>
              <button role="tab" aria-selected={view.tab === 'customers'} className={view.tab === 'customers' ? 'on' : ''} onClick={() => setView({ tab: 'customers', id: null })}>פניות לקוחות {custUnread > 0 && <span className="cw-n">{custUnread}</span>}</button>
            </div>
          )}

          {view.picking ? (
            <NewChat q={q} setQ={setQ} onPick={(id) => setView({ tab: 'team', id })} />
          ) : view.id && view.tab === 'team' ? (
            <TeamConversation key={view.id} threadId={view.id} emptyText={team?.kind === 'dm' ? `התחילו שיחה עם ${team.title}` : 'עוד אין הודעות בצוות התיק'} />
          ) : view.id && conv ? (
            <CustomerConversation key={view.id} caseId={conv.caseId} customerId={conv.caseId ? undefined : conv.customerId} />
          ) : (
            <>
              <div className="cw-tools">
                <div className="search-box">
                  <Search size={15} className="muted" />
                  <input className="input" placeholder={view.tab === 'team' ? 'חיפוש שיחה או תיק' : 'חיפוש לקוח או תיק'} value={q} onChange={(e) => setQ(e.target.value)} aria-label="חיפוש" />
                </div>
                {view.tab === 'team' && <button className="btn sm" style={{ height: 36 }} onClick={() => { setQ(''); setView({ tab: 'team', id: null, picking: true }) }}><Plus size={15} /> חדשה</button>}
              </div>
              <div className="cw-list">
                {view.tab === 'team' ? <ThreadList list={threads} q={q} meId={me.id} onOpen={(id) => setView({ tab: 'team', id })} /> : <ConvList list={convs} q={q} onOpen={(id) => setView({ tab: 'customers', id })} />}
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
}

function ThreadList({ list, q, meId, onOpen }: { list: ThreadInfo[]; q: string; meId: ID; onOpen: (id: string) => void }) {
  const users = useApp((s) => s.db.users)
  const t = q.trim().toLowerCase()
  const shown = t ? list.filter((x) => `${x.title} ${x.sub ?? ''} ${x.last?.body ?? ''}`.toLowerCase().includes(t)) : list
  if (!shown.length) return <div className="cm-empty">{t ? 'לא נמצאו שיחות' : 'אין עדיין שיחות. אפשר להתחיל שיחה חדשה עם עמית או בצוות של תיק'}</div>
  return (
    <>
      {shown.map((x) => {
        const from = x.last && (x.last.fromId === meId ? 'אני' : users.find((u) => u.id === x.last!.fromId)?.name.split(' ')[0])
        const body = x.last ? (x.last.deleted ? 'ההודעה נמחקה' : x.last.body || (x.last.attachments?.length ? `📎 ${x.last.attachments[0].name}` : '')) : ''
        return (
          <button key={x.id} className={`cw-item ${x.unread ? 'unread' : ''}`} onClick={() => onOpen(x.id)}>
            {x.kind === 'dm' ? <Avatar user={x.other} /> : <span className="cw-ico"><FolderKanban size={18} /></span>}
            <span className="grow">
              <span className="cw-top"><span className="cw-title">{x.title}</span><span className="cw-when">{shortWhen(x.last?.at)}</span></span>
              {x.kind === 'case' && <span className="cw-sub">{x.sub}</span>}
              <span className="cw-top"><span className="cw-prev">{from ? `${from}: ` : ''}{body}</span>{x.unread > 0 && <span className="cw-n">{x.unread}</span>}</span>
            </span>
          </button>
        )
      })}
    </>
  )
}

function ConvList({ list, q, onOpen }: { list: CustomerConv[]; q: string; onOpen: (key: string) => void }) {
  const t = q.trim().toLowerCase()
  const shown = t ? list.filter((x) => `${x.title} ${x.sub} ${x.last.body}`.toLowerCase().includes(t)) : list
  if (!shown.length) return <div className="cm-empty">{t ? 'לא נמצאו פניות' : 'אין פניות מלקוחות'}</div>
  return (
    <>
      {shown.map((x) => (
        <button key={x.key} className={`cw-item ${x.unread ? 'unread' : ''}`} onClick={() => onOpen(x.key)}>
          <span className={`cw-ico ${x.last.channel === 'portal' ? 'portal' : 'wa'}`}>{x.last.channel === 'portal' ? <Globe size={18} /> : <MessageCircle size={18} />}</span>
          <span className="grow">
            <span className="cw-top"><span className="cw-title">{x.title}</span><span className="cw-when">{shortWhen(x.last.at)}</span></span>
            <span className="cw-sub">{x.sub}</span>
            <span className="cw-top">
              <span className="cw-prev">{x.last.direction === 'out' ? 'אנחנו: ' : ''}{fillPlaceholders(x.last.body, x.kase?.installWindow?.from, x.last.at)}</span>
              {x.unread > 0 && <span className="cw-n">{x.unread}</span>}
            </span>
          </span>
        </button>
      ))}
    </>
  )
}

function NewChat({ q, setQ, onPick }: { q: string; setQ: (v: string) => void; onPick: (threadId: string) => void }) {
  const me = useMe()
  const users = useApp((s) => s.db.users)
  const cases = useApp((s) => s.db.cases)
  const t = q.trim().toLowerCase()
  const people = useMemo(() => users.filter((u) => u.active && u.id !== me.id && (!t || u.name.toLowerCase().includes(t))), [users, me.id, t])
  const myCases = useMemo(
    () =>
      cases
        .filter((k) => !['closed', 'lost'].includes(k.stage) && (seesAllCases(me) || caseTeam(k).includes(me.id)))
        .filter((k) => !t || `${k.number} ${k.title}`.toLowerCase().includes(t))
        .sort((a, b) => Number(!caseTeam(a).includes(me.id)) - Number(!caseTeam(b).includes(me.id)) || b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 8),
    [cases, me, t],
  )
  return (
    <>
      <div className="cw-tools">
        <div className="search-box">
          <Search size={15} className="muted" />
          <input className="input" autoFocus placeholder="חיפוש עמית או תיק" value={q} onChange={(e) => setQ(e.target.value)} aria-label="חיפוש עמית או תיק" />
        </div>
      </div>
      <div className="cw-list">
        <div className="cw-sec">שיחה אישית</div>
        {people.map((u) => (
          <button key={u.id} className="cw-item" onClick={() => onPick(dmThread(me.id, u.id))}>
            <Avatar user={u} />
            <span className="grow"><span className="cw-title">{u.name}</span><span className="cw-sub">{u.title}</span></span>
          </button>
        ))}
        {myCases.length > 0 && <div className="cw-sec">צ׳אט צוות בתיק</div>}
        {myCases.map((k) => (
          <button key={k.id} className="cw-item" onClick={() => onPick(caseThread(k.id))}>
            <span className="cw-ico"><FolderKanban size={18} /></span>
            <span className="grow"><span className="cw-title">{k.title}</span><span className="cw-sub num">{k.number}</span></span>
          </button>
        ))}
      </div>
    </>
  )
}
