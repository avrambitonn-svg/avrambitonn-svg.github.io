import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backoffDelay, createRateLimiter, parseRetryAfter } from '../src/limiter.js';
import { createPriorityClient } from '../src/priority.js';

function fakeClock(start = 1_000_000) {
  let t = start;
  const sleeps = [];
  return {
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    advance: (ms) => {
      t += ms;
    },
    sleeps,
  };
}

const CFG = { serviceRoot: 'https://priority.example.invalid/odata/x', user: 'u', password: 'p' };
const noLimit = { acquire: async () => {} };

test('rate limiter allows max per window, then waits for the oldest slot', async () => {
  const c = fakeClock();
  const lim = createRateLimiter({ max: 3, windowMs: 1000, now: c.now, sleep: c.sleep });
  await lim.acquire();
  c.advance(100);
  await lim.acquire();
  await lim.acquire();
  assert.deepEqual(c.sleeps, []);
  await lim.acquire(); // 4th: must wait until the first stamp leaves the window
  assert.deepEqual(c.sleeps, [900]);
  assert.equal(lim.inWindow, 3);
});

test('rate limiter serves concurrent callers in order without exceeding the cap', async () => {
  const c = fakeClock();
  const lim = createRateLimiter({ max: 90, windowMs: 60_000, now: c.now, sleep: c.sleep });
  const times = [];
  await Promise.all(Array.from({ length: 200 }, () => lim.acquire().then(() => times.push(c.now()))));
  assert.equal(times.length, 200);
  for (let i = 90; i < times.length; i++) {
    assert.ok(times[i] - times[i - 90] >= 60_000, `call ${i} is within 60s of call ${i - 90}`);
  }
});

test('parseRetryAfter handles seconds, HTTP dates and junk', () => {
  const now = () => Date.parse('2026-10-19T10:00:00Z');
  assert.equal(parseRetryAfter('3', now), 3000);
  assert.equal(parseRetryAfter('Mon, 19 Oct 2026 10:00:05 GMT', now), 5000);
  assert.equal(parseRetryAfter('', now), null);
  assert.equal(parseRetryAfter(null, now), null);
  assert.equal(parseRetryAfter('soon', now), null);
});

test('backoffDelay grows exponentially and is capped', () => {
  assert.deepEqual([1, 2, 3, 4].map((a) => backoffDelay(a)), [500, 1000, 2000, 4000]);
  assert.equal(backoffDelay(10), 8000);
});

test('client retries 429 honouring Retry-After, then succeeds', async () => {
  const c = fakeClock();
  let n = 0;
  const client = createPriorityClient(CFG, {
    limiter: noLimit,
    sleep: c.sleep,
    now: c.now,
    fetchImpl: async () => (++n === 1 ? new Response('', { status: 429, headers: { 'retry-after': '2' } }) : Response.json({ value: [1] })),
  });
  assert.deepEqual(await client.get('CUSTOMERS', '$top=1'), { value: [1] });
  assert.equal(n, 2);
  assert.deepEqual(c.sleeps, [2000]);
});

test('client gives up after 3 attempts on 503 with exponential backoff', async () => {
  const c = fakeClock();
  let n = 0;
  const client = createPriorityClient(CFG, {
    limiter: noLimit,
    sleep: c.sleep,
    now: c.now,
    fetchImpl: async () => {
      n++;
      return new Response('down', { status: 503 });
    },
  });
  await assert.rejects(client.get('CUSTOMERS'), { status: 502, code: 'priority_unavailable' });
  assert.equal(n, 3);
  assert.deepEqual(c.sleeps, [500, 1000]);
});

test('client: persistent 429 -> 429 priority_rate_limited; huge Retry-After is not awaited', async () => {
  const c = fakeClock();
  let n = 0;
  const client = createPriorityClient(CFG, {
    limiter: noLimit,
    sleep: c.sleep,
    now: c.now,
    fetchImpl: async () => {
      n++;
      return new Response('', { status: 429, headers: { 'retry-after': '120' } });
    },
  });
  await assert.rejects(client.get('X'), { status: 429, code: 'priority_rate_limited' });
  assert.equal(n, 1);
  assert.deepEqual(c.sleeps, []);
});

test('client does not retry other 4xx; maps network errors and timeouts', async () => {
  let n = 0;
  const c400 = createPriorityClient(CFG, { limiter: noLimit, fetchImpl: async () => (n++, Response.json({ error: { message: 'bad' } }, { status: 400 })) });
  await assert.rejects(c400.get('X'), { status: 502, code: 'priority_rejected' });
  assert.equal(n, 1);

  const net = createPriorityClient(CFG, { limiter: noLimit, fetchImpl: async () => { throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }); } });
  await assert.rejects(net.get('X'), (err) => err.status === 502 && err.code === 'priority_unreachable' && err.details.reason === 'ENOTFOUND');

  const slow = createPriorityClient(CFG, { limiter: noLimit, fetchImpl: async () => { throw new DOMException('timed out', 'TimeoutError'); } });
  await assert.rejects(slow.get('X'), { status: 504, code: 'priority_timeout' });
});

test('client passes a 20s timeout signal and goes through the limiter', async () => {
  let acquired = 0;
  let signal;
  const client = createPriorityClient(CFG, {
    limiter: { acquire: async () => { acquired++; } },
    fetchImpl: async (url, init) => {
      signal = init.signal;
      return Response.json({ value: [] });
    },
  });
  await client.get('X');
  assert.equal(acquired, 1);
  assert.ok(signal instanceof AbortSignal);
});
