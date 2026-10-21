// שיחה (צוות או לקוח) ותיבת כתיבה: אזכורים, קבצים, עריכה ומחיקה, אישורי קריאה
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, CheckCheck, FileText, Globe, Image as ImageIcon, Paperclip, Pencil, Send, Trash2, X } from 'lucide-react'
import { useApp, useMe } from '../../lib/store'
import { Avatar, Confirm, compressImage, toast } from '../../components/ui'
import { date, dateLong, phone as fmtPhone, sameDay, time } from '../../lib/format'
import { sendMessage } from '../../lib/messaging'
import { safeHref } from '../../lib/integrations/links'
import type { ChatMessage, ID, Message, User } from '../../lib/types'
import {
  type Attachment, convKey, deleteChat, editChat, isCustUnread, isUnread, markConvRead, markThreadRead, parseThread, sendChat, threadMembers,
} from './chat'
import '../ops/ops.css'
import './chat.css'

const MAX_FILE = 1_500_000
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function dayLabel(iso: string) {
  const d = new Date(iso)
  if (sameDay(d, new Date())) return 'היום'
  const y = new Date()
  y.setDate(y.getDate() - 1)
  if (sameDay(d, y)) return 'אתמול'
  return dateLong(iso)
}

// גוף הודעה עם אזכורים מודגשים
function Body({ text, users }: { text: string; users: User[] }) {
  const parts = useMemo(() => {
    const names = users.map((u) => u.name).sort((a, b) => b.length - a.length)
    if (!names.length || !text.includes('@')) return [text]
    const firsts = users.map((u) => u.name.split(' ')[0])
    const re = new RegExp(`(@(?:${[...names, ...firsts].map(esc).join('|')}))`, 'gu')
    return text.split(re)
  }, [text, users])
  return <>{parts.map((p, i) => (i % 2 === 1 ? <span key={i} className="cm-ment">{p}</span> : <Fragment key={i}>{p}</Fragment>))}</>
}

function Atts({ list }: { list?: Attachment[] }) {
  const docs = useApp((s) => s.db.docs)
  if (!list?.length) return null
  return (
    <>
      {list.map((a, i) => {
        const doc = a.docId ? docs.find((d) => d.id === a.docId) : undefined
        const href = safeHref(a.dataUrl ?? doc?.dataUrl ?? doc?.url ?? doc?.webViewLink)
        const mime = a.mime ?? doc?.mime ?? ''
        if (href && mime.startsWith('image/')) return <a key={i} href={href} download={a.name} title={a.name}><img className="cm-img" src={href} alt={a.name} /></a>
        const inner = <><FileText size={15} /> <span>{a.name}</span>{doc && <small>מסמכי התיק</small>}</>
        return href ? <a key={i} className="cm-file" href={href} download={a.name} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer">{inner}</a> : <span key={i} className="cm-file">{inner}</span>
      })}
    </>
  )
}

function ReadMark({ m, members, users }: { m: ChatMessage; members: ID[]; users: User[] }) {
  const others = members.filter((x) => x !== m.fromId)
  const readers = m.readBy.filter((x) => x !== m.fromId)
  const all = others.length > 0 && others.every((x) => readers.includes(x))
  const title = readers.length ? `נקרא ע״י ${readers.map((id) => users.find((u) => u.id === id)?.name).filter(Boolean).join(', ')}` : 'נשלח'
  return <span className={all ? 'read' : ''} title={title} aria-label={title}>{readers.length ? <CheckCheck size={14} /> : <Check size={14} />}</span>
}

