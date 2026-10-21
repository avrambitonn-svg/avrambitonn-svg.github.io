// Stands in for server/src/db/index.js inside the Edge Function (the bundler swaps it in): the store is the
// request's PgStore, loaded from Supabase on first use and persisted by the router before the response.
import { HttpError } from '../../../../server/src/http.js';

/** The request's store (cfg.edge is set per request by router.js). */
export function getStore(cfg) {
  if (!cfg?.edge) throw new HttpError(500, 'internal_error', 'שגיאה פנימית בשרת');
  return cfg.edge.store();
}

export const requireStore = (cfg) => getStore(cfg);
export const storeKey = () => 'supabase';
export async function flushAll() {}
export function resetStores() {}
