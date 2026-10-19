// צ'אט: שרשורים (צוות התיק / שיחה אישית), מי חבר בשרשור, שליחה, קריאה והתראות; ופניות לקוחות לפי תיק
import { app } from '../../lib/store'
import type { Case, ChatMessage, DB, ID, Message, User } from '../../lib/types'
import { nowIso, uid } from '../../lib/format'

export type Attachment = NonNullable<ChatMessage['attachments']>[number]

export const caseThread = (caseId: ID) => `case:${caseId}`
export const dmThread = (a: ID, b: ID) => `dm:${[a, b].sort().join(':')}`

export type ThreadRef = { kind: 'case'; caseId: ID } | { kind: 'dm'; users: [ID, ID] }
export function parseThread(id: string): ThreadRef | null {
  if (id.startsWith('case:')) return { kind: 'case', caseId: id.slice(5) }
  if (id.startsWith('dm:')) {
    const [a, b] = id.slice(3).split(':')
    if (a && b) return { kind: 'dm', users: [a, b] }
  }
  return null
}

const uniq = (ids: (ID | undefined)[]) => [...new Set(ids.filter(Boolean) as ID[])]

// צוות התיק: סוכן, מהנדס, מנהל, מנהלי מחלקה, מנהל פרויקט ומתקינים
export const caseTeam = (k: Case) => uniq([k.agentId, k.engineerId, k.managerId, ...(k.departmentManagerIds ?? []), k.projectManagerId, ...(k.installerIds ?? [])])

// חברים בשרשור: בשיחה אישית שני הצדדים; בתיק הצוות, וכל מי שכתב או הוזכר בו
export function threadMembers(db: Pick<DB, 'cases' | 'chat'>, threadId: string): ID[] {
  const p = parseThread(threadId)
  if (!p) return []
  if (p.kind === 'dm') return [...p.users]
  const k = db.cases.find((x) => x.id === p.caseId)
  const posted = db.chat.filter((m) => m.threadId === threadId).flatMap((m) => [m.fromId, ...(m.mentions ?? [])])
  return uniq([...(k ? caseTeam(k) : []), ...posted])
}

export const isUnread = (m: ChatMessage, me: ID) => m.fromId !== me && !m.deleted && !m.readBy.includes(me)
export const seesAllCases = (u: Pick<User, 'role'>) => u.role === 'admin' || u.role === 'office'

export interface ThreadInfo {
  id: string
  kind: 'case' | 'dm'
  caseId?: ID
  other?: User
  kase?: Case
  title: string
  sub?: string
  last?: ChatMessage
  unread: number
  member: boolean
}

export function threadInfo(db: Pick<DB, 'cases' | 'chat' | 'users' | 'customers'>, id: string, me: User, msgs?: ChatMessage[]): ThreadInfo | null {
  const p = parseThread(id)
  if (!p) return null
  const list = msgs ?? db.chat.filter((m) => m.threadId === id)
  const last = list.reduce<ChatMessage | undefined>((a, m) => (!a || m.at > a.at ? m : a), undefined)
  if (p.kind === 'dm') {
    const otherId = p.users[0] === me.id ? p.users[1] : p.users[0]
    const other = db.users.find((u) => u.id === otherId)
    return { id, kind: 'dm', other, title: other?.name ?? 'שיחה', sub: other?.title, last, unread: list.filter((m) => isUnread(m, me.id)).length, member: p.users.includes(me.id) }
  }
  const kase = db.cases.find((x) => x.id === p.caseId)
  const member = threadMembers(db, id).includes(me.id)
  const cust = kase && db.customers.find((c) => c.id === kase.customerId)
  return {
    id, kind: 'case', caseId: p.caseId, kase, title: kase?.title ?? 'תיק', sub: [kase?.number, cust?.name].filter(Boolean).join(' · '),
    last, unread: member ? list.filter((m) => isUnread(m, me.id)).length : 0, member,
  }
}

// השיחות שלי: אישיות שלי, ותיקים שאני בצוות שלהם (הנהלה ומשרד רואים את כל התיקים)
export function teamThreads(db: Pick<DB, 'cases' | 'chat' | 'users' | 'customers'>, me: User): ThreadInfo[] {
  const by = new Map<string, ChatMessage[]>()
  db.chat.forEach((m) => by.set(m.threadId, [...(by.get(m.threadId) ?? []), m]))
  const out: ThreadInfo[] = []
  by.forEach((msgs, id) => {
    const t = threadInfo(db, id, me, msgs)
    if (!t) return
    if (t.kind === 'dm' && !t.member) return
    if (t.kind === 'case' && !t.member && !seesAllCases(me)) return
    out.push(t)
  })
  return out.sort((a, b) => (b.last?.at ?? '').localeCompare(a.last?.at ?? ''))
}

