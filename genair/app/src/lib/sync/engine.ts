// מנוע הסנכרון במצב "מסד נתונים משותף": תמונת מצב בכניסה, האזנה לשינויים (SSE, ואם לא עובר — long-poll),
// תור של שינויים מקומיים שנשלח לשרת (גם אחרי עבודה בלי קליטה), ומספרים שמורים מראש לכל מכשיר.
import { create } from 'zustand'
import { DEVICE_SETTINGS, defaultSettings, emptyDB, useApp } from '../store'
import { defaultConfig } from '../configDefaults'
import { nowIso } from '../format'
import type { DB, Settings, User } from '../types'
import { asRemote, bridge, type Op } from './bridge'
import { OpQueue, applyOp } from './queue'
import { SyncError, authFetch, clearSession, endReason, logout as logoutApi, serverBase, setSignedOutHandler, useSession, type EndReason } from './session'

export type NetState = 'idle' | 'connecting' | 'online' | 'offline' | 'error'

interface SyncUI {
  net: NetState
  pending: number
  ready: boolean // במאגר יש את נתוני הארגון של המשתמש המחובר
  error?: string
  lastSyncAt?: string
  transport?: 'sse' | 'poll'
  droppedOps?: number
}

export const useSync = create<SyncUI>(() => ({ net: 'idle', pending: 0, ready: false }))

interface Change {
  c: string
  id: string
  seq: number
  del?: boolean
  data?: Record<string, unknown>
}
interface ChangesRes {
  seq: number
  changes: Change[]
  reset?: boolean
}
interface Snapshot {
  seq: number
  serverTime: number
  collections: Record<string, Record<string, unknown>[]>
  config: Record<string, unknown> | null
  settings: Record<string, unknown> | null
  counters: Record<string, number>
  me: User
}
type OpResult = { status: 'ok' | 'partial' | 'stale' | 'missing' | 'conflict' | 'denied'; seq?: number; error?: string }

const SINGLETONS = new Set(['config', 'settings'])
const queue = new OpQueue()
const acked = new Map<string, number>()
const keyOf = (c: string, id: string) => `${c}\u0000${id}`
const clientId = (() => {
  try {
    const k = 'genair-sync-client'
    let v = sessionStorage.getItem(k)
    if (!v) sessionStorage.setItem(k, (v = `d${Math.random().toString(36).slice(2, 10)}`))
    return v
  } catch {
    return `d${Math.random().toString(36).slice(2, 10)}`
  }
})()

let running = false
let gen = 0
let streamAbort: AbortController | null = null
let flushing = false
let flushTimer: ReturnType<typeof setTimeout> | undefined
let reconnectTimer: ReturnType<typeof setTimeout> | undefined
let watchdog: ReturnType<typeof setInterval> | undefined
let keepAlive: ReturnType<typeof setInterval> | undefined
let backoff = 1000
let sseFailures = 0
let lastData = 0
let transport: 'sse' | 'poll' = 'sse'
const afterApply: (() => void)[] = []

/** קריאה אחרי כל עדכון מהשרת (המתאם של אישורים מהאזור האישי, למשל) */
export const onRemoteApplied = (fn: () => void) => afterApply.push(fn)
const notifyApplied = () => setTimeout(() => afterApply.forEach((fn) => fn()), 0)

