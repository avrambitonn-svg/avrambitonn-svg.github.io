/* Service worker (נוצר ב-build על ידי scripts/build-sw.mjs). לא נוגע בהתקדמות: היא ב-localStorage וב-IndexedDB. */
const VERSION = '7f5774fd2e60'
const CACHE = `math-course-${VERSION}`
const URLS = ["/apple-touch-icon.png","/assets/DemoExercise-UexE6_Rz.js","/assets/DevExercisesPage-CrWsUkmo.js","/assets/DiagnosticPage-PmrYO9lW.js","/assets/ExampleBlock-BuHubdIw.js","/assets/ExerciseView-C69vn0NZ.js","/assets/KaTeX_AMS-Regular-BQhdFMY1.woff2","/assets/KaTeX_Caligraphic-Bold-Dq_IR9rO.woff2","/assets/KaTeX_Caligraphic-Regular-Di6jR-x-.woff2","/assets/KaTeX_Fraktur-Bold-CL6g_b3V.woff2","/assets/KaTeX_Fraktur-Regular-CTYiF6lA.woff2","/assets/KaTeX_Main-Bold-Cx986IdX.woff2","/assets/KaTeX_Main-BoldItalic-DxDJ3AOS.woff2","/assets/KaTeX_Main-Italic-NWA7e6Wa.woff2","/assets/KaTeX_Main-Regular-B22Nviop.woff2","/assets/KaTeX_Math-BoldItalic-CZnvNsCZ.woff2","/assets/KaTeX_Math-Italic-t53AETM-.woff2","/assets/KaTeX_SansSerif-Bold-D1sUS0GD.woff2","/assets/KaTeX_SansSerif-Italic-C3H0VqGB.woff2","/assets/KaTeX_SansSerif-Regular-DDBCnlJ7.woff2","/assets/KaTeX_Script-Regular-D3wIWfF6.woff2","/assets/KaTeX_Size1-Regular-mCD8mA8B.woff2","/assets/KaTeX_Size2-Regular-Dy4dx90m.woff2","/assets/KaTeX_Size4-Regular-Dl5lxZxV.woff2","/assets/KaTeX_Typewriter-Regular-CO6r4hn1.woff2","/assets/LessonPage-DmAx5_To.js","/assets/MemoryCheckPage-hFRD4dIx.js","/assets/PlacementPage-C6is8Rfa.js","/assets/PracticePage-DX1JIIvj.js","/assets/ReviewPage-D5PwUDgc.js","/assets/RtlTestPage-pHvikhmZ.js","/assets/StartPage-B6Rmfim5.js","/assets/TestPage-ORoRxTUR.js","/assets/U01-L01-DGjU45Ub.js","/assets/U01-L02-C_kCy7MM.js","/assets/U01-L03-CGSPocrX.js","/assets/U01-L04-l_lhuQ-d.js","/assets/U01-_9__CbiZ.js","/assets/U02-DmLemTVB.js","/assets/U02-L01-DimNgfZB.js","/assets/U02-L02-BQqphzVl.js","/assets/U02-L03-D9TXor_0.js","/assets/U02-L04-pjJtKINU.js","/assets/U02-L05-BTRuDq9x.js","/assets/U02-L06-DQpwOgJy.js","/assets/U03-BBXPWmze.js","/assets/U03-L01-D4rzGNkp.js","/assets/U03-L02-6-qxpmc_.js","/assets/U03-L03--jB3--bh.js","/assets/U03-L04-CthEvJn4.js","/assets/U03-L05-Oj7kTf9h.js","/assets/U08-L01-CNZV5Z-h.js","/assets/U08-L02-DqdSo1xp.js","/assets/U08-L03-hMAEwkGg.js","/assets/U08-L04-BgQIHw0d.js","/assets/U08-L05-CMq_SRCX.js","/assets/U08-SkakFE9M.js","/assets/U09-D3Bsv1I6.js","/assets/U09-L01-Bv_1Em_d.js","/assets/U09-L02--LWyiFc3.js","/assets/U09-L03-DizfeYVt.js","/assets/U09-L04-dO9-7GSu.js","/assets/U09-L05-CTHwQtWN.js","/assets/U09-L06-BXMjLSEo.js","/assets/U10-DcZiWLZG.js","/assets/U10-L01-C2xFGDr9.js","/assets/U10-L02-Djcs-mor.js","/assets/U10-L04-DudNqAIb.js","/assets/U11-DnIXJ0Ri.js","/assets/U11-L02-ByZbgSSJ.js","/assets/U12-B-VN76ad.js","/assets/U12-L02-T6QW9f9v.js","/assets/U15-Chka518d.js","/assets/U15-L01-CAmEobLU.js","/assets/U15-L02-kynTVd4v.js","/assets/U15-L03-p0gnFzGg.js","/assets/U15-L04-DoOJ0-dL.js","/assets/U15-L05-BuCkDkPM.js","/assets/U18-L01-C8x36IAy.js","/assets/U18-L02-BSj15Wy_.js","/assets/U18-L03-BeQu3aR3.js","/assets/U18-L04-D0pRoqQD.js","/assets/U18-L05-BBEUOkG-.js","/assets/U18-L06-CQzEwyM2.js","/assets/U18-L07-CYKEvL8x.js","/assets/U18-g2IlrSin.js","/assets/U19-C0E9MPng.js","/assets/U19-L01-BCBwty_y.js","/assets/U19-L02-B_YrFHA6.js","/assets/U19-L03-CV6_zLaT.js","/assets/U19-L04-DlzQL_e-.js","/assets/U19-L05-wABRKYEd.js","/assets/U19-L06-RaF177s3.js","/assets/U19-L07-CUF4eDKa.js","/assets/U21-L01-Bp2X_-NG.js","/assets/UnitTestPage-DC0-9Ehc.js","/assets/actions-Wn26n0jd.js","/assets/clock-t_s1TbNP.js","/assets/course-nav-cWb-ifNg.js","/assets/heebo-hebrew-wght-normal-BPH8bhzJ.woff2","/assets/heebo-latin-ext-wght-normal-D5vEfs3i.woff2","/assets/heebo-latin-wght-normal-CXdlclQD.woff2","/assets/heebo-math-wght-normal-9gsQVfT-.woff2","/assets/heebo-symbols-wght-normal-CDk8D5aH.woff2","/assets/index-BoZryF-i.js","/assets/index-DqWfX59o.css","/assets/params-Dldhlodb.js","/assets/stop-C6HMxO83.js","/favicon.svg","/icon-192.png","/icon-512.png","/icon-maskable.png","/","/manifest.webmanifest"]
const BASE = '/'