// אזכורים: "@שם מלא", או "@שם פרטי" אם הוא ייחודי
export function findMentions(users: User[], body: string, except?: ID): ID[] {
  const firsts = new Map<string, number>()
  users.forEach((u) => firsts.set(u.name.split(' ')[0], (firsts.get(u.name.split(' ')[0]) ?? 0) + 1))
  return users
    .filter((u) => u.id !== except)
    .filter((u) => {
      if (body.includes(`@${u.name}`)) return true
      const f = u.name.split(' ')[0]
      return firsts.get(f) === 1 && new RegExp(`@${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'u').test(body)
    })
    .map((u) => u.id)
}

const preview = (body: string, atts?: Attachment[]) => (body.trim() ? body.trim().replace(/\s+/g, ' ').slice(0, 80) : atts?.length ? `📎 ${atts[0].name}` : '')

export function threadLink(threadId: string) {
  const p = parseThread(threadId)
  return p?.kind === 'case' ? `/cases/${p.caseId}?chat=${encodeURIComponent(threadId)}` : `/?chat=${encodeURIComponent(threadId)}`
}

function notifyThread(threadId: string, m: ChatMessage, mentioned: ID[]) {
  const s = app()
  const me = s.db.users.find((u) => u.id === m.fromId)
  const p = parseThread(threadId)
  const k = p?.kind === 'case' ? s.db.cases.find((x) => x.id === p.caseId) : undefined
  const text = preview(m.body, m.attachments)
  const where = k ? ` · ${k.number}` : ''
  const link = threadLink(threadId)
  mentioned.forEach((u) => s.notify(u, `אזכור מ${me?.name ?? ''}${where}: ${text}`, link))
  threadMembers(s.db, threadId)
    .filter((u) => u !== m.fromId && !mentioned.includes(u))
    .forEach((u) => s.notify(u, `${me?.name ?? ''}${where}: ${text}`, link))
}

export function sendChat(threadId: string, body: string, attachments: Attachment[] = []): ChatMessage | null {
  const s = app()
  const me = s.currentUserId
  if (!body.trim() && !attachments.length) return null
  const p = parseThread(threadId)
  const mentions = p?.kind === 'case' ? findMentions(s.db.users, body, me) : []
  const m: ChatMessage = {
    id: uid('ch'), threadId, caseId: p?.kind === 'case' ? p.caseId : undefined, fromId: me, body: body.trim(), at: nowIso(), readBy: [me],
    ...(mentions.length ? { mentions } : {}), ...(attachments.length ? { attachments } : {}),
  }
  s.upsert('chat', m)
  notifyThread(threadId, m, mentions)
  return m
}

export function editChat(m: ChatMessage, body: string) {
  const s = app()
  const mentions = m.caseId ? findMentions(s.db.users, body, m.fromId) : []
  s.patch('chat', m.id, { body: body.trim(), editedAt: nowIso(), mentions: mentions.length ? mentions : undefined })
  const added = mentions.filter((u) => !(m.mentions ?? []).includes(u))
  if (added.length) {
    const k = s.db.cases.find((x) => x.id === m.caseId)
    const who = s.db.users.find((u) => u.id === m.fromId)?.name ?? ''
    added.forEach((u) => s.notify(u, `אזכור מ${who}${k ? ` · ${k.number}` : ''}: ${preview(body)}`, threadLink(m.threadId)))
  }
}

export const deleteChat = (m: ChatMessage) => app().patch('chat', m.id, { deleted: true, body: '', attachments: undefined, editedAt: nowIso() })

export function markThreadRead(threadId: string, me: ID) {
  const s = app()
  s.db.chat.filter((m) => m.threadId === threadId && isUnread(m, me)).forEach((m) => s.patch('chat', m.id, { readBy: [...m.readBy, me] }))
}

// ---------- פניות לקוחות (וואטסאפ ואזור אישי) ----------
export const custChannels: Message['channel'][] = ['whatsapp', 'portal']
export const isCustUnread = (m: Message) => m.direction === 'in' && !m.readAt
export const convKey = (m: Pick<Message, 'caseId' | 'customerId'>) => (m.caseId ? `k:${m.caseId}` : m.customerId ? `c:${m.customerId}` : '')

export interface CustomerConv {
  key: string
  caseId?: ID
  customerId?: ID
  kase?: Case
  title: string
  sub: string
  last: Message
  unread: number
}

export function canSeeCase(k: Case | undefined, me: User) {
  return seesAllCases(me) || (!!k && caseTeam(k).includes(me.id))
}

export function customerConvs(db: Pick<DB, 'messages' | 'cases' | 'customers' | 'serviceCalls'>, me: User): CustomerConv[] {
  const by = new Map<string, Message[]>()
  db.messages.forEach((m) => {
    const key = convKey(m)
    if (key) by.set(key, [...(by.get(key) ?? []), m])
  })
  const out: CustomerConv[] = []
  by.forEach((msgs, key) => {
    if (!msgs.some((m) => custChannels.includes(m.channel))) return
    const caseId = key.startsWith('k:') ? key.slice(2) : undefined
    const kase = caseId ? db.cases.find((x) => x.id === caseId) : undefined
    const customerId = kase?.customerId ?? (key.startsWith('c:') ? key.slice(2) : msgs[0].customerId)
    const calls = db.serviceCalls.filter((c) => msgs.some((m) => m.serviceCallId === c.id))
    const visible = caseId ? canSeeCase(kase, me) : seesAllCases(me) || calls.some((c) => c.assigneeId === me.id)
    if (!visible) return
    const cust = db.customers.find((c) => c.id === customerId)
    const last = msgs.reduce((a, m) => (m.at > a.at ? m : a), msgs[0])
    out.push({
      key, caseId, customerId, kase, title: cust?.name ?? 'לקוח', sub: kase ? `${kase.number} · ${kase.title}` : calls[0] ? `קריאת שירות ${calls[0].number}` : 'בלי תיק',
      last, unread: msgs.filter(isCustUnread).length,
    })
  })
  return out.sort((a, b) => b.last.at.localeCompare(a.last.at))
}

export function markConvRead(key: string, me: ID) {
  const s = app()
  const at = nowIso()
  s.db.messages.filter((m) => convKey(m) === key && isCustUnread(m)).forEach((m) => s.patch('messages', m.id, { readAt: at, readBy: me, status: 'read' }))
}
