// תור השינויים שעוד לא אושרו בשרת. נשמר ב-IndexedDB, כך שעבודה בלי קליטה לא הולכת לאיבוד,
// ושינויים רצופים באותה ישות (הקלדה בשדה) מתאחדים לפעולה אחת.
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval'
import type { Op } from './bridge'

interface Item {
  op: Op
  sent: boolean
}

const same = (a: Op, b: Op) => a.collection === b.collection && a.id === b.id

function merge(prev: Op, next: Op): Op | null {
  if (prev.ifUnset || next.ifUnset) return null
  if (next.op === 'remove' || next.op === 'upsert') return next
  // next = patch
  if (prev.op === 'remove') return null
  const data = { ...(prev.data ?? {}), ...(next.data ?? {}) }
  for (const k of next.unset ?? []) delete data[k]
  if (prev.op === 'upsert') return { ...prev, data, at: next.at }
  const unset = [...new Set([...(prev.unset ?? []).filter((k) => !(next.data && k in next.data)), ...(next.unset ?? [])])]
  return { ...next, data, ...(unset.length ? { unset } : { unset: undefined }), at: next.at }
}

export class OpQueue {
  private items: Item[] = []
  private key = ''
  private userId = ''
  private timer: ReturnType<typeof setTimeout> | null = null
  onChange: (() => void) | null = null

  /** טוען את התור של המשתמש הזה. תור של משתמש אחר נמחק (מוחזר מספר הפעולות שנזרקו). */
  async load(key: string, userId: string, early: Op[] = []): Promise<number> {
    this.key = key
    this.userId = userId
    let dropped = 0
    try {
      const saved = await idbGet<{ userId: string; ops: Op[] }>(key)
      if (saved?.userId === userId) this.items = saved.ops.map((op) => ({ op, sent: false }))
      else dropped = saved?.ops.length ?? 0
    } catch {
      this.items = []
    }
    if (early.length) this.add(early)
    else this.onChange?.()
    return dropped
  }

  add(ops: Op[]) {
    for (const op of ops) {
      let j = -1
      for (let i = this.items.length - 1; i >= 0; i--) {
        if (same(this.items[i].op, op)) {
          j = i
          break
        }
      }
      const merged = j >= 0 && !this.items[j].sent ? merge(this.items[j].op, op) : null
      if (merged) this.items[j] = { op: merged, sent: false }
      else this.items.push({ op, sent: false })
    }
    this.save()
    this.onChange?.()
  }

  /** הפעולות הבאות לשליחה (מסומנות כנשלחות עד אישור או כישלון) */
  take(maxOps = 200, maxBytes = 3_500_000): Op[] {
    const out: Op[] = []
    let bytes = 0
    for (const it of this.items) {
      if (it.sent) continue
      const size = JSON.stringify(it.op).length
      if (out.length && (out.length >= maxOps || bytes + size > maxBytes)) break
      it.sent = true
      out.push(it.op)
      bytes += size
    }
    return out
  }

  ack(ops: Op[]) {
    const done = new Set(ops)
    this.items = this.items.filter((it) => !done.has(it.op))
    this.save()
    this.onChange?.()
  }

  nack(ops: Op[]) {
    const back = new Set(ops)
    for (const it of this.items) if (back.has(it.op)) it.sent = false
  }

  /** פעולות שעוד לא אושרו לישות מסוימת (להחלה מחדש מעל מה שמגיע מהשרת) */
  pendingFor(collection: string, id: string): Op[] {
    return this.items.filter((it) => it.op.collection === collection && it.op.id === id).map((it) => it.op)
  }

  get size() {
    return this.items.length
  }

  get unsent() {
    return this.items.filter((it) => !it.sent).length
  }

  all(): Op[] {
    return this.items.map((it) => it.op)
  }

  async clear() {
    this.items = []
    if (this.key) await idbDel(this.key).catch(() => {})
    this.onChange?.()
  }

  save(now = false) {
    if (!this.key) return
    if (this.timer) clearTimeout(this.timer)
    const write = () => {
      this.timer = null
      void idbSet(this.key, { userId: this.userId, ops: this.items.map((it) => it.op) }).catch(() => {})
    }
    if (now) write()
    else this.timer = setTimeout(write, 120)
  }
}

/** מחיל פעולה על עותק מקומי של ישות (לשכבה מעל מצב השרת) */
export function applyOp<T extends Record<string, unknown>>(entity: T | undefined, op: Op): T | undefined {
  if (op.op === 'remove') return undefined
  if (op.op === 'upsert') return { ...(op.data ?? {}), id: op.id } as unknown as T
  if (!entity) return undefined
  const next: Record<string, unknown> = { ...entity, ...(op.data ?? {}) }
  for (const k of op.unset ?? []) delete next[k]
  return next as T
}
