// הדגמה מודרכת: סמן גדול שזז על המסכים האמיתיים, מאיר כל כפתור ומסביר מה הוא עושה.
// ההדגמה רצה על עותק של הנתונים: ביציאה הכל חוזר בדיוק למה שהיה.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { ChevronLeft, ChevronRight, Gauge, ListOrdered, Pause, Play, PlayCircle, X } from 'lucide-react'
import { useApp } from '../../lib/store'
import { brand } from '../../brand'
import { Cancelled, Run, go, typeInto, type Step } from './engine'
import { chapters, steps } from './script'
import './demo.css'

type Rect = { x: number; y: number; w: number; h: number }
const speeds = [1, 1.5, 2] as const
const DEMO_EVENT = 'genair:demo'

// פתיחה מכל מקום במערכת: startDemo() או startDemo('quotes')
export function startDemo(chapter?: string) {
  window.dispatchEvent(new CustomEvent(DEMO_EVENT, { detail: { chapter } }))
}

const readTime = (s: Step) => s.read ?? Math.min(9000, Math.max(3800, (s.title.length + s.text.length) * 48))

export function DemoPlayer() {
  const [mode, setMode] = useState<'off' | 'menu' | 'run'>('off')
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState<(typeof speeds)[number]>(1)
  const [clean, setClean] = useState(false)
  const [nonce, setNonce] = useState(0)
  const [spot, setSpot] = useState<Rect | null>(null)
  const [cursor, setCursor] = useState({ x: window.innerWidth / 2, y: window.innerHeight + 60 })
  const [clicks, setClicks] = useState(0)
  const [cardOn, setCardOn] = useState(false)
  const [cardPos, setCardPos] = useState<CSSProperties>({})
  const [chOpen, setChOpen] = useState(false)
  const playingRef = useRef(playing)
  const speedRef = useRef(speed)
  const targetRef = useRef<HTMLElement | null>(null)
  const doneRef = useRef(false) // הפעולה של השלב הנוכחי כבר בוצעה
  const cardRef = useRef<HTMLDivElement>(null)
  const snapRef = useRef<unknown>(null)
  playingRef.current = playing
  speedRef.current = speed

  const step = steps[idx]
  const chapterIdx = chapters.findIndex((c) => c.id === step?.chapter)

  const begin = useCallback((chapter?: string) => {
    // עותק של הנתונים, כדי שכל מה שקורה בהדגמה יימחק ביציאה
    const s = useApp.getState()
    snapRef.current = structuredClone({ db: s.db, settings: s.settings, currentUserId: s.currentUserId })
    const first = chapter ? steps.findIndex((x) => x.chapter === chapter) : 0
    setIdx(Math.max(0, first))
    setPlaying(true)
    setCardOn(false)
    setMode('run')
  }, [])

  const exit = useCallback(() => {
    if (snapRef.current) useApp.setState(snapRef.current as never)
    snapRef.current = null
    targetRef.current = null
    setSpot(null)
    setMode('off')
    go('/')
  }, [])

  // פתיחה מהכפתור במערכת, או מקישור עם ?demo=1 (נוח לפגישה: פותחים ישר את ההדגמה)
  useEffect(() => {
    const on = (e: Event) => { const ch = (e as CustomEvent).detail?.chapter as string | undefined; if (ch) begin(ch); else setMode('menu') }
    window.addEventListener(DEMO_EVENT, on)
    const fromLink = () => {
      const m = window.location.hash.match(/[?&]demo=([\w-]+)/)
      if (!m) return
      const sp = Number(window.location.hash.match(/[?&]speed=([\d.]+)/)?.[1])
      if (speeds.includes(sp as (typeof speeds)[number])) setSpeed(sp as (typeof speeds)[number])
      begin(m[1] === '1' || m[1] === 'full' ? undefined : m[1])
    }
    fromLink()
    window.addEventListener('hashchange', fromLink)
    return () => { window.removeEventListener(DEMO_EVENT, on); window.removeEventListener('hashchange', fromLink) }
  }, [begin])

  // מעקב אחרי האלמנט המודגש (גלילה, אנימציות, שינויי פריסה)
  useEffect(() => {
    if (mode !== 'run') return
    let raf = 0
    let last = ''
    const tick = () => {
      const el = targetRef.current
      if (el && el.isConnected) {
        const r = el.getBoundingClientRect()
        const key = `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`
        if (key !== last) {
          last = key
          const pad = steps[idx]?.pad ?? 8
          setSpot({ x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 })
          setCursor(aim(r))
        }
      } else if (last) { last = ''; setSpot(null) }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [mode, idx])

  const next = useCallback(() => {
    // מעבר ידני לפני שהלחיצה של השלב קרתה: מבצעים אותה, כדי שהשלב הבא ימצא את המסך הנכון
    const s = steps[idx]
    if (s?.action === 'click' && !doneRef.current && targetRef.current?.isConnected) targetRef.current.click()
    if (idx >= steps.length - 1) { exit(); return }
    setIdx((i) => i + 1)
  }, [idx, exit])
  const prev = useCallback(() => setIdx((i) => Math.max(0, i - 1)), [])

  // הריצה של שלב אחד
  useEffect(() => {
    if (mode !== 'run' || !step) return
    const run = new Run(() => playingRef.current)
    doneRef.current = false
    setCardOn(false)
    setChOpen(false)
    const sp = () => speedRef.current
    ;(async () => {
      try {
        if (step.route) { go(step.route); await run.sleep(500) }
        if (step.before) await step.before()
        let el: HTMLElement | null = null
        if (step.target) {
          el = await run.waitFor(step.target, step.optional ? 2500 : 7000)
          if (!el && step.optional) { setIdx((i) => Math.min(steps.length - 1, i + 1)); return }
        }
        targetRef.current = el
        if (el) {
          el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
          await run.sleep(480 / sp())
          await run.sleep(950 / sp()) // הסמן נוסע
          if (step.action === 'press') { setClicks((c) => c + 1); await run.sleep(220); el.click(); doneRef.current = true; await run.sleep(650 / sp()) }
          if (typeof step.action === 'object') {
            setClicks((c) => c + 1)
            await run.sleep(200)
            await typeInto(run, el, step.action.type, step.action.clear ?? true, 60 / sp())
            doneRef.current = true
          }
          if (step.action === 'scroll') el.scrollIntoView({ block: 'start', behavior: 'smooth' })
        } else {
          setSpot(null)
          setCursor({ x: window.innerWidth / 2, y: window.innerHeight * 0.72 })
        }
        setCardOn(true)
        await run.read(readTime(step) / sp())
        if (step.action === 'click' && el?.isConnected) {
          setClicks((c) => c + 1)
          await run.sleep(260)
          el.click()
          doneRef.current = true
          // הלחיצה פתחה מסך או חלון: מורידים את ההדגשה מהכפתור הישן עד השלב הבא
          setCardOn(false)
          targetRef.current = null
          await run.sleep(600 / sp())
        }
        if (step.after) await step.after()
        if (!playingRef.current) return
        if (idx >= steps.length - 1) exit()
        else setIdx(idx + 1)
      } catch (e) {
        if (!(e instanceof Cancelled)) console.error(e)
      }
    })()
    return () => { run.cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, idx, nonce])

  // מיקום הכרטיס ליד האלמנט, בלי לצאת מהמסך
  useLayoutEffect(() => {
    if (!cardOn) return
    const card = cardRef.current
    if (!card) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (vw < 720 || !spot) {
      const low = !!spot && spot.y + spot.h > vh - 170
      setCardPos(vw < 720 ? (low ? { left: 12, right: 12, top: clean ? 16 : 112 } : { left: 12, right: 12, bottom: clean ? 16 : 84 }) : { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' })
      return
    }
    const cw = card.offsetWidth
    const ch = card.offsetHeight
    const gap = 18
    let top = spot.y + spot.h + gap
    if (top + ch > vh - 90) top = spot.y - ch - gap
    if (top < 70) top = Math.min(vh - ch - 90, Math.max(70, spot.y + spot.h / 2 - ch / 2))
    // מימין לשמאל: מיישרים לקצה הימני של האלמנט
    let left = spot.x + spot.w - cw
    // אם הכרטיס מכסה את האלמנט (אלמנט גבוה), מזיזים לצד
    const overlaps = top < spot.y + spot.h && top + ch > spot.y
    if (overlaps) left = spot.x - cw - gap > 12 ? spot.x - cw - gap : spot.x + spot.w + gap
    left = Math.max(12, Math.min(vw - cw - 12, left))
    setCardPos({ left, top })
  }, [cardOn, spot, idx, clean])

  // מקלדת: רווח = השהיה, חיצים = הבא/הקודם, Esc = יציאה, H = מצב צילום נקי
  useEffect(() => {
    if (mode !== 'run') return
    const on = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.matches?.('input, textarea, select')) return
      if (e.key === ' ') { e.preventDefault(); setPlaying((p) => !p) }
      else if (e.key === 'ArrowLeft') next()
      else if (e.key === 'ArrowRight') prev()
      else if (e.key === 'Escape') exit()
      else if (e.key.toLowerCase() === 'h' || e.key === 'י') setClean((c) => !c)
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [mode, next, prev, exit])

  const totalTime = useMemo(() => Math.round(steps.reduce((n, s) => n + readTime(s) + 1600, 0) / 60000), [])

  if (mode === 'off') return null

  if (mode === 'menu') {
    return (
      <div className="demo-menu-wrap" onClick={() => setMode('off')}>
        <div className="demo-menu" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="הדגמה מודרכת">
          <div className="demo-menu-head">
            <PlayCircle size={28} />
            <div>
              <h2>הדגמה מודרכת</h2>
              <p>סמן שעובר על כל המערכת ומסביר כל כפתור. ההדגמה לא משנה נתונים: ביציאה הכל חוזר למקום.</p>
            </div>
            <button className="icon-btn" onClick={() => setMode('off')} aria-label="סגירה"><X size={18} /></button>
          </div>
          <button className="btn primary lg demo-full" onClick={() => begin()}><Play size={18} /> הדגמה מלאה · כ-{totalTime} דקות</button>
          <div className="demo-ch-list">
            {chapters.map((c, i) => {
              const n = steps.filter((s) => s.chapter === c.id).length
              return (
                <button key={c.id} className="demo-ch" onClick={() => begin(c.id)}>
                  <span className="n">{i + 1}</span>
                  <span className="grow"><b>{c.title}</b><span className="tiny muted">{c.sub}</span></span>
                  <span className="tiny muted nowrap">{n} שלבים</span>
                </button>
              )
            })}
          </div>
          <div className="tiny muted demo-keys">רווח: השהיה · חיצים: הבא והקודם · H: מסך נקי לצילום · Esc: יציאה</div>
        </div>
      </div>
    )
  }

  const progress = ((idx + 1) / steps.length) * 100
  // כשהאלמנט המודגש בתחתית המסך, פס השליטה עובר למעלה כדי לא להסתיר אותו
  const flip = !!spot && spot.y + spot.h > window.innerHeight - 110
  const tip = { '--x': `${cursor.x}px`, '--y': `${cursor.y}px`, '--t': `${950 / speed}ms` } as CSSProperties

  return (
    <div className={`demo ${playing ? '' : 'paused'} ${clean ? 'clean' : ''} ${flip ? 'flip' : ''}`} aria-live="polite">
      {/* שכבה שתופסת לחיצות בזמן ריצה (לחיצה = השהיה), כדי שלחיצה מקרית לא תשבור את ההדגמה */}
      {playing && <div className="demo-block" onClick={() => setPlaying(false)} />}
      {spot ? (
        <div className="demo-spot" style={{ left: spot.x, top: spot.y, width: spot.w, height: spot.h }} />
      ) : (
        <div className="demo-dim" />
      )}

      <div className="demo-cursor" style={tip}>
        <span key={`r${clicks}`} className="demo-ripple" />
        <span className="demo-halo" />
        <svg key={`a${clicks}`} className="demo-arrow" width="58" height="58" viewBox="0 0 32 32" aria-hidden>
          <path d="M6 3 L6 26 L12.2 20.4 L16.4 29.4 L20.6 27.5 L16.5 18.6 L25 18.2 Z" fill="#fff" stroke="#0f172a" strokeWidth="1.9" strokeLinejoin="round" />
        </svg>
      </div>

      {!clean && (
        <div className="demo-top">
          <div className="demo-bar"><span style={{ width: `${progress}%` }} /></div>
          <span className="demo-pill">פרק {chapterIdx + 1} מתוך {chapters.length} · {chapters[chapterIdx]?.title}</span>
        </div>
      )}

      {cardOn && step && (
        <div ref={cardRef} className="demo-card" style={cardPos}>
          <div className="demo-card-ch">{chapters[chapterIdx]?.title}</div>
          <h3>{step.title}</h3>
          <p>{step.text}</p>
          <div className="demo-card-foot">
            <span className="num">{idx + 1}/{steps.length}</span>
            {!playing && <button className="btn sm primary" onClick={() => { setPlaying(true); next() }}>הבא <ChevronLeft size={15} /></button>}
          </div>
        </div>
      )}

      {!clean && (
        <div className="demo-controls">
          <button className="icon-btn" onClick={prev} aria-label="הקודם" title="הקודם"><ChevronRight size={20} /></button>
          <button className="demo-play" onClick={() => { if (!playing) setNonce((n) => n + 1); setPlaying((p) => !p) }} aria-label={playing ? 'השהיה' : 'המשך'}>
            {playing ? <Pause size={20} /> : <Play size={20} />}
          </button>
          <button className="icon-btn" onClick={next} aria-label="הבא" title="הבא"><ChevronLeft size={20} /></button>
          <span className="demo-sep" />
          <button className="btn sm ghost" onClick={() => setSpeed((s) => speeds[(speeds.indexOf(s) + 1) % speeds.length])} title="מהירות"><Gauge size={15} /> <span className="ltr">{speed}x</span></button>
          <div className="demo-chs">
            <button className="btn sm ghost" onClick={() => setChOpen((o) => !o)}><ListOrdered size={15} /> פרקים</button>
            {chOpen && (
              <div className="demo-chs-pop">
                {chapters.map((c, i) => (
                  <button key={c.id} className={i === chapterIdx ? 'on' : ''} onClick={() => { setChOpen(false); setIdx(steps.findIndex((s) => s.chapter === c.id)) }}>{i + 1}. {c.title}</button>
                ))}
              </div>
            )}
          </div>
          <button className="btn sm ghost" onClick={exit}><X size={15} /> יציאה</button>
          <span className="demo-brand tiny">{brand.nameEn}</span>
        </div>
      )}
    </div>
  )
}

// לאן הסמן מצביע: מרכז של כפתור קטן, ופינה עליונה-ימנית של אזור גדול
function aim(r: DOMRect) {
  const big = r.width > 260 || r.height > 120
  const x = big ? r.right - Math.min(56, r.width / 4) : r.left + r.width / 2
  const y = big ? r.top + Math.min(30, r.height / 3) : r.top + r.height / 2
  return { x, y }
}

// בדיקה מהירה בפיתוח: עוברת על כל השלבים בלי אנימציות ומחזירה אילו יעדים לא נמצאו
if (import.meta.env.DEV) {
  ;(window as unknown as { __demoCheck: () => Promise<unknown[]> }).__demoCheck = async () => {
    const s = useApp.getState()
    const snap = structuredClone({ db: s.db, settings: s.settings, currentUserId: s.currentUserId })
    const run = new Run(() => true)
    const out: unknown[] = []
    for (const [i, st] of steps.entries()) {
      if (st.route) { go(st.route); await run.sleep(700) }
      if (st.before) await st.before()
      let el: HTMLElement | null = null
      if (st.target) el = await run.waitFor(st.target, 4000)
      out.push({ i: i + 1, id: st.id, chapter: st.chapter, title: st.title, found: !st.target || !!el, optional: !!st.optional, tag: el ? `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)}` : null, size: el ? `${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}` : null })
      if (el && (st.action === 'press' || st.action === 'click')) { el.click(); await run.sleep(500) }
      if (el && typeof st.action === 'object') await typeInto(run, el, st.action.type, st.action.clear ?? true, 5)
      if (st.after) await st.after()
      await run.sleep(150)
    }
    useApp.setState(snap as never)
    go('/')
    return out
  }
}
