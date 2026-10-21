// מנוע הסנכרון במצב "מסד נתונים משותף" (Supabase): תמונת מצב בכניסה (db_snapshot), האזנה לשינויים
// (Realtime על public.sync_feed, ובנוסף סקר כל 30 שניות), תור של שינויים מקומיים שנשלח למסד (db_ops, גם אחרי
// עבודה בלי קליטה), ומספרים שמורים מראש לכל מכשיר (db_reserve).
import { create } from 'zustand'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { DEVICE_SETTINGS, defaultSettings, emptyDB, useApp } from '../store'
import { defaultConfig } from '../configDefaults'
import { nowIso } from '../format'
import type { DB, Settings, User } from '../types'
import { asRemote, bridge, type Op } from './bridge'
import { OpQueue, applyOp } from './queue'
import { SyncError, clearSession, logout as logoutApi, noticeFor, rpc, serverBase, setSignedOutHandler, useSession, type EndReason } from './session'
import { sb } from './supabase'

export type NetState = 'idle' | 'connecting' | 'online' | 'offline' | 'error'

interface SyncUI {
  net: NetState
  pending: number
  ready: boolean // במאגר יש את נתוני הארגון של המשתמש המחובר
  error?: string
  lastSyncAt?: string
  transport?: 'realtime' | 'poll'
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
let channel: RealtimeChannel | null = null
let flushing = false
let flushTimer: ReturnType<typeof setTimeout> | undefined
let pollTimer: ReturnType<typeof setInterval> | undefined
let retryTimer: ReturnType<typeof setTimeout> | undefined
let backoff = 1000
let lastPull = 0
const POLL_MS = 30_000
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
  const snap = await rpc<Snapshot>('db_snapshot')
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
    const r = await rpc<{ seq: number; items: Change[] }>('db_fetch', { items })
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
    const r = await rpc<{ seq: number; results: OpResult[]; serverTime: number }>('db_ops', { ops: batch, client_id: clientId })
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
      // בקשה שהמסד לא יקבל לעולם (22023): לא חוסמים את התור בגללה
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

let pullBusy = false
let pullAgain = false

/** מושך את השינויים מאז ה-seq האחרון (אחרי עדכון בזמן אמת, בסקר, בחזרה ללשונית או לרשת) */
async function pull(): Promise<void> {
  if (!running) return
  if (pullBusy) {
    pullAgain = true
    return
  }
  pullBusy = true
  const mine = gen
  try {
    do {
      pullAgain = false
      const r = await rpc<ChangesRes>('db_changes', { since: useApp.getState().syncSeq })
      if (!running || gen !== mine) return
      if (r.reset) await pullSnapshot()
      else applyChanges(r.changes, r.seq)
      lastPull = Date.now()
      if (useSync.getState().net !== 'online') {
        markOnline()
        scheduleFlush(0)
      }
    } while (pullAgain && running && gen === mine)
  } catch (e) {
    const err = e as SyncError
    if (!running || gen !== mine || err.status === 401) return
    setNet(offlineNow() || !err.status ? 'offline' : 'error', err.status ? { error: err.message } : {})
  } finally {
    pullBusy = false
  }
}

function closeChannel() {
  const ch = channel
  channel = null
  if (ch) void sb().removeChannel(ch).catch(() => {})
}

/** Realtime: כל כתיבה במסד מקדמת את seq בשורה האחת של public.sync_feed, ואז מושכים את השינויים */
async function subscribe() {
  if (!running) return
  closeChannel()
  const client = sb()
  // הערוץ מצטרף עם הטוקן של המשתמש (sync_feed קריא רק למחוברים)
  await client.realtime.setAuth().catch(() => {})
  if (!running) return
  const ch = client.channel(`genair-sync-${clientId}`)
  channel = ch
  ch.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sync_feed' }, (payload) => {
    const seq = Number((payload.new as { seq?: number } | undefined)?.seq ?? 0)
    if (seq > useApp.getState().syncSeq) void pull()
  }).subscribe((status) => {
    if (channel !== ch) return
    if (status === 'SUBSCRIBED') {
      // גם אחרי התחברות מחדש: מה שקרה בזמן הניתוק
      useSync.setState({ transport: 'realtime' })
      void pull()
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      // supabase-js מתחבר שוב לבד; עד אז הסקר כל 30 שניות
      useSync.setState({ transport: 'poll' })
    }
  })
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
    const r = await rpc<{ key: string; from: number; to: number }>('db_reserve', { p_key: key, p_count: count })
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
  if (useSync.getState().ready) void pull()
  else {
    clearTimeout(retryTimer)
    void initialPull()
  }
  scheduleFlush(0)
}
function onOffline() {
  setNet('offline')
}
function onVisible() {
  if (document.visibilityState !== 'visible' || !running) return
  // הדפדפן מקפיא לשוניות ברקע: בחזרה מושכים מה שהצטבר
  if (useSync.getState().ready && Date.now() - lastPull > 5_000) void pull()
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
  useSession.setState({ notice: noticeFor(reason) })
  if (reason !== 'expired') void wipeLocal()
}
// גם כשהמנוע לא רץ (במסך הכניסה, למשל): סוף החיבור עובר כאן
setSignedOutHandler((reason) => signedOut(reason))

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
  // גיבוי ל-Realtime: סקר קצר כל 30 שניות (הטוקן מתחדש לבד ב-supabase-js)
  pollTimer = setInterval(() => {
    if (running && useSync.getState().ready && !offlineNow() && Date.now() - lastPull >= POLL_MS) void pull()
  }, 5_000)
  await initialPull()
}

async function initialPull() {
  const s = useApp.getState()
  try {
    if (s.syncSeq > 0 && s.db.users.length) {
      const r = await rpc<ChangesRes>('db_changes', { since: s.syncSeq })
      if (r.reset) await pullSnapshot()
      else applyChanges(r.changes, r.seq)
    } else await pullSnapshot()
    lastPull = Date.now()
    useSync.setState({ ready: true })
    markOnline()
    prefetchNumbers()
    scheduleFlush(0)
    void subscribe()
  } catch (e) {
    const err = e as SyncError
    if (!running || err.status === 401) return
    setNet(err.status ? 'error' : 'offline', { error: err.message })
    // בלי קליטה עובדים מהעותק השמור, ומנסים שוב ברקע
    clearTimeout(retryTimer)
    retryTimer = setTimeout(() => running && void initialPull(), Math.min((backoff = Math.min(backoff * 2, 30_000)), 30_000))
  }
}

export function stopSync() {
  running = false
  gen++
  closeChannel()
  clearTimeout(flushTimer)
  clearTimeout(retryTimer)
  clearInterval(pollTimer)
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
    const r = await rpc<ChangesRes>('db_changes', { since: useApp.getState().syncSeq })
    if (r.reset) await pullSnapshot()
    else applyChanges(r.changes, r.seq)
    lastPull = Date.now()
    markOnline()
  } catch (e) {
    if ((e as SyncError).status !== 401) setNet('offline', { error: (e as Error).message })
  }
  if (!channel) void subscribe()
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