const strip = (o: Record<string, unknown> | null | undefined) => {
  const out = { ...(o ?? {}) }
  delete out.id
  return out
}
const deviceSettings = (s: Settings) => Object.fromEntries(DEVICE_SETTINGS.map((k) => [k, s[k]])) as Partial<Settings>
const setNet = (net: NetState, extra: Partial<SyncUI> = {}) => useSync.setState({ net, ...extra })
const markOnline = () => {
  backoff = 1000
  useSync.setState({ net: 'online', lastSyncAt: nowIso(), error: undefined })
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const offlineNow = () => navigator.onLine === false

function setOffset(serverTime: number | undefined, t0: number) {
  if (!serverTime) return
  const offset = serverTime - (t0 + Date.now()) / 2
  bridge.clock = () => Date.now() + offset
}

// ---------------------------------------------------------------- החלת שינויים מהשרת

/**
 * השרת מסנן לפי תפקיד: אוסף מוסתר מגיע ריק, ולמתקין הצעה מגיעה רק כרשימת פריטים (בלי מחירים, מע״מ, סנכרון ותנאים).
 * משלימים שדות חובה כדי שהמסכים לא ייפלו. מתקין לא כותב הצעות, כך שההשלמה לא חוזרת לשרת.
 */
function normalize(c: string, data: Record<string, unknown> | undefined) {
  if (!data) return data
  if (c === 'quotes' && (!Array.isArray(data.lines) || !data.sync || data.vatPct === undefined || data.discountPct === undefined || data.terms === undefined || data.validUntil === undefined)) {
    const day = String(data.decidedAt ?? data.createdAt ?? '').slice(0, 10)
    return { discountPct: 0, vatPct: 0, terms: '', validUntil: day, ...data, lines: Array.isArray(data.lines) ? data.lines : [], sync: data.sync ?? { status: 'not_synced' } }
  }
  if ((c === 'customers' || c === 'catalog') && !data.sync) return { ...data, sync: { status: 'not_synced' } }
  return data
}

function applySingleton(db: Record<string, unknown>, settings: Settings, c: string, data: Record<string, unknown> | undefined): Settings {
  if (!data) return settings
  if (c === 'config') db.config = { ...defaultConfig(), ...strip(data) }
  else settings = { ...defaultSettings, ...strip(data), ...deviceSettings(settings) } as Settings
  return settings
}

/** מחיל רשימת שינויים. force = גם אם נראה שזה הד של שינוי שלנו (אחרי משיכה ישירה). */
function applyChanges(changes: Change[], seq: number, force = false) {
  const s = useApp.getState()
  const syncSeq = Math.max(s.syncSeq, seq)
  const lists = new Map<string, Record<string, unknown>[]>()
  const db = { ...s.db } as unknown as Record<string, unknown>
  let settings = s.settings
  let touched = false
  for (const ch of changes) {
    const pend = queue.pendingFor(ch.c, ch.id)
    if (!force && !pend.length && (acked.get(keyOf(ch.c, ch.id)) ?? 0) >= ch.seq) continue // ההד של מה שכבר אצלנו
    let next = ch.del ? undefined : normalize(ch.c, ch.data)
    for (const op of pend) next = applyOp(next, op)
    touched = true
    if (SINGLETONS.has(ch.c)) {
      settings = applySingleton(db, settings, ch.c, next)
      continue
    }
    let list = lists.get(ch.c)
    if (!list) {
      list = [...((db[ch.c] as Record<string, unknown>[]) ?? [])]
      lists.set(ch.c, list)
    }
    const i = list.findIndex((x) => x.id === ch.id)
    if (!next) {
      if (i >= 0) list.splice(i, 1)
    } else if (i >= 0) list[i] = next
    else list.unshift(next)
  }
  if (!touched) {
    if (syncSeq !== s.syncSeq) useApp.setState({ syncSeq })
    return
  }
  for (const [c, list] of lists) db[c] = list
  asRemote(() => useApp.setState({ db: db as unknown as DB, settings, syncSeq }))
  useSync.setState({ lastSyncAt: nowIso() })
  notifyApplied()
}

async function pullSnapshot() {
  const t0 = Date.now()
  const snap = await authFetch<Snapshot>('/api/db/snapshot')
  setOffset(snap.serverTime, t0)
  const s = useApp.getState()
  const db = emptyDB() as unknown as Record<string, unknown>
  // אוסף שחסר בתמונת המצב (או מוסתר לתפקיד) נשאר רשימה ריקה
  for (const [c, list] of Object.entries(snap.collections ?? {})) db[c] = Array.isArray(list) ? list.map((x) => normalize(c, x)) : []
  db.config = { ...defaultConfig(), ...strip(snap.config) }
  db.counters = { ...(snap.counters ?? {}) }
  let settings = { ...defaultSettings, ...strip(snap.settings), ...deviceSettings(s.settings) } as Settings
  // שינויים מקומיים שעוד לא הגיעו לשרת נשארים מעל
  for (const op of queue.all()) {
    if (SINGLETONS.has(op.collection)) {
      const cur = op.collection === 'config' ? (db.config as Record<string, unknown>) : (settings as unknown as Record<string, unknown>)
      settings = applySingleton(db, settings, op.collection, applyOp(cur, op))
      continue
    }
    const list = (db[op.collection] as Record<string, unknown>[]) ?? []
    const i = list.findIndex((x) => x.id === op.id)
    const next = applyOp(i >= 0 ? list[i] : undefined, op)
    db[op.collection] = next ? (i >= 0 ? list.map((x, j) => (j === i ? next : x)) : [next, ...list]) : list.filter((x) => x.id !== op.id)
  }
  acked.clear()
  asRemote(() => useApp.setState({ db: db as unknown as DB, settings, syncSeq: snap.seq, currentUserId: snap.me.id }))
  useSync.setState({ lastSyncAt: nowIso() })
  notifyApplied()
}

async function refetch(ops: Op[]) {
  const seen = new Set<string>()
  const items = ops.filter((op) => !seen.has(keyOf(op.collection, op.id)) && seen.add(keyOf(op.collection, op.id))).map((op) => ({ c: op.collection, id: op.id }))
  if (!items.length) return
  try {
    const r = await authFetch<{ seq: number; items: Change[] }>('/api/db/fetch', { method: 'POST', json: { items } })
    applyChanges(r.items, useApp.getState().syncSeq, true)
  } catch {
    /* יתוקן בסנכרון הבא */
  }
}

// ---------------------------------------------------------------- שליחת השינויים המקומיים

function scheduleFlush(delay = 120) {
  if (!running) return
  clearTimeout(flushTimer)
  flushTimer = setTimeout(() => void flush(), delay)
}

async function flush() {
  if (flushing || !running || !useSession.getState().token) return
  if (offlineNow()) return setNet('offline')
  const batch = queue.take()
  if (!batch.length) return
  flushing = true
  const t0 = Date.now()
  let retry = false
  try {
    const r = await authFetch<{ seq: number; results: OpResult[]; serverTime: number }>('/api/db/ops', { method: 'POST', json: { ops: batch, clientId } })
    setOffset(r.serverTime, t0)
    const again: Op[] = []
    const fix: Op[] = []
    let denied = 0
    r.results.forEach((res, i) => {
      const op = batch[i]
      if (res.status === 'ok') {
        if (res.seq) acked.set(keyOf(op.collection, op.id), res.seq)
      } else if (res.status === 'missing' && SINGLETONS.has(op.collection)) {
        // ההגדרות עוד לא קיימות בשרת: שולחים את כל המסמך
        const s = useApp.getState()
        const full = op.collection === 'config' ? s.db.config : Object.fromEntries(Object.entries(s.settings).filter(([k]) => !(DEVICE_SETTINGS as readonly string[]).includes(k)))
        again.push({ op: 'upsert', collection: op.collection, id: 'org', data: { ...full }, at: bridge.clock() })
      } else {
        if (res.status === 'denied') denied++
        fix.push(op)
      }
    })
    queue.ack(batch)
    if (again.length) queue.add(again)
    if (fix.length) await refetch(fix)
    if (denied) useSync.setState({ error: 'אין הרשאה לחלק מהשינויים, והם בוטלו' })
    markOnline()
  } catch (e) {
    const err = e as SyncError
    // 429 (יותר מדי בקשות) הוא זמני: הפעולות נשארות בתור ונשלחות שוב אחרי המתנה
    if (err.status === 400 || err.status === 413) {
      // בקשה שהשרת לא יקבל לעולם: לא חוסמים את התור בגללה
      queue.ack(batch)
      await refetch(batch)
      useSync.setState({ error: err.message })
    } else {
      queue.nack(batch)
      if (err.status === 429) {
        setNet('online', { error: err.message })
        backoff = Math.max(backoff, 5000)
        retry = true
      } else if (err.status !== 401) {
        setNet(offlineNow() || err.status === 0 ? 'offline' : 'error', err.status ? { error: err.message } : {})
        retry = true
      }
    }
  } finally {
    flushing = false
    useSync.setState({ pending: queue.size })
  }
  if (retry) scheduleFlush((backoff = Math.min(backoff * 2, 30_000)))
  else if (queue.unsent) scheduleFlush(0)
}

// ---------------------------------------------------------------- האזנה לשינויים

function closeStream() {
  streamAbort?.abort()
  streamAbort = null
}

function reconnectLater() {
  if (!running) return
  clearTimeout(reconnectTimer)
  reconnectTimer = setTimeout(() => connect(), backoff)
  backoff = Math.min(backoff * 2, 30_000)
}

function parseBlock(block: string) {
  const ev = { event: 'message', data: '' }
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) ev.event = line.slice(6).trim()
    else if (line.startsWith('data:')) ev.data += line.slice(5).trim()
  }
  return ev
}

