/* Service worker (נוצר ב-build על ידי scripts/build-sw.mjs). לא נוגע בהתקדמות: היא ב-localStorage וב-IndexedDB. */
const VERSION = '4926e7c2c710'
const CACHE = `math-course-${VERSION}`
const URLS = ["/","/apple-touch-icon.png","/assets/index-BLlX3j3Y.css","/assets/index-D8ssLzkW.js","/assets/params-Dznu24h1.js","/favicon.svg","/manifest.webmanifest","/assets/AnglesGame-LTTNQjW3.js","/assets/BalanceGame-BQjcsa8a.js","/assets/CompareGame-D-QCP_tC.js","/assets/DemoExercise-DF6TbotH.js","/assets/DevExercisesPage-Cnnbo7ug.js","/assets/DiagnosticPage-C5SyoOze.js","/assets/DrillPage-Co5AlJwo.js","/assets/ExampleBlock-CzpN34ki.js","/assets/ExerciseView-CRVUp6Vi.js","/assets/GameArt-xDUjQCZe.js","/assets/GamesPage-BfcNN8eG.js","/assets/KaTeX_AMS-Regular-BQhdFMY1.woff2","/assets/KaTeX_Caligraphic-Bold-Dq_IR9rO.woff2","/assets/KaTeX_Caligraphic-Regular-Di6jR-x-.woff2","/assets/KaTeX_Fraktur-Bold-CL6g_b3V.woff2","/assets/KaTeX_Fraktur-Regular-CTYiF6lA.woff2","/assets/KaTeX_Main-Bold-Cx986IdX.woff2","/assets/KaTeX_Main-BoldItalic-DxDJ3AOS.woff2","/assets/KaTeX_Main-Italic-NWA7e6Wa.woff2","/assets/KaTeX_Main-Regular-B22Nviop.woff2","/assets/KaTeX_Math-BoldItalic-CZnvNsCZ.woff2","/assets/KaTeX_Math-Italic-t53AETM-.woff2","/assets/KaTeX_SansSerif-Bold-D1sUS0GD.woff2","/assets/KaTeX_SansSerif-Italic-C3H0VqGB.woff2","/assets/KaTeX_SansSerif-Regular-DDBCnlJ7.woff2","/assets/KaTeX_Script-Regular-D3wIWfF6.woff2","/assets/KaTeX_Size1-Regular-mCD8mA8B.woff2","/assets/KaTeX_Size2-Regular-Dy4dx90m.woff2","/assets/KaTeX_Size4-Regular-Dl5lxZxV.woff2","/assets/KaTeX_Typewriter-Regular-CO6r4hn1.woff2","/assets/LessonPage-B0z4ayF4.js","/assets/LineGame-DjM7xXLv.js","/assets/MemoryCheckPage-Dgbr8C6V.js","/assets/MergeGame-b9Dv7IZO.js","/assets/PairsGame-rCrtnse1.js","/assets/ParabolaGame-AP0X5PrQ.js","/assets/PelesGame-DDD6ehr9.js","/assets/PlacementPage-DvxpzQTw.js","/assets/PracticeHub-Cw51Iq4o.js","/assets/PracticePage-Dhp0L6Lz.js","/assets/ReviewPage-CWIeV0BV.js","/assets/RtlTestPage-CwGHEvog.js","/assets/SprintGame-D-DrXqPP.js","/assets/StartPage-Cks19wxa.js","/assets/TargetGame-BIY_Dzh9.js","/assets/TestPage-F0w1gzD3.js","/assets/U01-drbVsQXk.js","/assets/U02-BiendluI.js","/assets/U03-D8mLbRZg.js","/assets/U04-BYf3HThA.js","/assets/U05-sN0UG92X.js","/assets/U06-DsxuPX3Y.js","/assets/U07-DqgH1FqT.js","/assets/U08-BfE0cWIA.js","/assets/U09-B-wkqU2L.js","/assets/U10-DcZiWLZG.js","/assets/U11-DnIXJ0Ri.js","/assets/U12-B-VN76ad.js","/assets/U13-C2atBXky.js","/assets/U15-Chka518d.js","/assets/U18-g2IlrSin.js","/assets/U19-C0E9MPng.js","/assets/UnitTestPage-D6VF24b6.js","/assets/actions-Hf7Mux4N.js","/assets/clock-t_s1TbNP.js","/assets/course-nav-DbZ9mo0Y.js","/assets/drill-cH5dcfje.js","/assets/games-DoXts0DC.css","/assets/plane-Dyyy5p5V.js","/assets/play-BMCkTeZD.css","/assets/random-CxILBDym.js","/assets/rubik-hebrew-BIkpbuMU.woff2","/assets/rubik-latin-CnQIisVs.woff2","/assets/stop-aP3DeQ50.js","/assets/ui-BUue-sSp.js","/assets/useLearned-CVz8PwK6.js","/icon-192.png","/icon-512.png","/icon-maskable.png","/assets/U01-L01-CJhkIjhu.js","/assets/U01-L02-DO8lwDVB.js","/assets/U01-L03-C0NX7RRY.js","/assets/U01-L04-z2J0KDH0.js","/assets/U02-L01-Uf66DcKr.js","/assets/U02-L02-D3_7bpJB.js","/assets/U02-L03-D_ThdMyR.js","/assets/U02-L04-D7cCuOHE.js","/assets/U02-L05-Vrh1W1_a.js","/assets/U02-L06-CyEeNTie.js","/assets/U03-L01-D7WQHTk3.js","/assets/U03-L02-BgmbIGOM.js","/assets/U03-L03-BosSpr0h.js","/assets/U03-L04-h3APag6B.js","/assets/U03-L05-CoCm9CTx.js","/assets/U04-L01-CT1fRQ2u.js","/assets/U04-L02-vjAu7vuB.js","/assets/U04-L03-CQfTCRkL.js","/assets/U04-L04-C9I6D2IH.js","/assets/U04-L05-DQRiuL13.js","/assets/U04-L06-FuQVg9QE.js","/assets/U04-L07-Dn2vaBFO.js","/assets/U05-L01-CegO9ZtV.js","/assets/U05-L02-ClMkm0uk.js","/assets/U05-L03-FAYrC-Yn.js","/assets/U05-L04-NqEvc5qr.js","/assets/U05-L05-BMm-VHip.js","/assets/U05-L06-C_VKX57R.js","/assets/U06-L01-CA5S9MmL.js","/assets/U06-L02-D4q9TDc1.js","/assets/U07-L01-58ty535n.js","/assets/U07-L02-DhN8fhqD.js","/assets/U07-L03-BPZmE93Z.js","/assets/U08-L01-j2MPogLF.js","/assets/U08-L02-CfolEHx9.js","/assets/U08-L03-DKWKFjwB.js","/assets/U08-L04-DZXhP3k9.js","/assets/U08-L05-Ds6sU0dV.js","/assets/U09-L01-BNJrAOjX.js","/assets/U09-L02-BWgIOcOj.js","/assets/U09-L03-C8nuuZHE.js","/assets/U09-L04-CoToIMRE.js","/assets/U09-L05-CIVjyEB7.js","/assets/U09-L06-C0ErIyXy.js","/assets/U10-L01-Dl6ytiN7.js","/assets/U10-L02-Ny1KSkFm.js","/assets/U10-L03-3SiiXxQz.js","/assets/U10-L04-C54dXnni.js","/assets/U10-L05-C6vivtVa.js","/assets/U11-L01-_Hn5NOae.js","/assets/U11-L02-DhS3sMVB.js","/assets/U12-L01-iLvsD3yC.js","/assets/U12-L02-DsLmDZ8N.js","/assets/U12-L03-jynzuwdl.js","/assets/U12-L04-DUvQ7jKU.js","/assets/U12-L05-DGqhQXm1.js","/assets/U12-L06-CO6Wiqaw.js","/assets/U13-L01-B7eQa-Ot.js","/assets/U13-L02-C9Q_joJL.js","/assets/U13-L03-BL3c0XUc.js","/assets/U15-L01-DEtKE3Ru.js","/assets/U15-L02-lm5C04Jn.js","/assets/U15-L03-DonTkFbk.js","/assets/U15-L04-Dyqkvmsq.js","/assets/U15-L05-BuCkDkPM.js","/assets/U16-L01-DxeOpXvb.js","/assets/U16-L02-DH6O5740.js","/assets/U16-L03-CmFbcuQN.js","/assets/U16-L04-B4GCBV5-.js","/assets/U16-L05-BrxmcN_S.js","/assets/U16-L06-Q6DtuDnG.js","/assets/U17-L02-BcMFsn4s.js","/assets/U17-L03-DgyPDVju.js","/assets/U17-L04-B3QOs6dg.js","/assets/U17-L05-LhBkb_RI.js","/assets/U17-L06-D55ORHm-.js","/assets/U18-L01-C8x36IAy.js","/assets/U18-L02-CC__QrzD.js","/assets/U18-L03-BeQu3aR3.js","/assets/U18-L04-BAsjGu-x.js","/assets/U18-L05-B4AkJzWs.js","/assets/U18-L06-CQzEwyM2.js","/assets/U18-L07-CYKEvL8x.js","/assets/U19-L01-BCBwty_y.js","/assets/U19-L02-OXXV8EPt.js","/assets/U19-L03-CcFl3H7f.js","/assets/U19-L04-DlzQL_e-.js","/assets/U19-L05-DVyg4X8z.js","/assets/U19-L06-RaF177s3.js","/assets/U19-L07-CUF4eDKa.js","/assets/U21-L01-lHdtNNJF.js"]
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

