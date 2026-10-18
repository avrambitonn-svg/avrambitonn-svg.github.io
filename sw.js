/* Service worker (נוצר ב-build על ידי scripts/build-sw.mjs). לא נוגע בהתקדמות: היא ב-localStorage. */
const VERSION = '53a73f7b27b9'
const CACHE = `math-course-${VERSION}`
const URLS = ["/apple-touch-icon.png","/assets/DemoExercise-BZ28krYt.js","/assets/DevExercisesPage-gikzEYJH.js","/assets/DiagnosticPage-Bk_z-2MO.js","/assets/ExampleBlock-B90lootL.js","/assets/ExerciseView-C_a-l60c.js","/assets/KaTeX_AMS-Regular-BQhdFMY1.woff2","/assets/KaTeX_Caligraphic-Bold-Dq_IR9rO.woff2","/assets/KaTeX_Caligraphic-Regular-Di6jR-x-.woff2","/assets/KaTeX_Fraktur-Bold-CL6g_b3V.woff2","/assets/KaTeX_Fraktur-Regular-CTYiF6lA.woff2","/assets/KaTeX_Main-Bold-Cx986IdX.woff2","/assets/KaTeX_Main-BoldItalic-DxDJ3AOS.woff2","/assets/KaTeX_Main-Italic-NWA7e6Wa.woff2","/assets/KaTeX_Main-Regular-B22Nviop.woff2","/assets/KaTeX_Math-BoldItalic-CZnvNsCZ.woff2","/assets/KaTeX_Math-Italic-t53AETM-.woff2","/assets/KaTeX_SansSerif-Bold-D1sUS0GD.woff2","/assets/KaTeX_SansSerif-Italic-C3H0VqGB.woff2","/assets/KaTeX_SansSerif-Regular-DDBCnlJ7.woff2","/assets/KaTeX_Script-Regular-D3wIWfF6.woff2","/assets/KaTeX_Size1-Regular-mCD8mA8B.woff2","/assets/KaTeX_Size2-Regular-Dy4dx90m.woff2","/assets/KaTeX_Size4-Regular-Dl5lxZxV.woff2","/assets/KaTeX_Typewriter-Regular-CO6r4hn1.woff2","/assets/LessonPage-Df5CWnhm.js","/assets/MemoryCheckPage-gQ7G2-xH.js","/assets/PlacementPage-CVuFNqvO.js","/assets/PracticePage-Dbzr4Xsx.js","/assets/ReviewPage-BRKkNHre.js","/assets/RtlTestPage-BAOMmDEx.js","/assets/StartPage-CuOYk4K-.js","/assets/TestPage-BECWD3aF.js","/assets/U01-DZJioVac.js","/assets/U01-L01-DIZRAhJH.js","/assets/U01-L02-BHFZF36J.js","/assets/U01-L03-DVTzy6n3.js","/assets/U01-L04-DVKV8fw4.js","/assets/U02--TBomCiH.js","/assets/U02-L01-r3OSRZ5R.js","/assets/U02-L02-CmPjpx8j.js","/assets/U02-L03-Bk2ILMBS.js","/assets/U02-L04-ICKGFTl4.js","/assets/U02-L05-C3svsiVN.js","/assets/U02-L06-BS_TKSlZ.js","/assets/U03-J6lFLdII.js","/assets/U03-L01-CSxN16mR.js","/assets/U03-L02-DxuDd3y7.js","/assets/U03-L03--jB3--bh.js","/assets/U03-L04-CthEvJn4.js","/assets/U03-L05-Oj7kTf9h.js","/assets/U08-C9Dnm2Fo.js","/assets/U08-L01-CNZV5Z-h.js","/assets/U08-L02-DqdSo1xp.js","/assets/U08-L03-hMAEwkGg.js","/assets/U08-L04-BgQIHw0d.js","/assets/U08-L05-CMq_SRCX.js","/assets/U09-D4TpMG-q.js","/assets/U09-L01-Bv_1Em_d.js","/assets/U09-L02--LWyiFc3.js","/assets/U09-L03-DizfeYVt.js","/assets/U09-L04-dO9-7GSu.js","/assets/U09-L05-CTHwQtWN.js","/assets/U09-L06-BXMjLSEo.js","/assets/U10-8jM-LjaK.js","/assets/U10-L01-C2xFGDr9.js","/assets/U10-L02-Djcs-mor.js","/assets/U10-L04-DudNqAIb.js","/assets/U11-DnIXJ0Ri.js","/assets/U11-L02-D7bCIRsM.js","/assets/U12-L02-CcGqdviZ.js","/assets/U12-rXsirjAk.js","/assets/U15-BpwEt7jY.js","/assets/U15-L01-1d_Ymo6O.js","/assets/U15-L02-97gv9LZk.js","/assets/U15-L03-D5fEvVt4.js","/assets/U15-L04-CqREqlXL.js","/assets/U15-L05-5-IHQc-F.js","/assets/U18-CH72M_ze.js","/assets/U18-L01-BAsIUIgn.js","/assets/U18-L02-CH3HiEwO.js","/assets/U18-L03--mf_tbtk.js","/assets/U18-L04-D0pRoqQD.js","/assets/U18-L05-BBEUOkG-.js","/assets/U18-L06-CQzEwyM2.js","/assets/U18-L07-CYKEvL8x.js","/assets/U19-DBIodaLi.js","/assets/U19-L01-DSMzi7ak.js","/assets/U19-L02-CDINuJ51.js","/assets/U19-L03-CY7qkGsB.js","/assets/U19-L04-DM1BFUd6.js","/assets/U19-L05-BtkXh8E4.js","/assets/U19-L06-BDGI8avr.js","/assets/U19-L07-77uvywrr.js","/assets/U21-L01-C11gUTsJ.js","/assets/UnitTestPage-DATx0fCm.js","/assets/actions-Dn-vqwDB.js","/assets/clock-t_s1TbNP.js","/assets/course-nav-BVa9m6b8.js","/assets/heebo-hebrew-wght-normal-BPH8bhzJ.woff2","/assets/heebo-latin-ext-wght-normal-D5vEfs3i.woff2","/assets/heebo-latin-wght-normal-CXdlclQD.woff2","/assets/heebo-math-wght-normal-9gsQVfT-.woff2","/assets/heebo-symbols-wght-normal-CDk8D5aH.woff2","/assets/index-BzHEiDJT.css","/assets/index-HC1RXEKw.js","/assets/params-C356anKQ.js","/assets/stop-DFMxIjCA.js","/favicon.svg","/icon-192.png","/icon-512.png","/icon-maskable.png","/","/manifest.webmanifest"]
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
