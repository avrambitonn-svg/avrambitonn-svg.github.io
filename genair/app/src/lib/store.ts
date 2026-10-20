import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval'
import type { Activity, Collection, Config, DB, Entity, ID, Notification, Settings } from './types'
import { nowIso, uid } from './format'
import { seedDB } from './seed'
import { defaultConfig } from './configDefaults'
import { bridge, readSyncConfig, type Op } from './sync/bridge'
import { brand } from '../brand'
import { applyHistorySeed } from './seedHistory'

// הנתונים נשמרים ב-IndexedDB של הדפדפן (מקום לתמונות). במצב הדגמה זה כל המאגר;
// במצב משותף (sync/) זה עותק מקומי של מסד הנתונים בשרת, וכל פעולה כאן נשלחת אליו.
const idbStorage: StateStorage = {
  getItem: async (name) => (await idbGet<string>(name)) ?? null,
  setItem: async (name, value) => idbSet(name, value),
  removeItem: async (name) => idbDel(name),
}

export const defaultSettings: Settings = {
  vatPct: 18,
  quoteValidityDays: 14,
  depositPct: 20,
  workDays: [0, 1, 2, 3, 4],
  workStart: '08:00',
  workEnd: '17:00',
  avoidHolidays: true,
  serverUrl: '',
  appToken: '',
  anthropicKey: '',
  aiModel: 'claude-opus-5-5',
  whatsappMode: 'link',
  googleMode: 'link',
  priorityMode: 'off',
  reviewUrl: '',
  commissionPct: 3,
}

// הגדרות של המכשיר הזה בלבד; כל השאר משותף לכל הארגון
export const DEVICE_SETTINGS = ['serverUrl', 'appToken', 'anthropicKey'] as const

interface AppState {
  db: DB
  settings: Settings
  currentUserId: ID
  hydrated: boolean
  syncSeq: number // המיקום האחרון ברצף השינויים של השרת שהעותק הזה כולל (מצב משותף)
  upsert: <C extends Collection>(c: C, item: Entity<C>) => void
  patch: <C extends Collection>(c: C, id: ID, changes: Partial<Entity<C>>) => void
  remove: <C extends Collection>(c: C, id: ID) => void
  nextNumber: (key: string, prefix: string, pad?: number) => string
  log: (a: Omit<Activity, 'id' | 'at'>) => void
  notify: (userId: ID, text: string, link?: string) => void
  setSettings: (p: Partial<Settings>) => void
  setConfig: (p: Partial<Config>) => void
  setUser: (id: ID) => void
  resetDemo: () => void
}

type Row = { id: ID }
type Obj = Record<string, unknown>

// ---------- מה נשלח לשרת: ההפרש בין הגרסה הקודמת לחדשה ----------

const clean = (o: Obj) => {
  const out: Obj = {}
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v
  return out
}

/** פעולה אחת לישות: חדשה = upsert, שינוי = patch של השדות שהשתנו בלבד, נמחקה = remove */
export function entityOp(collection: string, prev: Obj | undefined, next: Obj | undefined, id?: string): Op | null {
  const at = bridge.clock()
  if (!next) return prev ? { op: 'remove', collection, id: String(prev.id ?? id), at } : null
  const key = String(next.id ?? id)
  if (!prev) return { op: 'upsert', collection, id: key, data: clean(next), at }
  const data: Obj = {}
  const unset: string[] = []
  for (const k of Object.keys(next)) {
    if (k === 'id' || next[k] === prev[k]) continue
    if (next[k] === undefined) {
      if (prev[k] !== undefined) unset.push(k)
    } else data[k] = next[k]
  }
  for (const k of Object.keys(prev)) if (!(k in next) && prev[k] !== undefined) unset.push(k)
  if (!Object.keys(data).length && !unset.length) return null
  return { op: 'patch', collection, id: key, data, ...(unset.length ? { unset } : {}), at }
}

const orgSettings = (s: Partial<Settings>) => {
  const o: Obj = { ...s }
  for (const k of DEVICE_SETTINGS) delete o[k]
  return o
}