async function connect() {
  if (!running) return
  clearTimeout(reconnectTimer)
  closeStream()
  if (transport === 'poll') return void pollLoop()
  const ctrl = new AbortController()
  streamAbort = ctrl
  let hello = false
  const helloTimer = setTimeout(() => !hello && ctrl.abort(), 10_000)
  try {
    const res = await fetch(`${serverBase()}/api/db/events?since=${useApp.getState().syncSeq}`, {
      headers: { authorization: `Bearer ${useSession.getState().token}`, accept: 'text/event-stream' },
      signal: ctrl.signal,
      cache: 'no-store',
    })
    if (res.status === 401) {
      const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string; reason?: string; details?: { reason?: string } } } | null
      return signedOut(endReason(body?.error && { ...body.error, reason: body.error.reason ?? body.error.details?.reason }))
    }
    if (!res.ok || !res.body) throw new Error(String(res.status))
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
    let buf = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      lastData = Date.now()
      buf += value
      let i
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const ev = parseBlock(buf.slice(0, i))
        buf = buf.slice(i + 2)
        if (!ev.data) continue
        const data = JSON.parse(ev.data)
        if (ev.event === 'hello') {
          hello = true
          sseFailures = 0
          useSync.setState({ transport: 'sse' })
          markOnline()
          scheduleFlush(0)
        } else if (ev.event === 'changes') applyChanges(data.changes, data.seq)
        else if (ev.event === 'reset') await pullSnapshot().catch(() => {})
        else if (ev.event === 'signout') return signedOut(data?.reason === 'expired' ? 'expired' : data?.reason === 'missing' ? 'missing' : 'revoked')
      }
    }
  } catch {
    /* נפל החיבור; מתחברים שוב */
  } finally {
    clearTimeout(helloTimer)
  }
  if (!running || streamAbort !== ctrl) return
  if (!hello && ++sseFailures >= 2) transport = 'poll' // פרוקסי שלא מעביר SSE: עוברים ל-long-poll
  setNet(offlineNow() ? 'offline' : 'connecting')
  reconnectLater()
}

