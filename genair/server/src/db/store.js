// Shared document store: entities by collection + id, per-field last-write-wins, soft delete,
// one global change sequence (seq), counters and a change event for SSE / long-poll.
// Everything lives in memory; an adapter (adapters.js) loads it once and saves it after changes.
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';

// config and org-wide settings are singleton documents with the id 'org'
export const SINGLETONS = new Set(['config', 'settings']);
export const SINGLETON_ID = 'org';
// written by the server itself (the Priority sync engine's state)
export const SYSTEM = new Set(['integrations']);
export const COLLECTION_RE = /^[a-z][A-Za-z0-9]{0,39}$/;
export const ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
export const COUNTER_RE = /^[A-Za-z0-9_.-]{1,40}$/;
export const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_COLLECTIONS = 64;
const MAX_CHANGES = 3000; // a client further behind than this reloads the snapshot

const nullObj = (src) => Object.assign(Object.create(null), src ?? {});
const maxAt = (rec) => Object.values(rec.at).reduce((m, v) => (v > m ? v : m), 0);

export class DocStore extends EventEmitter {
  constructor({ adapter, flushMs = 300, maxWaitMs = 2000, now = Date.now } = {}) {
    super();
    this.setMaxListeners(0); // one listener per open SSE / long-poll connection
    this.adapter = adapter;
    this.flushMs = flushMs;
    this.maxWaitMs = maxWaitMs;
    this.now = now;
    this.seq = 0;
    this.cseq = 0; // creation order, so snapshots keep "newest first" like the app
    this.cols = new Map();
    this.counters = new Map();
    this.auth = { secret: '', credentials: new Map(), revoked: new Map() };
    this.meta = { createdAt: new Date(now()).toISOString() };
    this.timer = null;
    this.firstDirtyAt = 0;
    this.changed = [];
    this.saving = null;
  }

  async init() {
    const state = this.adapter ? await this.adapter.load() : null;
    if (state) this.#hydrate(state);
    return this;
  }

