/* Service worker (נוצר ב-build על ידי scripts/build-sw.mjs). לא נוגע בהתקדמות: היא ב-localStorage. */
const VERSION = '5b0f23a7bd1f'
const CACHE = `math-course-${VERSION}`
const URLS = ["/apple-touch-icon.png","/assets/DemoExercise-Dx_vwA-i.js","/assets/DevExercisesPage-DUPP0VAZ.js","/assets/DiagnosticPage-ClBeLtcQ.js","/assets/ExampleBlock-DM3acZn9.js","/assets/ExerciseView-Bdr9SJiB.js","/assets/KaTeX_AMS-Regular-BQhdFMY1.woff2","/assets/KaTeX_Caligraphic-Bold-Dq_IR9rO.woff2","/assets/KaTeX_Caligraphic-Regular-Di6jR-x-.woff2","/assets/KaTeX_Fraktur-Bold-CL6g_b3V.woff2","/assets/KaTeX_Fraktur-Regular-CTYiF6lA.woff2","/assets/KaTeX_Main-Bold-Cx986IdX.woff2","/assets/KaTeX_Main-BoldItalic-DxDJ3AOS.woff2","/assets/KaTeX_Main-Italic-NWA7e6Wa.woff2","/assets/KaTeX_Main-Regular-B22Nviop.woff2","/assets/KaTeX_Math-BoldItalic-CZnvNsCZ.woff2","/assets/KaTeX_Math-Italic-t53AETM-.woff2","/assets/KaTeX_SansSerif-Bold-D1sUS0GD.woff2","/assets/KaTeX_SansSerif-Italic-C3H0VqGB.woff2","/assets/KaTeX_SansSerif-Regular-DDBCnlJ7.woff2","/assets/KaTeX_Script-Regular-D3wIWfF6.woff2","/assets/KaTeX_Size1-Regular-mCD8mA8B.woff2","/assets/KaTeX_Size2-Regular-Dy4dx90m.woff2","/assets/KaTeX_Size4-Regular-Dl5lxZxV.woff2","/assets/KaTeX_Typewriter-Regular-CO6r4hn1.woff2","/assets/LessonPage-uLE4VLrn.js","/assets/MemoryCheckPage-K2nHgl6-.js","/assets/PlacementPage-CwpvzX6H.js","/assets/PracticePage-CTfWaFGE.js","/assets/ReviewPage-DIQchkBl.js","/assets/RtlTestPage-MIZVGKGR.js","/assets/StartPage-DrC4plsm.js","/assets/TestPage-D62fDxSz.js","/assets/U01-L01-DXW6gy4t.js","/assets/U01-L02-BfTqONW6.js","/assets/U01-L03-3j92euaA.js","/assets/U01-L04-Du1p7fh1.js","/assets/U01-qYyZIh8D.js","/assets/U02-BWqeTGXv.js","/assets/U02-L01-CBayJlKV.js","/assets/U02-L02-Md3Z07ZV.js","/assets/U02-L03-D_eHnLAV.js","/assets/U02-L04-CnBgMtCF.js","/assets/U02-L05-irmLYMv4.js","/assets/U02-L06-DC-b4ohg.js","/assets/U03-BYKIS2HH.js","/assets/U03-L01-Df4xl3Hp.js","/assets/U03-L02-BtLFdQIB.js","/assets/U03-L03-BbX1Dmjg.js","/assets/U03-L04-X5N9L7VT.js","/assets/U03-L05-DMekVfqv.js","/assets/U08-L01-B3YK8k80.js","/assets/U08-L02-Cdpr4-TW.js","/assets/U08-L03-Dz80DraS.js","/assets/U08-L04-yODdZDUE.js","/assets/U08-L05-BMLfi7Z5.js","/assets/U08-fTBtYMZ-.js","/assets/U09-8Z2zbl3a.js","/assets/U09-L01-Dlgzr2RD.js","/assets/U09-L02-D6x6Sfr5.js","/assets/U09-L03-BRJ5Hbtv.js","/assets/U09-L04-DhFoVa3D.js","/assets/U09-L05-uqDJIjNm.js","/assets/U09-L06-BKyvwqXp.js","/assets/U10-Cn9GqbXq.js","/assets/U10-L01-S7PKQgvz.js","/assets/U10-L02-gdca3RXG.js","/assets/U10-L04-CW7_KxMa.js","/assets/U11-DcxgQPsX.js","/assets/U11-L02-DdsHAAzj.js","/assets/U15-L01-pfguO9nq.js","/assets/U15-L02-BTuoOYA5.js","/assets/U15-L03-B2nTV6Ws.js","/assets/U15-L04-DrUlWhEA.js","/assets/U15-L05-DNAMcanA.js","/assets/U15-ktFMQi4a.js","/assets/U18-7g6VN68H.js","/assets/U18-L01-BdBktDqz.js","/assets/U18-L02-B9mfvpL2.js","/assets/U18-L03-BWkyDOtE.js","/assets/U18-L04-BdanGg7E.js","/assets/U18-L05-AFv1N-Im.js","/assets/U18-L06-fOm1tcgx.js","/assets/U18-L07-DvezZuRi.js","/assets/U19-B2QCriw5.js","/assets/U19-L01-DyLgccRk.js","/assets/U19-L02-CmBBq-mb.js","/assets/U19-L03-l1dTtgUU.js","/assets/U19-L04-B6N1eePX.js","/assets/U19-L05-D8YRUlXG.js","/assets/U19-L06-BKhxBgRZ.js","/assets/U19-L07-C-1wrhQO.js","/assets/U21-L01-B568ONS5.js","/assets/UnitTestPage-DlD7eDay.js","/assets/actions-CgMaYWlU.js","/assets/clock-t_s1TbNP.js","/assets/course-nav-Bmw8bXvH.js","/assets/heebo-hebrew-wght-normal-BPH8bhzJ.woff2","/assets/heebo-latin-ext-wght-normal-D5vEfs3i.woff2","/assets/heebo-latin-wght-normal-CXdlclQD.woff2","/assets/heebo-math-wght-normal-9gsQVfT-.woff2","/assets/heebo-symbols-wght-normal-CDk8D5aH.woff2","/assets/index-BXhHcTWr.js","/assets/index-YuFD8svp.css","/assets/params-5AS1NTbx.js","/assets/stop-CJdV9hG3.js","/favicon.svg","/icon-192.png","/icon-512.png","/icon-maskable.png","/","/manifest.webmanifest"]
const BASE = '/'

self.addEventListener('install', (event) => {
  // לא skipWaiting: גרסה חדשה מחכה עד שהלומד מאשר רענון (לא באמצע שיעור)
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(URLS)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('math-course-') && key !== CACHE) await caches.delete(key)
    await self.clients.claim()
  })())
})

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (req.mode === 'navigate') {
    // ניווט: הרשת קודם (תוכן עדכני), ובלי רשת index.html מהמטמון
    event.respondWith(fetch(req).catch(() => caches.match(BASE, { cacheName: CACHE, ignoreVary: true })))
    return
  }
  event.respondWith(caches.match(req, { cacheName: CACHE, ignoreVary: true }).then((hit) => hit ?? fetch(req)))
})