// ---------- שיחת צוות ----------
export function TeamConversation({ threadId, active = true, emptyText }: { threadId: string; active?: boolean; emptyText?: ReactNode }) {
  const me = useMe()
  const chat = useApp((s) => s.db.chat)
  const users = useApp((s) => s.db.users)
  const cases = useApp((s) => s.db.cases)
  const msgs = useMemo(() => chat.filter((m) => m.threadId === threadId).sort((a, b) => a.at.localeCompare(b.at)), [chat, threadId])
  const members = useMemo(() => threadMembers({ cases, chat }, threadId), [cases, chat, threadId])
  const [editing, setEditing] = useState<ChatMessage | null>(null)
  const [del, setDel] = useState<ChatMessage | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (active && msgs.some((m) => isUnread(m, me.id))) markThreadRead(threadId, me.id)
  }, [active, msgs, me.id, threadId])
  useLayoutEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [msgs.length, threadId])

  const lastMine = [...msgs].reverse().find((m) => m.fromId === me.id && !m.deleted)
  const seenBy = lastMine && lastMine === [...msgs].reverse().find((m) => !m.deleted) ? lastMine.readBy.filter((x) => x !== me.id) : []
  const userOf = (id: ID) => users.find((u) => u.id === id)

  return (
    <div className="cm-conv">
      <div className="cm-scroll" ref={scroller}>
        {msgs.length === 0 && <div className="cm-empty">{emptyText ?? 'אין עדיין הודעות. כתבו את הראשונה'}</div>}
        {msgs.map((m, i) => {
          const prev = msgs[i - 1]
          const mine = m.fromId === me.id
          const u = userOf(m.fromId)
          const newDay = !prev || !sameDay(prev.at, m.at)
          const head = !mine && (newDay || !prev || prev.fromId !== m.fromId || +new Date(m.at) - +new Date(prev.at) > 15 * 60_000)
          return (
            <Fragment key={m.id}>
              {newDay && <div className="cm-day">{dayLabel(m.at)}</div>}
              <div className={`cm-msg ${mine ? 'me' : 'other'}`} data-msg={m.id}>
                {!mine && <div className="cm-av">{head && <Avatar user={u} />}</div>}
                <div className="cm-wrap">
                  {head && <div className="cm-from">{u?.name ?? 'משתמש'}</div>}
                  <div className={`cm-bub ${m.deleted ? 'del' : ''} ${!mine && m.mentions?.includes(me.id) ? 'mentions-me' : ''}`}>
                    {m.deleted ? 'ההודעה נמחקה' : <><Body text={m.body} users={users} /><Atts list={m.attachments} /></>}
                    <div className="cm-time">
                      {m.editedAt && !m.deleted && <span>נערכה ·</span>}
                      <span className="ltr">{time(m.at)}</span>
                      {mine && !m.deleted && <ReadMark m={m} members={members} users={users} />}
                    </div>
                  </div>
                </div>
                {mine && !m.deleted && (
                  <div className="cm-acts">
                    <button type="button" onClick={() => setEditing(m)} aria-label="עריכת ההודעה" title="עריכה"><Pencil size={13} /></button>
                    <button type="button" onClick={() => setDel(m)} aria-label="מחיקת ההודעה" title="מחיקה"><Trash2 size={13} /></button>
                  </div>
                )}
              </div>
            </Fragment>
          )
        })}
        {seenBy.length > 0 && <div className="cm-seen">נקרא ע״י {seenBy.map((id) => userOf(id)?.name.split(' ')[0]).filter(Boolean).join(', ')}</div>}
      </div>
      <Composer threadId={threadId} members={members} editing={editing} onEndEdit={() => setEditing(null)} />
      {del && <Confirm title="למחוק את ההודעה?" text="ההודעה תימחק לכולם." confirmLabel="מחיקה" danger onClose={() => setDel(null)} onConfirm={() => deleteChat(del)} />}
    </div>
  )
}