/** כל ההבדלים בין שני מצבים של המאגר (לשינויים שלא עברו דרך הפעולות, למשל שחזור מגיבוי) */
function diffDB(prev: DB, next: DB): Op[] {
  const ops: (Op | null)[] = []
  for (const key of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    if (key === 'counters') continue
    const a = (prev as unknown as Record<string, unknown>)[key]
    const b = (next as unknown as Record<string, unknown>)[key]
    if (a === b) continue
    if (key === 'config') {
      ops.push(entityOp('config', { id: 'org', ...(a as Obj) }, { id: 'org', ...(b as Obj) }))
      continue
    }
    if (!Array.isArray(b) && !Array.isArray(a)) continue
    const before = new Map(((a as Row[]) ?? []).map((x) => [x.id, x as unknown as Obj]))
    for (const item of (b as Row[]) ?? []) {
      const old = before.get(item.id)
      before.delete(item.id)
      if (old !== (item as unknown)) ops.push(entityOp(key, old, item as unknown as Obj))
    }
    for (const old of before.values()) ops.push(entityOp(key, old, undefined))
  }
  return ops.filter(Boolean) as Op[]
}

let emptyCache: DB | null = null
// מאגר ריק עם כל האוספים (מצב משותף, לפני הטעינה מהשרת)
export function emptyDB(): DB {
  if (!emptyCache) {
    const seed = seedDB()
    emptyCache = Object.fromEntries(Object.keys(seed).map((k) => [k, Array.isArray((seed as unknown as Obj)[k]) ? [] : {}])) as unknown as DB
  }
  return { ...emptyCache, config: defaultConfig(), counters: {} }
}

const serverMode = bridge.mode === 'server'

