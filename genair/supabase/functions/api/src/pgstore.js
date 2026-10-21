// The server's DocStore over Supabase, for one request: loaded from sys_dump(), every write applied in memory
// (so the server's modules read their own writes) and queued, then sent in order with sys_apply before the
// response. The database merges per field by `at` exactly like DocStore, so the same ops give the same rows.
// Counters are reserved in the database (sys_reserve), never in memory: two requests never get the same number.
import { DocStore } from '../../../../server/src/db/store.js';

const MAX_BATCH = 500; // sys_apply's limit

function toState(dump) {
  const collections = dump?.collections ?? {};
  let cseq = 0;
  for (const recs of Object.values(collections)) for (const r of recs ?? []) if (r.cseq > cseq) cseq = r.cseq;
  return { seq: dump?.seq ?? 0, cseq, counters: dump?.counters ?? {}, collections };
}

export class PgStore extends DocStore {
  /** rpc(name, args) -> JSON, as the service role */
  constructor(rpc) {
    super({ adapter: { load: async () => toState(await rpc('sys_dump')) } });
    this.rpc = rpc;
    this.pending = []; // [{ op, origin }]
    this.persisting = Promise.resolve();
  }

  async init() {
    await super.init();
    this.adapter = null; // nothing is saved as a whole file: no save timers, writes go through persist()
    return this;
  }

  applyOps(ops, ctx = {}) {
    const now = this.now();
    const norm = ops.map((op) => {
      let at = Number(op.at);
      if (!Number.isFinite(at) || at <= 0 || at > now + 60_000) at = now; // the same clamp, so memory and database agree
      const o = { ...op, at };
      // a field set to undefined is gone in memory (and in the old JSON file); in the database that is an unset
      if (o.op === 'patch' && o.data) {
        const gone = Object.keys(o.data).filter((k) => o.data[k] === undefined);
        if (gone.length) {
          o.data = Object.fromEntries(Object.entries(o.data).filter(([, v]) => v !== undefined));
          o.unset = [...new Set([...(o.unset ?? []), ...gone])];
        }
      }
      return o;
    });
    const out = super.applyOps(norm, ctx);
    const origin = String(ctx.userId ?? ctx.clientId ?? 'server');
    norm.forEach((op, i) => {
      if (out.results[i]?.status !== 'denied') this.pending.push({ op, origin });
    });
    return out;
  }

  /** { key, from, to }, atomic in the database. */
  async reserve(key, count = 1) {
    const r = await this.rpc('sys_reserve', { p_key: key, p_count: count });
    this.counters.set(key, Number(r.to));
    return { key, from: Number(r.from), to: Number(r.to) };
  }

  /** Sends the queued writes, oldest first. Returns how many ops were sent. */
  persist() {
    const run = this.persisting.then(() => this.#send());
    this.persisting = run.catch(() => {});
    return run;
  }

  async #send() {
    let sent = 0;
    while (this.pending.length) {
      const origin = this.pending[0].origin;
      let n = 0;
      while (n < this.pending.length && n < MAX_BATCH && this.pending[n].origin === origin) n++;
      const batch = this.pending.slice(0, n).map((p) => p.op);
      const r = await this.rpc('sys_apply', { ops: batch, origin });
      this.pending.splice(0, n);
      sent += n;
      const odd = (r?.results ?? []).filter((x) => x.status !== 'ok' && x.status !== 'partial');
      if (odd.length) console.warn(`[genair-api] ${odd.length} of ${n} writes were not applied (${[...new Set(odd.map((x) => x.status))].join(', ')})`);
    }
    return sent;
  }

  flush() {
    return this.persist();
  }
}
