// Stands in for server/src/limiter.js inside the Edge Function (the bundler swaps it in). Fixed-window limiters
// count in the database (sys_hit), so every instance of the function shares them; the rest is the server's.
export { createRateLimiter, parseRetryAfter, backoffDelay, defaultSleep } from '../../../../server/src/limiter.js';

let rpc = null;
/** The router hands over the service-role RPC once per request (the same for every request of an instance). */
export const setLimiterRpc = (fn) => {
  rpc = fn;
};

/** Same interface as the server's, but async: hit / peek resolve to { allowed, retryAfterMs }. `name` keeps limiters apart. */
export function createWindowLimiter({ max, windowMs, name }) {
  if (!name) throw new Error('createWindowLimiter: name is required in the Edge Function');
  const call = async (key, peek) => {
    if (!rpc) throw new Error('limiter used before setLimiterRpc');
    try {
      return await rpc('sys_hit', { p_key: `${name}|${key}`, p_max: max, p_window_ms: windowMs, p_peek: peek });
    } catch (e) {
      // the database is unreachable: let the request through rather than lock everyone out
      console.error('[genair-api] rate limit check failed:', e?.message ?? e);
      return { allowed: true, retryAfterMs: 0 };
    }
  };
  return {
    hit: (key) => call(key, false),
    peek: (key) => call(key, true),
    reset() {},
    clear() {},
  };
}