export const useApp = create<AppState>()(
  persist(
    (set, get) => {
      // פעולה של ה-store: המצב מתעדכן, ואז יוצאות הפעולות לשרת (במצב משותף)
      const tracked = (fn: () => void) => {
        bridge.depth++
        try {
          fn()
        } finally {
          bridge.depth--
        }
      }
      const find = (c: string, id: ID) => ((get().db as unknown as Record<string, Row[]>)[c] ?? []).find((x) => x.id === id) as Obj | undefined

      return {
        db: serverMode ? emptyDB() : seedDB(),
        settings: defaultSettings,
        currentUserId: serverMode ? readSyncConfig().userId ?? '' : 'u-admin',
        hydrated: false,
        syncSeq: 0,

        upsert: (c, item) => {
          const prev = find(c, (item as Row).id)
          tracked(() =>
            set((s) => {
              const list = s.db[c] as unknown as Row[]
              const i = list.findIndex((x) => x.id === (item as Row).id)
              const next = i >= 0 ? list.map((x, j) => (j === i ? item : x)) : [item, ...list]
              return { db: { ...s.db, [c]: next } }
            }),
          )
          bridge.emit([entityOp(c, prev, item as unknown as Obj)])
        },

        patch: (c, id, changes) => {
          const prev = find(c, id)
          tracked(() =>
            set((s) => {
              const list = s.db[c] as unknown as Row[]
              return { db: { ...s.db, [c]: list.map((x) => (x.id === id ? { ...x, ...changes } : x)) } }
            }),
          )
          if (prev) bridge.emit([entityOp(c, prev, find(c, id))])
        },

        remove: (c, id) => {
          const prev = find(c, id)
          tracked(() =>
            set((s) => {
              const list = s.db[c] as unknown as Row[]
              return { db: { ...s.db, [c]: list.filter((x) => x.id !== id) } }
            }),
          )
          if (prev) bridge.emit([entityOp(c, prev, undefined)])
        },

        // במצב משותף המספר מגיע מבלוק ששמור למכשיר הזה בשרת, כך שאין כפילויות בין משתמשים
        nextNumber: (key, prefix, pad = 4) => {
          const reserved = bridge.mode === 'server' ? bridge.takeNumber?.(key) ?? null : null
          const n = reserved ?? (get().db.counters[key] ?? 0) + 1
          tracked(() => set((s) => ({ db: { ...s.db, counters: { ...s.db.counters, [key]: Math.max(n, s.db.counters[key] ?? 0) } } })))
          return `${prefix}${String(n).padStart(pad, '0')}`
        },

        log: (a) => {
          const entry: Activity = { id: uid('a'), at: nowIso(), userId: a.userId ?? get().currentUserId, ...a }
          tracked(() => set((s) => ({ db: { ...s.db, activities: [entry, ...s.db.activities] } })))
          bridge.emit([entityOp('activities', undefined, entry as unknown as Obj)])
        },

        notify: (userId, text, link) => {
          const n: Notification = { id: uid('n'), at: nowIso(), userId, text, link, read: false }
          tracked(() => set((s) => ({ db: { ...s.db, notifications: [n, ...s.db.notifications] } })))
          bridge.emit([entityOp('notifications', undefined, n as unknown as Obj)])
        },

        setSettings: (p) => {
          const prev = get().settings
          tracked(() => set((s) => ({ settings: { ...s.settings, ...p } })))
          bridge.emit([entityOp('settings', { id: 'org', ...orgSettings(prev) }, { id: 'org', ...orgSettings(get().settings) })])
        },

        setConfig: (p) => {
          const prev = get().db.config
          tracked(() => set((s) => ({ db: { ...s.db, config: { ...s.db.config, ...p } } })))
          bridge.emit([entityOp('config', { id: 'org', ...prev }, { id: 'org', ...get().db.config })])
        },

        setUser: (id) => set({ currentUserId: id }),

        // במצב משותף אין איפוס של נתוני הארגון: טוענים מחדש את העותק מהשרת
        resetDemo: () => {
          if (bridge.mode === 'server') bridge.resync?.()
          else set({ db: seedDB(), currentUserId: 'u-admin' })
        },
      }
    },
    {
      // לכל מצב עותק משלו: נתוני ההדגמה לא מתערבבים עם המסד המשותף
      name: serverMode ? 'genair-ops-shared-v1' : 'genair-ops-v1',
      version: 1,
      storage: createJSONStorage(() => idbStorage),
      partialize: (s) => ({ db: s.db, settings: s.settings, currentUserId: s.currentUserId, ...(serverMode ? { syncSeq: s.syncSeq } : {}) }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>
        // נתונים מגרסה קודמת: אוספים חדשים מקבלים את ערכי ההתחלה, וההגדרות משלימות שדות חסרים
        const db = p.db ? ({ ...current.db, ...p.db } as DB) : current.db
        db.config = { ...defaultConfig(), ...(p.db?.config ?? {}) }
        // מודולים שנוספו אחרי שהדפדפן כבר שמר נתונים: מקבלים את נתוני ההדגמה שלהם
        for (const c of ['chat', 'leaves', 'suppliers', 'purchaseOrders', 'stockMoves'] as const) if (!p.db?.[c]?.length) (db[c] as unknown[]) = current.db[c]
        const settings = { ...defaultSettings, ...(p.settings ?? {}) }
        if (serverMode) {
          // כתובת השרת והמפתחות של המכשיר נשמרים בהגדרות החיבור, כדי שיעברו גם בין שני העותקים
          const sc = readSyncConfig()
          settings.serverUrl = sc.serverUrl || settings.serverUrl
          if (sc.appToken !== undefined) settings.appToken = sc.appToken
          if (sc.anthropicKey !== undefined) settings.anthropicKey = sc.anthropicKey
          return { ...current, ...p, db, settings, currentUserId: sc.userId ?? p.currentUserId ?? current.currentUserId }
        }
        // קישור ההדגמה (מותג ניטרלי): מי שפתח לפני שנוספה ההיסטוריה מקבל אותה עכשיו. במערכת אמיתית לא נוגעים בנתונים
        if (brand.demo && p.db) applyHistorySeed(db)
        return { ...current, ...p, db, settings }
      },
      onRehydrateStorage: () => () => useApp.setState({ hydrated: true }),
    },
  ),
)

// שינויים שלא עברו דרך הפעולות (useApp.setState({ db }) בשחזור גיבוי, למשל) נשלחים לפי ההפרש
useApp.subscribe((state, prev) => {
  if (bridge.mode !== 'server' || bridge.depth || bridge.remote || !bridge.listener) return
  const ops: Op[] = []
  if (state.db !== prev.db) ops.push(...diffDB(prev.db, state.db))
  if (state.settings !== prev.settings) {
    const op = entityOp('settings', { id: 'org', ...orgSettings(prev.settings) }, { id: 'org', ...orgSettings(state.settings) })
    if (op) ops.push(op)
  }
  bridge.emit(ops)
})

// גישה נוחה מחוץ לקומפוננטות (בפעולות)
export const app = () => useApp.getState()
export const db = () => useApp.getState().db

export function useDB<T>(sel: (db: DB) => T): T {
  return useApp((s) => sel(s.db))
}

export function useMe() {
  return useApp((s) => s.db.users.find((u) => u.id === s.currentUserId) ?? s.db.users[0])
}

export function useSettings() {
  return useApp((s) => s.settings)
}

export const byId = <T extends Row>(list: T[], id?: ID) => (id ? list.find((x) => x.id === id) : undefined)