// אין רשת ואין עותק שמור: דף הסבר במקום שגיאת דפדפן ריקה (ERR_FAILED)
const offlinePage = () => new Response(`<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>אין חיבור</title><body style="font-family:system-ui,sans-serif;padding:24px;line-height:1.6;max-width:32em;margin:auto"><h1>לא הצלחנו להגיע לאתר</h1><p>האתר עוד לא שמור במכשיר, והחיבור לשרת נכשל.</p><ul><li>לבדוק חיבור לאינטרנט ולנסות שוב.</li><li>ברשת מסוננת: ייתכן שהכתובת <b>github.io</b> חסומה. לבקש מספק הסינון לאשר אותה, או לנסות ברשת אחרת.</li></ul><p><button onclick="location.reload()" style="font-size:1rem;padding:10px 18px">לנסות שוב</button></p></body></html>`, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } })

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (req.mode === 'navigate') {
    // ניווט: הרשת קודם (תוכן עדכני); בלי רשת, או אם השרת לא עונה, index.html מהמטמון
    event.respondWith(fetch(req).catch(async () => (await caches.match(BASE, { cacheName: CACHE, ignoreVary: true })) ?? (await caches.match(BASE, { ignoreVary: true })) ?? offlinePage()))
    return
  }
  event.respondWith(caches.match(req, { ignoreVary: true }).then((hit) => hit ?? fetch(req)))
})