async function pollLoop() {
  const mine = ++gen
  useSync.setState({ transport: 'poll' })
  while (running && gen === mine) {
    const ctrl = new AbortController()
    streamAbort = ctrl
    try {
      const r = await authFetch<ChangesRes>(`/api/db/changes?since=${useApp.getState().syncSeq}&wait=25`, { signal: ctrl.signal })
      if (r.reset) await pullSnapshot()
      else applyChanges(r.changes, r.seq)
      if (useSync.getState().net !== 'online') {
        markOnline()
        scheduleFlush(0)
      }
    } catch (e) {
      if (!running || gen !== mine || (e as SyncError).status === 401) return
      setNet('offline')
      await sleep((backoff = Math.min(backoff * 2, 30_000)))
    }
  }
}

// ---------------------------------------------------------------- מספרים שמורים (nextNumber)

let blocks: Record<string, [number, number][]> = {}
const blocksKey = () => `genair-sync-numbers:${serverBase()}:${useSession.getState().userId ?? ''}`
const topping = new Set<string>()

function loadBlocks() {
  try {
    blocks = JSON.parse(localStorage.getItem(blocksKey()) ?? '{}')
  } catch {
    blocks = {}
  }
}
function saveBlocks() {
  try {
    localStorage.setItem(blocksKey(), JSON.stringify(blocks))
  } catch {
    /* */
  }
}
const available = (key: string) => (blocks[key] ?? []).reduce((n, [a, b]) => n + Math.max(0, b - a + 1), 0)

