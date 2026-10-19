import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval'
import type { Activity, Collection, DB, Entity, ID, Notification, Settings } from './types'
import { nowIso, uid } from './format'
import { seedDB } from './seed'

// הנתונים נשמרים ב-IndexedDB של הדפדפן (מקום לתמונות). בייצור השכבה הזו מוחלפת ב-API של השרת.
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

interface AppState {
  db: DB
  settings: Settings
  currentUserId: ID
  hydrated: boolean
  upsert: <C extends Collection>(c: C, item: Entity<C>) => void
  patch: <C extends Collection>(c: C, id: ID, changes: Partial<Entity<C>>) => void
  remove: <C extends Collection>(c: C, id: ID) => void
  nextNumber: (key: string, prefix: string, pad?: number) => string
  log: (a: Omit<Activity, 'id' | 'at'>) => void
  notify: (userId: ID, text: string, link?: string) => void
  setSettings: (p: Partial<Settings>) => void
  setUser: (id: ID) => void
  resetDemo: () => void
}

type Row = { id: ID }

export const useApp = create<AppState>()(
  persist(
    (set, get) => ({
      db: seedDB(),
      settings: defaultSettings,
      currentUserId: 'u-admin',
      hydrated: false,

      upsert: (c, item) =>
        set((s) => {
          const list = s.db[c] as unknown as Row[]
          const i = list.findIndex((x) => x.id === (item as Row).id)
          const next = i >= 0 ? list.map((x, j) => (j === i ? item : x)) : [item, ...list]
          return { db: { ...s.db, [c]: next } }
        }),

      patch: (c, id, changes) =>
        set((s) => {
          const list = s.db[c] as unknown as Row[]
          return { db: { ...s.db, [c]: list.map((x) => (x.id === id ? { ...x, ...changes } : x)) } }
        }),

      remove: (c, id) =>
        set((s) => {
          const list = s.db[c] as unknown as Row[]
          return { db: { ...s.db, [c]: list.filter((x) => x.id !== id) } }
        }),

      nextNumber: (key, prefix, pad = 4) => {
        const n = (get().db.counters[key] ?? 0) + 1
        set((s) => ({ db: { ...s.db, counters: { ...s.db.counters, [key]: n } } }))
        return `${prefix}${String(n).padStart(pad, '0')}`
      },

      log: (a) => {
        const entry: Activity = { id: uid('a'), at: nowIso(), userId: a.userId ?? get().currentUserId, ...a }
        set((s) => ({ db: { ...s.db, activities: [entry, ...s.db.activities] } }))
      },

      notify: (userId, text, link) => {
        const n: Notification = { id: uid('n'), at: nowIso(), userId, text, link, read: false }
        set((s) => ({ db: { ...s.db, notifications: [n, ...s.db.notifications] } }))
      },

      setSettings: (p) => set((s) => ({ settings: { ...s.settings, ...p } })),
      setUser: (id) => set({ currentUserId: id }),
      resetDemo: () => set({ db: seedDB(), currentUserId: 'u-admin' }),
    }),
    {
      name: 'genair-ops-v1',
      version: 1,
      storage: createJSONStorage(() => idbStorage),
      partialize: (s) => ({ db: s.db, settings: s.settings, currentUserId: s.currentUserId }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>
        return { ...current, ...p, settings: { ...defaultSettings, ...(p.settings ?? {}) } }
      },
      onRehydrateStorage: () => () => useApp.setState({ hydrated: true }),
    },
  ),
)

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
