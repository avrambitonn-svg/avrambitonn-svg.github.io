/* Service worker (נוצר ב-build על ידי scripts/build-sw.mjs). לא נוגע בהתקדמות: היא ב-localStorage. */
const VERSION = '05c4217c21f2'
const CACHE = `math-course-${VERSION}`
const URLS = ["/apple-touch-icon.png","/assets/DemoExercise-C0TQebEG.js","/assets/DevExercisesPage-OH9Z0-Qt.js","/assets/ExampleBlock-zcwSJNKI.js","/assets/ExerciseView-z7SQWIkV.js","/assets/KaTeX_AMS-Regular-BQhdFMY1.woff2","/assets/KaTeX_Caligraphic-Bold-Dq_IR9rO.woff2","/assets/KaTeX_Caligraphic-Regular-Di6jR-x-.woff2","/assets/KaTeX_Fraktur-Bold-CL6g_b3V.woff2","/assets/KaTeX_Fraktur-Regular-CTYiF6lA.woff2","/assets/KaTeX_Main-Bold-Cx986IdX.woff2","/assets/KaTeX_Main-BoldItalic-DxDJ3AOS.woff2","/assets/KaTeX_Main-Italic-NWA7e6Wa.woff2","/assets/KaTeX_Main-Regular-B22Nviop.woff2","/assets/KaTeX_Math-BoldItalic-CZnvNsCZ.woff2","/assets/KaTeX_Math-Italic-t53AETM-.woff2","/assets/KaTeX_SansSerif-Bold-D1sUS0GD.woff2","/assets/KaTeX_SansSerif-Italic-C3H0VqGB.woff2","/assets/KaTeX_SansSerif-Regular-DDBCnlJ7.woff2","/assets/KaTeX_Script-Regular-D3wIWfF6.woff2","/assets/KaTeX_Size1-Regular-mCD8mA8B.woff2","/assets/KaTeX_Size2-Regular-Dy4dx90m.woff2","/assets/KaTeX_Size4-Regular-Dl5lxZxV.woff2","/assets/KaTeX_Typewriter-Regular-CO6r4hn1.woff2","/assets/LessonPage-CpyzWYbk.js","/assets/MemoryCheckPage-BMQdxBYH.js","/assets/PlacementPage-LZDoy-XU.js","/assets/PracticePage-kSjALCwZ.js","/assets/ReviewPage-AFEaKB4y.js","/assets/RtlTestPage-DXv4uDHd.js","/assets/StartPage-BhitW4SP.js","/assets/TestPage-C1r4dr0I.js","/assets/U01-L01-BBrbBLnG.js","/assets/U01-L02-Btskl7F2.js","/assets/U01-L03-DWb_vCU7.js","/assets/U01-L04-DdXQZW9y.js","/assets/U01-qYyZIh8D.js","/assets/U02-BWqeTGXv.js","/assets/U02-L01-y7LGHfck.js","/assets/U02-L02-DK4Vm3R_.js","/assets/U02-L03-DwhZR1jf.js","/assets/U02-L04-Cv2RYUMu.js","/assets/U02-L05-Byun0kXe.js","/assets/U02-L06-BaksI4WK.js","/assets/U03-BYKIS2HH.js","/assets/U03-L01-DNMB5H_E.js","/assets/U03-L02-CY8Ud00o.js","/assets/U03-L03-BQaiHyQs.js","/assets/U03-L04-yn2fu_lS.js","/assets/U03-L05-DHE9gEYY.js","/assets/U08-L01-DAkrXVKY.js","/assets/U08-L02-CEpiqD64.js","/assets/U08-L03-B56XURNJ.js","/assets/U08-L04-BAVeMUTv.js","/assets/U08-L05-MuOJ87Kx.js","/assets/U08-fTBtYMZ-.js","/assets/U09-8Z2zbl3a.js","/assets/U09-L01-DT9-Wiin.js","/assets/U09-L02-4LiKGwY1.js","/assets/U09-L03-BBst4Mnf.js","/assets/U09-L04-BmaW2Z4b.js","/assets/U09-L05-QrRwBtKE.js","/assets/U09-L06-DwE1DdYl.js","/assets/U10-Cn9GqbXq.js","/assets/U10-L01-B-ps-19e.js","/assets/U10-L02-CMwX8xrm.js","/assets/U10-L04-CpdvQjFa.js","/assets/U11-DcxgQPsX.js","/assets/U11-L02-d_GgmPpn.js","/assets/U15-L01-CSBOxfKz.js","/assets/U15-L02-BBAYpfEh.js","/assets/U15-L03-DgkH-bSC.js","/assets/U15-L04-C19I3lj2.js","/assets/U15-L05-DxM0O8pB.js","/assets/U15-ktFMQi4a.js","/assets/U18-7g6VN68H.js","/assets/U18-L01-CPou25IZ.js","/assets/U18-L02-CyvR5rC-.js","/assets/U18-L03-DpsFR7TR.js","/assets/U18-L04-CCVxd4Nx.js","/assets/U18-L05-C0i9qulw.js","/assets/U18-L06-Be2J4uBd.js","/assets/U18-L07-COwCAECe.js","/assets/U19-B2QCriw5.js","/assets/U19-L01-Bj_DLmgJ.js","/assets/U19-L02-CP-Q91Fh.js","/assets/U19-L03-C-6Qjwd-.js","/assets/U19-L04-DujdfFY8.js","/assets/U19-L05-DMSSj7Qn.js","/assets/U19-L06-DSx4R0Sx.js","/assets/U19-L07-DBIpUFXE.js","/assets/U21-L01-3AEqyYu7.js","/assets/UnitTestPage-BD3BIx7X.js","/assets/actions-B-N-Z6zO.js","/assets/clock-t_s1TbNP.js","/assets/course-nav-Dq5Eg8hf.js","/assets/heebo-hebrew-wght-normal-BPH8bhzJ.woff2","/assets/heebo-latin-ext-wght-normal-D5vEfs3i.woff2","/assets/heebo-latin-wght-normal-CXdlclQD.woff2","/assets/heebo-math-wght-normal-9gsQVfT-.woff2","/assets/heebo-symbols-wght-normal-CDk8D5aH.woff2","/assets/index-YuFD8svp.css","/assets/index-qjIIuDLS.js","/assets/params-Iuxe7hwG.js","/assets/stop-C9GoLdUX.js","/favicon.svg","/icon-192.png","/icon-512.png","/icon-maskable.png","/","/manifest.webmanifest"]
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