async function topUp(key: string, count = 10) {
  if (topping.has(key) || !running) return
  topping.add(key)
  try {
    const r = await authFetch<{ from: number; to: number }>('/api/db/counters/reserve', { method: 'POST', json: { key, count } })
    ;(blocks[key] ??= []).push([r.from, r.to])
    saveBlocks()
  } catch {
    /* ננסה שוב בפעם הבאה */
  } finally {
    topping.delete(key)
  }
}

function takeNumber(key: string): number | null {
  const list = blocks[key] ?? []
  while (list.length && list[0][0] > list[0][1]) list.shift()
  if (!list.length) {
    void topUp(key)
    console.warn(`[sync] אין מספר שמור ל-${key}; נעשה שימוש במונה המקומי`)
    return null
  }
  const n = list[0][0]++
  blocks[key] = list
  saveBlocks()
  if (available(key) < 3) void topUp(key)
  return n
}

function prefetchNumbers() {
  const keys = new Set([...Object.keys(useApp.getState().db.counters), 'case', 'quote', 'service', 'contract', 'po'])
  keys.forEach((k) => available(k) < 3 && void topUp(k))
}

// ---------------------------------------------------------------- מחזור חיים

function onOnline() {
  backoff = 1000
  void connect()
  scheduleFlush(0)
}
function onOffline() {
  setNet('offline')
}
function onVisible() {
  if (document.visibilityState !== 'visible' || !running) return
  if (transport === 'sse' && Date.now() - lastData > 45_000) void connect()
  scheduleFlush(0)
}
function onHide() {
  queue.save(true)
}

/**
 * השרת סיים את החיבור. פג תוקף: הנתונים והתור נשארים, ואותו משתמש נכנס שוב והשינויים נשלחים.
 * בוטל (משתמש הושבת, סיסמה הוחלפה, ניתוק מרחוק): מוחקים מהמכשיר את העותק המקומי ואת התור, כמו ביציאה.
 * שינויים שלא נשלחו הולכים לאיבוד, וזה בכוונה: מי שהגישה שלו בוטלה לא שולח יותר כלום.
 */
function signedOut(reason: EndReason = 'revoked') {
  stopSync()
  clearSession()
  useSession.setState({ notice: reason === 'expired' ? 'פג תוקף ההתחברות. נכנסים שוב, ומה שנשמר במכשיר יישלח.' : 'החיבור בוטל בשרת (למשל סיסמה הוחלפה או שהמשתמש הושבת). הנתונים נמחקו מהמכשיר הזה.' })
  if (reason !== 'expired') void wipeLocal()
}

/** מוחק מהמכשיר את העותק המקומי של נתוני הארגון, את התור ואת המספרים השמורים */
async function wipeLocal() {
  await queue.clear()
  try {
    localStorage.removeItem(blocksKey())
  } catch {
    /* */
  }
  blocks = {}
  asRemote(() => useApp.setState({ db: emptyDB(), syncSeq: 0, currentUserId: '' }))
  useSync.setState({ pending: 0, error: undefined, droppedOps: undefined })
}

