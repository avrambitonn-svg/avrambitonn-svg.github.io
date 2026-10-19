// Client-side throttling and retry helpers (clock and sleep are injectable for tests).

export const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

/**
 * Sliding-window limiter: at most `max` acquisitions per `windowMs`.
 * Callers are served in FIFO order. State is per process (per serverless instance).
 */
export function createRateLimiter({ max = 90, windowMs = 60_000, now = Date.now, sleep = defaultSleep } = {}) {
  const stamps = [];
  let chain = Promise.resolve();

  async function take() {
    for (;;) {
      const t = now();
      while (stamps.length && stamps[0] <= t - windowMs) stamps.shift();
      if (stamps.length < max) {
        stamps.push(t);
        return;
      }
      await sleep(stamps[0] + windowMs - t);
    }
  }

  return {
    acquire() {
      const p = chain.then(take);
      chain = p.catch(() => {});
      return p;
    },
    get inWindow() {
      const t = now();
      return stamps.filter((s) => s > t - windowMs).length;
    },
  };
}

/** Parses Retry-After (delta seconds or HTTP date) into milliseconds, or null. */
export function parseRetryAfter(value, now = Date.now) {
  if (value == null || value === '') return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - now());
}

/** Exponential backoff: base * 2^(attempt-1), attempt starts at 1. */
export function backoffDelay(attempt, { baseMs = 500, maxMs = 8_000 } = {}) {
  return Math.min(maxMs, baseMs * 2 ** (attempt - 1));
}