  #hydrate(s) {
    this.seq = Number(s.seq) || 0;
    this.cseq = Number(s.cseq) || 0;
    this.meta = { ...this.meta, ...(s.meta ?? {}) };
    for (const [k, v] of Object.entries(s.counters ?? {})) if (COUNTER_RE.test(k)) this.counters.set(k, Number(v) || 0);
    for (const [c, recs] of Object.entries(s.collections ?? {})) {
      if (!COLLECTION_RE.test(c) || !Array.isArray(recs)) continue;
      const col = new Map();
      for (const r of recs) {
        if (!r || !ID_RE.test(r.id)) continue;
        col.set(r.id, { id: r.id, data: r.data ?? { id: r.id }, at: nullObj(r.at), cseq: r.cseq || 0, seq: r.seq || 0, del: r.del || 0, ts: r.ts || 0, by: r.by });
      }
      this.cols.set(c, col);
    }
    const a = s.auth ?? {};
    this.auth.secret = typeof a.secret === 'string' ? a.secret : '';
    for (const [id, cred] of Object.entries(a.credentials ?? {})) if (ID_RE.test(id)) this.auth.credentials.set(id, cred);
    const t = Math.floor(this.now() / 1000);
    for (const [sid, exp] of Object.entries(a.revoked ?? {})) if (exp > t) this.auth.revoked.set(sid, exp);
  }

  toJSON() {
    const collections = {};
    for (const [c, col] of this.cols) collections[c] = [...col.values()];
    const t = Math.floor(this.now() / 1000);
    const revoked = {};
    for (const [sid, exp] of this.auth.revoked) if (exp > t) revoked[sid] = exp;
    return {
      version: 1,
      seq: this.seq,
      cseq: this.cseq,
      meta: this.meta,
      counters: Object.fromEntries(this.counters),
      collections,
      auth: { secret: this.auth.secret, credentials: Object.fromEntries(this.auth.credentials), revoked },
    };
  }

  // ------------------------------------------------------------ reads

  /** No business data yet (first run). The server's own bookkeeping (SYSTEM) does not count. */
  isEmpty() {
    for (const [c, col] of this.cols) {
      if (SYSTEM.has(c)) continue;
      for (const r of col.values()) if (!r.del) return false;
    }
    return true;
  }

  get(c, id) {
    const r = this.cols.get(c)?.get(id);
    return r && !r.del ? r.data : undefined;
  }

  list(c) {
    const col = this.cols.get(c);
    if (!col) return [];
    return [...col.values()].filter((r) => !r.del).sort((a, b) => b.cseq - a.cseq).map((r) => r.data);
  }

  record(c, id) {
    const r = this.cols.get(c)?.get(id);
    return r ? change(c, r) : null;
  }

  snapshot() {
    const collections = {};
    for (const c of this.cols.keys()) if (!SINGLETONS.has(c)) collections[c] = this.list(c);
    return {
      seq: this.seq,
      collections,
      config: this.get('config', SINGLETON_ID) ?? null,
      settings: this.get('settings', SINGLETON_ID) ?? null,
      counters: Object.fromEntries(this.counters),
    };
  }

  /** Entities changed after `since` (oldest first), or { reset } when the client must reload the snapshot. */
  changesSince(since) {
    if (!(since >= 0) || since > this.seq) return { seq: this.seq, reset: true, changes: [] };
    const out = [];
    for (const [c, col] of this.cols) for (const r of col.values()) if (r.seq > since) out.push(change(c, r));
    if (out.length > MAX_CHANGES) return { seq: this.seq, reset: true, changes: [] };
    out.sort((a, b) => a.seq - b.seq);
    return { seq: this.seq, changes: out };
  }

  // ------------------------------------------------------------ writes

  /**
   * Applies a batch. ops: [{ op: 'upsert'|'patch'|'remove', collection, id, data?, unset?, at, ifUnset? }]
   * ctx: { userId, clientId, check(op, current) -> null | reason }
   * Result per op: ok | partial (some fields lost to newer writes) | stale | missing | conflict | denied.
   */
  applyOps(ops, ctx = {}) {
    const now = this.now();
    const touched = new Map();
    const results = ops.map((op) => {
      const r = this.#applyOne(op, ctx, now);
      if (r.rec) {
        touched.set(`${op.collection}\u0000${op.id}`, { c: op.collection, rec: r.rec });
        r.key = `${op.collection}\u0000${op.id}`;
        delete r.rec;
      }
      return r;
    });
    const changes = [];
    for (const t of touched.values()) {
      t.rec.seq = ++this.seq;
      t.rec.ts = now;
      t.rec.by = ctx.userId;
      changes.push(change(t.c, t.rec));
    }
    for (const r of results) {
      if (r.key) r.seq = touched.get(r.key).rec.seq;
      delete r.key;
    }
    if (changes.length) {
      this.#dirty();
      this.emit('change', { seq: this.seq, changes, origin: ctx.clientId });
    }
    return { seq: this.seq, results };
  }

  #applyOne(op, ctx, now) {
    const { collection: c, id } = op;
    let at = Number(op.at);
    if (!Number.isFinite(at) || at <= 0 || at > now + 60_000) at = now; // clamp clocks that run ahead
    let col = this.cols.get(c);
    if (!col) {
      if (this.cols.size >= MAX_COLLECTIONS) return { status: 'denied', error: 'too_many_collections' };
      col = new Map();
      this.cols.set(c, col);
    }
    const rec = col.get(id);
    const current = rec && !rec.del ? rec.data : undefined;
    const reason = ctx.check?.(op, current);
    if (reason) return { status: 'denied', error: reason };

    if (op.op === 'remove') {
      if (!rec) {
        col.set(id, { id, data: { id }, at: nullObj(), cseq: ++this.cseq, seq: 0, del: at, ts: now });
        this.#dirty();
        return { status: 'ok' };
      }
      if (rec.del) return { status: 'ok' };
      if (at < maxAt(rec)) return { status: 'stale' };
      rec.del = at;
      return { status: 'ok', rec };
    }

    if (op.op === 'upsert') {
      if (!rec) {
        const data = { ...op.data, id };
        const fieldAt = nullObj();
        for (const f of Object.keys(data)) fieldAt[f] = at;
        const nr = { id, data, at: fieldAt, cseq: ++this.cseq, seq: 0, del: 0, ts: now };
        col.set(id, nr);
        return { status: 'ok', rec: nr };
      }
      if (rec.del && rec.del > at) return { status: 'stale' };
      const base = rec.del ? { id } : { ...rec.data };
      if (rec.del) for (const f of Object.keys(rec.at)) rec.at[f] = Math.max(rec.at[f], rec.del);
      let partial = false;
      for (const [f, v] of Object.entries(op.data)) {
        if (f === 'id') continue;
        if (at >= (rec.at[f] ?? 0)) {
          base[f] = v;
          rec.at[f] = at;
        } else partial = true;
      }
      for (const f of Object.keys(base)) {
        if (f === 'id' || f in op.data) continue;
        if (at >= (rec.at[f] ?? 0)) {
          delete base[f];
          rec.at[f] = at; // tombstone: an older write cannot bring the field back
        } else partial = true;
      }
      if (rec.del) rec.cseq = ++this.cseq;
      rec.data = base;
      rec.del = 0;
      return { status: partial ? 'partial' : 'ok', rec };
    }

    // patch
    if (!rec) return { status: 'missing' };
    if (rec.del) return { status: 'stale' };
    if (op.ifUnset) {
      const v = rec.data[op.ifUnset];
      if (v !== undefined && v !== null) return { status: 'conflict' };
    }
    const next = { ...rec.data };
    let applied = 0;
    let skipped = 0;
    for (const [f, v] of Object.entries(op.data ?? {})) {
      if (f === 'id') continue;
      if (at >= (rec.at[f] ?? 0)) {
        next[f] = v;
        rec.at[f] = at;
        applied++;
      } else skipped++;
    }
    for (const f of op.unset ?? []) {
      if (f === 'id') continue;
      if (at >= (rec.at[f] ?? 0)) {
        delete next[f];
        rec.at[f] = at;
        applied++;
      } else skipped++;
    }
    if (!applied) return { status: skipped ? 'stale' : 'ok' };
    rec.data = next;
    return { status: skipped ? 'partial' : 'ok', rec };
  }

  /** First-run import of the app's seed snapshot. Arrays are newest-first, like the app keeps them. */
  importSnapshot({ collections = {}, config, settings, counters = {} }, ctx = {}) {
    const now = this.now();
    for (const [c, list] of Object.entries(collections)) {
      const col = new Map();
      for (const item of [...list].reverse()) {
        col.set(item.id, { id: item.id, data: item, at: fieldsAt(item, now), cseq: ++this.cseq, seq: ++this.seq, del: 0, ts: now, by: ctx.userId });
      }
      this.cols.set(c, col);
    }
    for (const [c, data] of [['config', config], ['settings', settings]]) {
      if (!data) continue;
      const doc = { ...data, id: SINGLETON_ID };
      this.cols.set(c, new Map([[SINGLETON_ID, { id: SINGLETON_ID, data: doc, at: fieldsAt(doc, now), cseq: ++this.cseq, seq: ++this.seq, del: 0, ts: now }]]));
    }
    for (const [k, v] of Object.entries(counters)) if (COUNTER_RE.test(k) && Number(v) >= 0) this.counters.set(k, Math.floor(Number(v)));
    this.meta.bootstrappedAt = new Date(now).toISOString();
    this.#dirty();
    this.emit('change', { seq: this.seq, changes: [], reset: true });
  }

  // ------------------------------------------------------------ counters

  /** Reserves `count` consecutive numbers: { key, from, to }. */
  reserve(key, count = 1) {
    const cur = this.counters.get(key) ?? 0;
    const to = cur + count;
    this.counters.set(key, to);
    this.#dirty();
    return { key, from: cur + 1, to };
  }

  // ------------------------------------------------------------ auth state (never part of snapshots)

  ensureSecret() {
    if (!this.auth.secret) {
      this.auth.secret = randomBytes(32).toString('base64url');
      this.#dirty();
    }
    return this.auth.secret;
  }

  setCredential(userId, cred) {
    this.auth.credentials.set(userId, cred);
    this.#dirty();
  }

  revoke(sid, exp) {
    this.auth.revoked.set(sid, exp);
    this.#dirty();
  }

  touch() {
    this.#dirty();
  }

  // ------------------------------------------------------------ persistence

  #dirty() {
    if (!this.adapter) return;
    const now = Date.now();
    if (!this.firstDirtyAt) this.firstDirtyAt = now;
    if (this.timer) clearTimeout(this.timer);
    const wait = Math.max(0, Math.min(this.flushMs, this.firstDirtyAt + this.maxWaitMs - now));
    this.timer = setTimeout(() => void this.flush(), wait);
    this.timer.unref?.();
  }

  /** Writes the current state now (also called on shutdown). */
  async flush() {
    if (!this.adapter) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.saving) {
      await this.saving;
      if (!this.firstDirtyAt) return;
    }
    this.firstDirtyAt = 0;
    this.saving = this.adapter.save(this.toJSON()).catch((err) => {
      console.error('[genair-server] saving the database failed:', err?.message ?? err);
      this.firstDirtyAt = this.firstDirtyAt || Date.now();
    });
    try {
      await this.saving;
    } finally {
      this.saving = null;
    }
  }
}

function fieldsAt(data, at) {
  const o = nullObj();
  for (const f of Object.keys(data)) o[f] = at;
  return o;
}

function change(c, r) {
  return r.del ? { c, id: r.id, seq: r.seq, del: true } : { c, id: r.id, seq: r.seq, data: r.data };
}