/** מפעיל את הסנכרון אחרי כניסה (או בפתיחה, כשיש חיבור שמור) */
export async function startSync(): Promise<void> {
  if (running || bridge.mode !== 'server') return
  const { token, userId } = useSession.getState()
  if (!token || !userId) return
  running = true
  transport = 'sse'
  sseFailures = 0
  setSignedOutHandler((reason) => signedOut(reason))
  queue.onChange = () => {
    useSync.setState({ pending: queue.size })
    scheduleFlush()
  }
  bridge.listener = (ops) => queue.add(ops)
  bridge.takeNumber = takeNumber
  bridge.resync = () => void pullSnapshot().catch(() => {})
  const dropped = await queue.load(`genair-sync-queue:${serverBase()}`, userId, bridge.early.splice(0))
  useSync.setState({ droppedOps: dropped || undefined, pending: queue.size })
  loadBlocks()

  const s = useApp.getState()
  if (s.currentUserId !== userId) useApp.setState({ currentUserId: userId })
  const cached = s.syncSeq > 0 && s.db.users.some((u) => u.id === userId)
  useSync.setState({ ready: cached, net: 'connecting' })
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('pagehide', onHide)
  watchdog = setInterval(() => {
    if (running && transport === 'sse' && streamAbort && Date.now() - lastData > 50_000) void connect()
  }, 15_000)
  // מחדש את הטוקן גם כשלא עושים כלום (פג אחרי 12 שעות בלי שימוש)
  keepAlive = setInterval(() => void authFetch('/api/auth/me').catch(() => {}), 20 * 60_000)
  await initialPull()
}

async function initialPull() {
  const s = useApp.getState()
  try {
    if (s.syncSeq > 0 && s.db.users.length) {
      const r = await authFetch<ChangesRes>(`/api/db/changes?since=${s.syncSeq}&wait=0`)
      if (r.reset) await pullSnapshot()
      else applyChanges(r.changes, r.seq)
    } else await pullSnapshot()
    useSync.setState({ ready: true })
    markOnline()
    prefetchNumbers()
    scheduleFlush(0)
    void connect()
  } catch (e) {
    const err = e as SyncError
    if (!running || err.status === 401) return
    setNet(err.status ? 'error' : 'offline', { error: err.message })
    // בלי קליטה עובדים מהעותק השמור, ומנסים שוב ברקע
    setTimeout(() => running && void initialPull(), Math.min((backoff = Math.min(backoff * 2, 30_000)), 30_000))
  }
}

export function stopSync() {
  running = false
  gen++
  closeStream()
  clearTimeout(flushTimer)
  clearTimeout(reconnectTimer)
  clearInterval(watchdog)
  clearInterval(keepAlive)
  bridge.listener = null
  bridge.takeNumber = null
  bridge.resync = null
  window.removeEventListener('online', onOnline)
  window.removeEventListener('offline', onOffline)
  document.removeEventListener('visibilitychange', onVisible)
  window.removeEventListener('pagehide', onHide)
  queue.save(true)
  useSync.setState({ net: 'idle', ready: false })
}

/** סנכרון עכשיו: שולח את מה שממתין ומושך שינויים */
export async function syncNow() {
  if (!running) return startSync()
  backoff = 1000
  await flush()
  try {
    const r = await authFetch<ChangesRes>(`/api/db/changes?since=${useApp.getState().syncSeq}&wait=0`)
    if (r.reset) await pullSnapshot()
    else applyChanges(r.changes, r.seq)
    markOnline()
  } catch (e) {
    setNet('offline', { error: (e as Error).message })
  }
  if (transport === 'sse' && Date.now() - lastData > 30_000) void connect()
}

export const pendingCount = () => queue.size

/** יציאה: מנסה לשלוח מה שממתין, ומוחק את העותק המקומי של הנתונים מהמכשיר */
export async function signOut() {
  if (running) await flush().catch(() => {})
  await logoutApi()
  stopSync()
  await wipeLocal()
  useSession.setState({ notice: undefined })
}

/** ישויות ששמורות כרגע רק במכשיר (לבדיקה לפני יציאה) */
export const unsyncedOps = () => queue.all()
