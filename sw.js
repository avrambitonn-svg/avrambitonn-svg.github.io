/* Service worker (נוצר ב-build על ידי scripts/build-sw.mjs). לא נוגע בהתקדמות: היא ב-localStorage וב-IndexedDB. */
const VERSION = '887e2c6931d7'
const CACHE = `math-course-${VERSION}`
const URLS = ["/apple-touch-icon.png","/assets/BalanceGame-DNlOcOg8.js","/assets/CompareGame-CuI3_5xQ.js","/assets/DemoExercise-fyRresSI.js","/assets/DevExercisesPage-CJDus9Hq.js","/assets/DiagnosticPage-BTIPSHHX.js","/assets/DrillPage-DdH7lGsE.js","/assets/ExampleBlock-CjjYXsbv.js","/assets/ExerciseView-hD0330Vg.js","/assets/GamesPage-DNp9uMzT.js","/assets/KaTeX_AMS-Regular-BQhdFMY1.woff2","/assets/KaTeX_Caligraphic-Bold-Dq_IR9rO.woff2","/assets/KaTeX_Caligraphic-Regular-Di6jR-x-.woff2","/assets/KaTeX_Fraktur-Bold-CL6g_b3V.woff2","/assets/KaTeX_Fraktur-Regular-CTYiF6lA.woff2","/assets/KaTeX_Main-Bold-Cx986IdX.woff2","/assets/KaTeX_Main-BoldItalic-DxDJ3AOS.woff2","/assets/KaTeX_Main-Italic-NWA7e6Wa.woff2","/assets/KaTeX_Main-Regular-B22Nviop.woff2","/assets/KaTeX_Math-BoldItalic-CZnvNsCZ.woff2","/assets/KaTeX_Math-Italic-t53AETM-.woff2","/assets/KaTeX_SansSerif-Bold-D1sUS0GD.woff2","/assets/KaTeX_SansSerif-Italic-C3H0VqGB.woff2","/assets/KaTeX_SansSerif-Regular-DDBCnlJ7.woff2","/assets/KaTeX_Script-Regular-D3wIWfF6.woff2","/assets/KaTeX_Size1-Regular-mCD8mA8B.woff2","/assets/KaTeX_Size2-Regular-Dy4dx90m.woff2","/assets/KaTeX_Size4-Regular-Dl5lxZxV.woff2","/assets/KaTeX_Typewriter-Regular-CO6r4hn1.woff2","/assets/LessonPage-BVu7bkP0.js","/assets/MemoryCheckPage-CDg6LZj2.js","/assets/PairsGame-BlOvq_Mn.js","/assets/PelesGame-hmirTqgx.js","/assets/PlacementPage-Mx4pM3Nh.js","/assets/PracticeHub-pH45fXy5.js","/assets/PracticePage-DvOp73Uc.js","/assets/ReviewPage-DUPAlvsm.js","/assets/RtlTestPage-DqEGIqVn.js","/assets/SprintGame-ChK8peqD.js","/assets/StartPage-D2rL3uPq.js","/assets/TestPage-Cf2IPThq.js","/assets/U01-L01-DAVxsP2p.js","/assets/U01-L02-tEtaGdcv.js","/assets/U01-L03-CMDu07NR.js","/assets/U01-L04-DBuRRz4r.js","/assets/U01-drbVsQXk.js","/assets/U02-BiendluI.js","/assets/U02-L01-C0flrKXB.js","/assets/U02-L02-BGx184A-.js","/assets/U02-L03-CgqkxocG.js","/assets/U02-L04-B-HHXVmf.js","/assets/U02-L05-CancqPna.js","/assets/U02-L06-B0zbkWOZ.js","/assets/U03-D8mLbRZg.js","/assets/U03-L01-CfW63Tpy.js","/assets/U03-L02-DUfNTdjr.js","/assets/U03-L03-BWJkK1cp.js","/assets/U03-L04-CpC_1Dlw.js","/assets/U03-L05-D-03qCzx.js","/assets/U04-BYf3HThA.js","/assets/U04-L01-C-sJIvam.js","/assets/U04-L02-ptv6AYAJ.js","/assets/U04-L03-BGKWK5MT.js","/assets/U04-L04-BLir6l_R.js","/assets/U04-L05--xW5WaTF.js","/assets/U04-L06-BZlwBHGt.js","/assets/U04-L07-CT1cG1K0.js","/assets/U05-L01-C_VDUWTa.js","/assets/U05-L02-DR5CIyRy.js","/assets/U05-L03-CzyfHc82.js","/assets/U05-L04-Bf4qbycd.js","/assets/U05-L05-D2t5B1iL.js","/assets/U05-L06-v_HxecWd.js","/assets/U05-sN0UG92X.js","/assets/U07-DqgH1FqT.js","/assets/U07-L01-CRGbhvcn.js","/assets/U08--AyeZrla.js","/assets/U08-L01-9_XmOQiJ.js","/assets/U08-L02-BcUTpLf6.js","/assets/U08-L03-CoC7Kuyp.js","/assets/U08-L04-D1Hzv2m_.js","/assets/U08-L05-DxeNAN3T.js","/assets/U09-B-wkqU2L.js","/assets/U09-L01-BNJrAOjX.js","/assets/U09-L02-BWgIOcOj.js","/assets/U09-L03-BGswL3KE.js","/assets/U09-L04-DS7HKQbE.js","/assets/U09-L05-BUEX-brQ.js","/assets/U09-L06-Bgk_FnDJ.js","/assets/U10-DcZiWLZG.js","/assets/U10-L01-D4tanc5B.js","/assets/U10-L02-okhEgOsJ.js","/assets/U10-L04-DudNqAIb.js","/assets/U11-DnIXJ0Ri.js","/assets/U11-L02-ByZbgSSJ.js","/assets/U12-B-VN76ad.js","/assets/U12-L02-T6QW9f9v.js","/assets/U15-Chka518d.js","/assets/U15-L01-DEtKE3Ru.js","/assets/U15-L02-lm5C04Jn.js","/assets/U15-L03-DonTkFbk.js","/assets/U15-L04-Dyqkvmsq.js","/assets/U15-L05-BuCkDkPM.js","/assets/U18-L01-C8x36IAy.js","/assets/U18-L02-BSj15Wy_.js","/assets/U18-L03-BeQu3aR3.js","/assets/U18-L04-BAsjGu-x.js","/assets/U18-L05-B4AkJzWs.js","/assets/U18-L06-CQzEwyM2.js","/assets/U18-L07-CYKEvL8x.js","/assets/U18-g2IlrSin.js","/assets/U19-C0E9MPng.js","/assets/U19-L01-BCBwty_y.js","/assets/U19-L02-B_YrFHA6.js","/assets/U19-L03-CV6_zLaT.js","/assets/U19-L04-DlzQL_e-.js","/assets/U19-L05-DVyg4X8z.js","/assets/U19-L06-RaF177s3.js","/assets/U19-L07-CUF4eDKa.js","/assets/U21-L01-Bp2X_-NG.js","/assets/UnitTestPage-DHO74tte.js","/assets/actions-Bt9BOOnN.js","/assets/clock-t_s1TbNP.js","/assets/course-nav-eg9w0mgl.js","/assets/drill-0M6AgwA3.js","/assets/games-DUC8SCQK.css","/assets/index-Bax3T9dG.js","/assets/index-odYV5JeJ.css","/assets/params-DYRRNhCM.js","/assets/random-CxILBDym.js","/assets/rubik-hebrew-BIkpbuMU.woff2","/assets/rubik-latin-CnQIisVs.woff2","/assets/stop-DTXi74g6.js","/assets/ui-CDOr1SKN.js","/assets/useLearned-pXaukrfY.js","/favicon.svg","/icon-192.png","/icon-512.png","/icon-maskable.png","/","/manifest.webmanifest"]
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
