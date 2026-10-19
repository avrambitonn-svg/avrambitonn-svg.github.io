// עבודה בלי קליטה: קבצי האפליקציה נשמרים במטמון; הנתונים כבר שמורים ב-IndexedDB של הדפדפן
const CACHE = 'genair-ops-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith('genair-ops-') && key !== CACHE) await caches.delete(key)
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  // רשת קודם, ובלי רשת מהמטמון
  event.respondWith(
    (async () => {
      try {
        const res = await fetch(req)
        if (res.ok) (await caches.open(CACHE)).put(req, res.clone())
        return res
      } catch {
        const hit = await caches.match(req)
        if (hit) return hit
        if (req.mode === 'navigate') return (await caches.match('./')) ?? (await caches.match('./index.html')) ?? Response.error()
        return Response.error()
      }
    })(),
  )
})