function Composer({ threadId, members, editing, onEndEdit }: { threadId: string; members: ID[]; editing: ChatMessage | null; onEndEdit: () => void }) {
  const me = useMe()
  const users = useApp((s) => s.db.users)
  const allDocs = useApp((s) => s.db.docs)
  const p = parseThread(threadId)
  const caseId = p?.kind === 'case' ? p.caseId : undefined
  const docs = useMemo(() => (caseId ? allDocs.filter((d) => d.caseId === caseId) : []), [allDocs, caseId])
  const [text, setText] = useState('')
  const [atts, setAtts] = useState<Attachment[]>([])
  const [mq, setMq] = useState<string | null>(null)
  const [hi, setHi] = useState(0)
  const [attachOpen, setAttachOpen] = useState(false)
  const ta = useRef<HTMLTextAreaElement>(null)
  const file = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) return
    setText(editing.body)
    setAtts([])
    requestAnimationFrame(() => ta.current?.focus())
  }, [editing?.id])
  useEffect(() => {
    setText('')
    setAtts([])
    setMq(null)
  }, [threadId])
  // גובה אוטומטי
  useLayoutEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(120, el.scrollHeight + 2)}px`
  }, [text])

  const sugg = useMemo(() => {
    if (mq === null || !caseId) return []
    const q = mq.toLowerCase()
    return users
      .filter((u) => u.active && u.id !== me.id && (!q || u.name.toLowerCase().includes(q)))
      .sort((a, b) => Number(!members.includes(a.id)) - Number(!members.includes(b.id)))
      .slice(0, 6)
  }, [mq, users, me.id, members, caseId])

  const onInput = (v: string) => {
    setText(v)
    const caret = ta.current?.selectionStart ?? v.length
    const m = /(^|\s)@([^\s@]{0,20})$/.exec(v.slice(0, caret))
    setMq(m ? m[2] : null)
    setHi(0)
  }
  const pick = (u: User) => {
    const el = ta.current
    const caret = el?.selectionStart ?? text.length
    const before = text.slice(0, caret).replace(/@([^\s@]{0,20})$/, `@${u.name} `)
    const next = before + text.slice(caret)
    setText(next)
    setMq(null)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(before.length, before.length)
    })
  }
  const send = () => {
    if (editing) {
      if (!text.trim()) return
      editChat(editing, text)
      onEndEdit()
      setText('')
      return
    }
    if (!sendChat(threadId, text, atts)) return
    setText('')
    setAtts([])
    setMq(null)
  }
  const addFiles = async (files: FileList | null) => {
    for (const f of Array.from(files ?? [])) {
      try {
        if (f.type.startsWith('image/')) {
          const dataUrl = await compressImage(f, 1280, 0.8)
          setAtts((l) => [...l, { name: f.name, mime: 'image/jpeg', dataUrl }])
        } else if (f.size <= MAX_FILE) {
          const dataUrl = await new Promise<string>((res, rej) => {
            const r = new FileReader()
            r.onload = () => res(String(r.result))
            r.onerror = rej
            r.readAsDataURL(f)
          })
          setAtts((l) => [...l, { name: f.name, mime: f.type || 'application/octet-stream', dataUrl }])
        } else toast.error(`${f.name} גדול מדי לצ׳אט (עד 1.5MB). אפשר להעלות אותו למסמכי התיק ולקשר משם`)
      } catch {
        toast.error('לא הצלחנו לקרוא את הקובץ')
      }
    }
    if (file.current) file.current.value = ''
  }

  return (
    <div className="cm-comp">
      {sugg.length > 0 && (
        <div className="cm-pop" role="listbox" aria-label="אזכור">
          {sugg.map((u, i) => (
            <button key={u.id} type="button" role="option" aria-selected={i === hi} className={`opt ${i === hi ? 'on' : ''}`} onMouseDown={(e) => { e.preventDefault(); pick(u) }}>
              <Avatar user={u} /> <span className="grow small strong">{u.name}</span> <span className="tiny muted">{members.includes(u.id) ? 'בצוות' : u.title}</span>
            </button>
          ))}
        </div>
      )}
      {attachOpen && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 4 }} onClick={() => setAttachOpen(false)} />
          <div className="cm-pop">
            <button type="button" className="opt" onClick={() => { setAttachOpen(false); file.current?.click() }}><ImageIcon size={16} /> <span className="grow small">תמונה או קובץ מהמכשיר</span></button>
            {docs.length > 0 && <div className="lbl">מסמך מהתיק</div>}
            {docs.map((d) => (
              <button key={d.id} type="button" className="opt" onClick={() => { setAtts((l) => [...l, { name: d.name, mime: d.mime, docId: d.id }]); setAttachOpen(false) }}>
                <FileText size={16} /> <span className="grow small truncate">{d.name}</span> <span className="tiny muted">{date(d.uploadedAt)}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {editing && (
        <div className="cm-editing"><Pencil size={13} /> <span className="grow">עריכת הודעה</span><button type="button" className="cm-x" onClick={() => { onEndEdit(); setText('') }} aria-label="ביטול עריכה"><X size={14} /></button></div>
      )}
      {atts.length > 0 && (
        <div className="cm-atts">
          {atts.map((a, i) => (
            <span key={i} className="chip"><Paperclip size={13} /> <span>{a.name}</span><button type="button" className="cm-x" onClick={() => setAtts((l) => l.filter((_, j) => j !== i))} aria-label="הסרת הקובץ"><X size={13} /></button></span>
          ))}
        </div>
      )}
      <div className="cm-row">
        {!editing && <button type="button" className="cm-ib" onClick={() => (docs.length ? setAttachOpen((v) => !v) : file.current?.click())} aria-label="צירוף קובץ" title="צירוף קובץ"><Paperclip size={19} /></button>}
        <textarea
          ref={ta}
          className="cm-ta"
          rows={1}
          value={text}
          placeholder={caseId ? 'הודעה לצוות... (@ לאזכור)' : 'הודעה...'}
          aria-label="הודעה"
          onChange={(e) => onInput(e.target.value)}
          onKeyDown={(e) => {
            if (sugg.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
              e.preventDefault()
              setHi((h) => (h + (e.key === 'ArrowDown' ? 1 : sugg.length - 1)) % sugg.length)
              return
            }
            if (sugg.length && (e.key === 'Enter' || e.key === 'Tab')) {
              e.preventDefault()
              pick(sugg[hi] ?? sugg[0])
              return
            }
            if (e.key === 'Escape' && (mq !== null || editing)) {
              e.preventDefault()
              if (mq !== null) setMq(null)
              else { onEndEdit(); setText('') }
              return
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
        />
        <button type="button" className="cm-ib cm-send" onClick={send} disabled={!text.trim() && !atts.length} aria-label={editing ? 'שמירת העריכה' : 'שליחה'}>{editing ? <Check size={18} /> : <Send size={17} style={{ transform: 'scaleX(-1)' }} />}</button>
        <input ref={file} type="file" hidden multiple onChange={(e) => void addFiles(e.target.files)} />
      </div>
    </div>
  )
}

// ---------- שיחה עם לקוח (וואטסאפ / אזור אישי) ----------
export function fillPlaceholders(body: string, installFrom?: string, at?: string) {
  return body.replace('{portal}', '🔗 קישור לאזור האישי').replace('{date}', date(installFrom ?? at))
}

export function CustomerConversation({ caseId, customerId, active = true }: { caseId?: ID; customerId?: ID; active?: boolean }) {
  const me = useMe()
  const messages = useApp((s) => s.db.messages)
  const users = useApp((s) => s.db.users)
  const k = useApp((s) => (caseId ? s.db.cases.find((x) => x.id === caseId) : undefined))
  const custId = k?.customerId ?? customerId
  const customer = useApp((s) => s.db.customers.find((c) => c.id === custId))
  const contacts = useApp((s) => s.db.contacts)
  const key = caseId ? `k:${caseId}` : customerId ? `c:${customerId}` : ''
  const msgs = useMemo(() => messages.filter((m) => convKey(m) === key).sort((a, b) => a.at.localeCompare(b.at)), [messages, key])
  const primary = useMemo(() => {
    const list = contacts.filter((c) => (k ? k.contactIds.includes(c.id) : c.customerId === custId))
    return list.find((c) => c.primary) ?? list[0]
  }, [contacts, k, custId])
  const phoneTo = primary?.phone ?? customer?.phone ?? ''
  const portalOk = !!k?.portal.enabled
  const lastIn = [...msgs].reverse().find((m) => m.direction === 'in')
  const [channel, setChannel] = useState<'portal' | 'whatsapp'>(portalOk && lastIn?.channel !== 'whatsapp' ? 'portal' : 'whatsapp')
  const [text, setText] = useState('')
  const [unreadIds, setUnreadIds] = useState<string[]>([])
  const scroller = useRef<HTMLDivElement>(null)
  const mode = useApp((s) => s.settings.whatsappMode)

  useEffect(() => {
    if (!lastIn) return
    // עונים בערוץ שבו הלקוח פנה לאחרונה
    setChannel(!portalOk || lastIn.channel === 'whatsapp' ? 'whatsapp' : 'portal')
  }, [lastIn?.id, portalOk])
  useEffect(() => {
    const un = msgs.filter(isCustUnread)
    if (!active || !un.length || !key) return
    setUnreadIds((l) => [...new Set([...l, ...un.map((m) => m.id)])])
    markConvRead(key, me.id)
  }, [active, msgs, key, me.id])
  useLayoutEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [msgs.length, key])

  const send = async () => {
    const body = text.trim()
    if (!body) return
    if (channel === 'whatsapp' && !phoneTo.replace(/\D/g, '')) return toast.error('אין מספר טלפון ללקוח')
    await sendMessage({ to: phoneTo, body, channel, caseId, customerId: custId })
    setText('')
    toast.success(channel === 'portal' ? 'התשובה נשלחה לאזור האישי של הלקוח' : mode === 'cloud_api' ? 'נשלח בוואטסאפ' : 'נפתח וואטסאפ עם ההודעה')
  }

  const chLabel = (m: Message) => (m.channel === 'portal' ? 'אזור אישי' : m.channel === 'whatsapp' ? 'וואטסאפ' : m.channel === 'sms' ? 'SMS' : m.channel === 'email' ? 'אימייל' : '')
  return (
    <div className="cm-conv">
      <div className="cc-scroll" ref={scroller}>
        {msgs.length === 0 && <div className="cm-empty">אין הודעות עדיין</div>}
        {msgs.map((m) => (
          <div key={m.id} className={`cc-bub ${m.direction} ${unreadIds.includes(m.id) ? 'unread' : ''}`}>
            <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{fillPlaceholders(m.body, k?.installWindow?.from, m.at)}</div>
            <div className="tiny muted cc-meta">
              {m.channel === 'portal' && <span className="cw-tag"><Globe size={10} /> {chLabel(m)}</span>}
              <span className="ltr">{date(m.at)} {time(m.at)}</span>
              {m.direction === 'out' && m.by ? <span>· {users.find((u) => u.id === m.by)?.name ?? ''}</span> : null}
              {m.direction === 'in' && m.readAt && unreadIds.includes(m.id) && <span className="txt-brand">חדש</span>}
            </div>
          </div>
        ))}
      </div>
      <div className="cc-reply">
        <div className="row between wrap" style={{ gap: 6 }}>
          <div className="seg" role="radiogroup" aria-label="ערוץ">
            <button type="button" className={channel === 'portal' ? 'on' : ''} disabled={!portalOk} onClick={() => setChannel('portal')} title={portalOk ? 'הלקוח רואה את התשובה באזור האישי' : 'אין אזור אישי פעיל'}>אזור אישי</button>
            <button type="button" className={channel === 'whatsapp' ? 'on' : ''} onClick={() => setChannel('whatsapp')}>וואטסאפ</button>
          </div>
          <span className="tiny muted">{channel === 'portal' ? 'התשובה תופיע ללקוח באזור האישי' : phoneTo ? <>אל <span className="ltr">{fmtPhone(phoneTo)}</span></> : 'אין טלפון'}</span>
        </div>
        <div className="cm-row">
          <textarea
            className="cm-ta"
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`תשובה ל${customer?.name ?? 'לקוח'}...`}
            aria-label="תשובה ללקוח"
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() } }}
          />
          <button type="button" className="cm-ib cm-send" onClick={() => void send()} disabled={!text.trim()} aria-label="שליחת תשובה"><Send size={17} style={{ transform: 'scaleX(-1)' }} /></button>
        </div>
      </div>
    </div>
  )
}
