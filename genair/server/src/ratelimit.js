// Per-user budgets for signed-in routes. The login and the public forms have their own counters (auth.js, portal.js);
// this is for the rest: a stolen or careless account must not be able to run up the AI bill, message customers
// without end, fill the disk or flood the database.
import { HttpError } from './http.js';
import { createWindowLimiter } from './limiter.js';

const registry = new Map();

function limiterFor(kind, max, windowMs) {
  const key = `${kind}|${max}|${windowMs}`;
  let l = registry.get(key);
  if (!l) registry.set(key, (l = createWindowLimiter({ max, windowMs })));
  return l;
}

/** Counts one use of `kind` by `key` (a user id); throws 429 once the budget for the window is spent. */
export function spend(kind, key, max, windowMs = 60_000) {
  if (!(max > 0)) return;
  const v = limiterFor(kind, max, windowMs).hit(String(key));
  if (!v.allowed) {
    const e = new HttpError(429, 'rate_limited', 'יותר מדי בקשות בזמן קצר. נסו שוב בעוד רגע', { kind });
    e.retryAfter = Math.max(1, Math.ceil(v.retryAfterMs / 1000));
    throw e;
  }
}

export const resetUserLimits = () => registry.clear();

// open streams (SSE, long-poll) per user
const streams = new Map();

/** Reserves a stream slot for the user; returns the function that frees it. Throws 429 when they have too many open. */
export function openStream(userId, max) {
  const n = streams.get(userId) ?? 0;
  if (max > 0 && n >= max) throw new HttpError(429, 'too_many_streams', 'יותר מדי חיבורים פתוחים מהמשתמש הזה. סגרו לשוניות או מכשירים ישנים');
  streams.set(userId, n + 1);
  let freed = false;
  return () => {
    if (freed) return;
    freed = true;
    const left = (streams.get(userId) ?? 1) - 1;
    if (left > 0) streams.set(userId, left);
    else streams.delete(userId);
  };
}

export const resetStreams = () => streams.clear();
