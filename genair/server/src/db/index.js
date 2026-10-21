// One store per process (per DB_MODE + DATA_DIR). Loaded lazily on the first request that needs it.
import { DocStore } from './store.js';
import { JsonFileAdapter, MemoryAdapter } from './adapters.js';
import { HttpError } from '../http.js';

const stores = new Map();

export function storeKey(cfg) {
  return `${cfg.db.mode}|${cfg.db.dataDir}`;
}

/** The store for this config, or null when DB_MODE=off. */
export function getStore(cfg) {
  if (cfg.db.mode === 'off') return null;
  const key = storeKey(cfg);
  let p = stores.get(key);
  if (!p) {
    const adapter = cfg.db.mode === 'file' ? new JsonFileAdapter(cfg.db.dataDir, { encryptionKey: cfg.db.encryptionKey }) : new MemoryAdapter();
    p = new DocStore({ adapter, flushMs: cfg.db.flushMs }).init();
    p.catch(() => stores.delete(key));
    stores.set(key, p);
  }
  return p;
}

export async function requireStore(cfg) {
  const store = await getStore(cfg);
  if (!store) throw new HttpError(503, 'db_disabled', 'מסד הנתונים המשותף כבוי בשרת הזה (DB_MODE=off)');
  return store;
}

/** Writes every loaded store (shutdown). */
export async function flushAll() {
  for (const p of stores.values()) {
    try {
      await (await p).flush();
    } catch {
      /* already logged */
    }
  }
}

/** Tests: forget all stores. */
export function resetStores() {
  stores.clear();
}