const broadcast = async (msg) => {
  for (const c of await self.clients.matchAll({ includeUncontrolled: true, type: 'window' })) c.postMessage(msg)
}

/**
 * precache חסין: בקבוצות של 6, קובץ שנכשל לא מפיל את השאר, ודיווח התקדמות לדפים (postMessage).
 * קבצים שכבר במטמון של הגרסה הזו לא נטענים שוב (ממשיכים מאיפה שנעצר).
 */
let running = null
function precache() {
  if (running) return running
  running = (async () => {
    const cache = await caches.open(CACHE)
    const have = new Set((await cache.keys()).map((r) => new URL(r.url).pathname))
    const todo = URLS.filter((u) => !have.has(u))
    let done = URLS.length - todo.length
    let failed = 0
    await broadcast({ type: 'precache', version: VERSION, done, total: URLS.length })
    for (let i = 0; i < todo.length; i += 6) {
      await Promise.all(todo.slice(i, i + 6).map(async (u) => {
        try {
          const res = await fetch(u, { cache: 'reload' })
          if (!res.ok) throw new Error(String(res.status))
          await cache.put(u, res)
          done++
        } catch {
          failed++
        }
      }))
      await broadcast({ type: 'precache', version: VERSION, done, total: URLS.length })
    }
    await broadcast({ type: 'precache', version: VERSION, done, total: URLS.length, finished: true, failed })
    return failed
  })().finally(() => { running = null })
  return running
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    await precache()
    // התקנה ראשונה (אין גרסה פעילה): שולטים בדף הנוכחי מיד, בלי רענון.
    // עדכון גרסה: מחכים עד שהלומד מאשר "לרענן" (לא באמצע שיעור).
    if (!self.registration.active) await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('math-course-') && key !== CACHE) await caches.delete(key)
    await self.clients.claim()
  })())
})

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
  if (event.data === 'RETRY') event.waitUntil(precache())
  if (event.data === 'STATUS') {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE)
      const keys = new Set((await cache.keys()).map((r) => new URL(r.url).pathname))
      const done = URLS.filter((u) => keys.has(u)).length
      event.source?.postMessage({ type: 'precache', version: VERSION, done, total: URLS.length, finished: !running, failed: running ? 0 : URLS.length - done })
    })())
  }
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (req.mode === 'navigate') {
    // ניווט: הרשת קודם (תוכן עדכני); בלי רשת, או אם השרת לא עונה, index.html מהמטמון
    event.respondWith(fetch(req).catch(async () => (await caches.match(BASE, { cacheName: CACHE, ignoreVary: true })) ?? (await caches.match(BASE, { ignoreVary: true })) ?? Response.error()))
    return
  }
  event.respondWith(caches.match(req, { ignoreVary: true }).then((hit) => hit ?? fetch(req)))
})
