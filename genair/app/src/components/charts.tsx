// גרפים: SVG ו-CSS בלי ספרייה. כל גרף נבנה כשהוא נכנס למסך (קווים נמתחים, עמודות צומחות, מספרים רצים),
// עם טולטיפ במעבר עכבר ובמקלדת. הצבע של סדרה הולך עם הישות (סוג פרויקט, שלב), לא עם המיקום שלה.
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import './charts.css'

export interface Series { key: string; label: string; color: string }

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// נכנס למסך פעם אחת: מכאן האנימציה רצה. בהדפסה הכל מוצג במצב הסופי
export function useInView<T extends Element>(ref: RefObject<T | null>, threshold = 0.2) {
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined' || reducedMotion())
  useEffect(() => {
    if (seen) return
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) {
        setSeen(true)
        io.disconnect()
      }
    }, { threshold })
    io.observe(el)
    const print = () => setSeen(true)
    window.addEventListener('beforeprint', print)
    return () => { io.disconnect(); window.removeEventListener('beforeprint', print) }
  }, [seen, ref, threshold])
  return seen
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.clientWidth)
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

// ---------- מספרים ----------
export function compact(n: number) {
  const a = Math.abs(n)
  if (a >= 1e6) return `${+(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`
  if (a >= 1e3) return `${+(n / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K`
  return String(Math.round(n))
}
export const compactMoney = (n: number) => `₪${compact(n)}`

function niceScale(max: number, ticks = 4) {
  if (max <= 0) return { max: ticks, step: 1 }
  const raw = max / ticks
  const mag = 10 ** Math.floor(Math.log10(raw))
  const f = raw / mag
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag
  return { max: Math.ceil(max / step) * step, step }
}

// מספר שרץ מאפס לערך כשהוא נכנס למסך, ומהערך הקודם לחדש כשהנתונים משתנים
export function CountUp({ value, format = (n: number) => String(n), decimals = 0, duration = 1100 }: { value: number; format?: (n: number) => string; decimals?: number; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const shown = useRef<number | null>(null)
  const [initial] = useState(() => format(reducedMotion() ? value : 0))
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const fmt = (x: number) => format(decimals ? Number(x.toFixed(decimals)) : Math.round(x))
    const final = () => { shown.current = value; el.textContent = fmt(value) }
    if (reducedMotion() || typeof IntersectionObserver === 'undefined') { final(); return }
    let raf = 0
    const run = () => {
      const from = shown.current ?? 0
      const t0 = performance.now()
      const step = (t: number) => {
        const p = Math.min(1, (t - t0) / duration)
        el.textContent = fmt(from + (value - from) * (1 - (1 - p) ** 3))
        if (p < 1) raf = requestAnimationFrame(step)
        else shown.current = value
      }
      raf = requestAnimationFrame(step)
    }
    let io: IntersectionObserver | undefined
    if (shown.current !== null) run()
    else {
      io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io?.disconnect(); run() } }, { threshold: 0.3 })
      io.observe(el)
    }
    window.addEventListener('beforeprint', final)
    return () => { cancelAnimationFrame(raf); io?.disconnect(); window.removeEventListener('beforeprint', final) }
  }, [value, decimals, duration])
  return <span ref={ref} className="viz-count">{initial}</span>
}

// שינוי מול תקופה קודמת: חץ, אחוז, וצבע לפי כיוון וטוב/רע
export function Trend({ cur, prev, goodUp = true, suffix = 'לעומת התקופה הקודמת', title }: { cur: number; prev: number; goodUp?: boolean; suffix?: string; title?: string }) {
  if (!cur && !prev) return <span className="viz-trend flat"><Minus size={12} /> ללא שינוי</span>
  if (!prev) return <span className={`viz-trend ${goodUp ? 'good' : 'bad'}`}><ArrowUp size={12} /> חדש בתקופה</span>
  const d = ((cur - prev) / Math.abs(prev)) * 100
  const flat = Math.abs(d) < 0.5
  const up = d > 0
  return (
    <span className={`viz-trend ${flat ? 'flat' : up === goodUp ? 'good' : 'bad'}`} title={title}>
      {flat ? <Minus size={12} /> : up ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
      <b className="ltr">{flat ? '0%' : `${up ? '+' : ''}${Math.abs(d) >= 999 ? '999+' : Math.round(d)}%`}</b>
      {suffix && <span className="viz-trend-s">{suffix}</span>}
    </span>
  )
}

// ---------- מסלול חלק (מונוטוני: לא עובר מעל או מתחת לנקודות) ----------
function smoothPath(pts: [number, number][]) {
  const n = pts.length
  if (n < 2) return n ? `M${pts[0][0]},${pts[0][1]}` : ''
  const dx: number[] = []
  const m: number[] = []
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0])
    m.push((pts[i + 1][1] - pts[i][1]) / (dx[i] || 1))
  }
  const t: number[] = [m[0]]
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]))
  t.push(m[n - 2])
  let d = `M${pts[0][0]},${pts[0][1]}`
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3
    d += ` C${pts[i][0] + h},${pts[i][1] + h * t[i]} ${pts[i + 1][0] - h},${pts[i + 1][1] - h * t[i + 1]} ${pts[i + 1][0]},${pts[i + 1][1]}`
  }
  return d
}

// ---------- קו מגמה קטן ----------
export function Sparkline({ values, color = 'var(--brand)', width = 96, height = 30, label }: { values: number[]; color?: string; width?: number; height?: number; label?: string }) {
  const ref = useRef<SVGSVGElement>(null)
  const seen = useInView(ref)
  const gid = useId()
  if (values.length < 2) return null
  const max = Math.max(...values)
  const min = Math.min(0, ...values)
  const span = max - min || 1
  const pts = values.map((v, i) => [3 + (i / (values.length - 1)) * (width - 8), 4 + (1 - (v - min) / span) * (height - 8)] as [number, number])
  const line = smoothPath(pts)
  const last = pts[pts.length - 1]
  return (
    <svg ref={ref} className={`viz viz-spark ${seen ? 'in' : ''}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label ?? 'מגמה'} style={{ direction: 'ltr' }}>
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity="0.22" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient>
      </defs>
      <path className="viz-area" d={`${line} L${last[0]},${height} L${pts[0][0]},${height} Z`} fill={`url(#${gid})`} />
      <path className="viz-line" d={line} pathLength={1} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle className="viz-dot" cx={last[0]} cy={last[1]} r="3.5" fill={color} stroke="var(--surface)" strokeWidth="2" />
    </svg>
  )
}

// ---------- טולטיפ משותף ----------
interface TipRow { color: string; label: string; value: string; line?: boolean }
// הטולטיפ יושב בתוך הגרף, בצד של הנקודה שיש בו יותר מקום, כדי לא להסתיר את הכותרת והמספרים מעליו
function Tip({ x, y, title, rows, width }: { x: number; y: number; title: string; rows: TipRow[]; width: number }) {
  const style: CSSProperties = x < width / 2 ? { left: x + 14, top: y } : { left: x - 14, top: y, transform: 'translateX(-100%)' }
  return (
    <div className="viz-tip" style={style}>
      <div className="viz-tip-t">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="viz-tip-r">
          <i className={r.line ? 'ln' : ''} style={{ background: r.color }} />
          <b>{r.value}</b>
          <span>{r.label}</span>
        </div>
      ))}
    </div>
  )
}

export function Legend({ series, line }: { series: Series[]; line?: boolean }) {
  return (
    <div className="viz-legend">
      {series.map((s) => <span key={s.key}><i className={line ? 'ln' : ''} style={{ background: s.color }} />{s.label}</span>)}
    </div>
  )
}

// ---------- גרף שטח לאורך זמן (סדרה אחת או יותר, ציר אחד) ----------
export function AreaChart({ labels, series, data, format, axisFormat = compact, height = 240, endLabel = true, partialLast = false }: {
  labels: string[]; series: Series[]; data: number[][]; format: (n: number) => string; axisFormat?: (n: number) => string; height?: number; endLabel?: boolean
  partialLast?: boolean // הנקודה האחרונה היא חודש שעוד לא נגמר: הקטע אליה מקווקו
}) {
  const [box, w] = useWidth<HTMLDivElement>()
  const seen = useInView(box)
  const gid = useId()
  const [hover, setHover] = useState<number | null>(null)
  const n = labels.length
  const padL = 46, padR = 18, padT = 22, padB = 28
  const pw = Math.max(10, w - padL - padR)
  const ph = height - padT - padB
  const { max, step } = niceScale(Math.max(1, ...data.flat()))
  const x = (i: number) => padL + (n > 1 ? (i / (n - 1)) * pw : pw / 2)
  const y = (v: number) => padT + (1 - v / max) * ph
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step)
  const every = w < 520 ? 2 : 1

  const move = (clientX: number, el: Element) => {
    const r = el.getBoundingClientRect()
    const i = Math.round(((clientX - r.left - padL) / pw) * (n - 1))
    setHover(Math.max(0, Math.min(n - 1, i)))
  }
  return (
    <div ref={box} className={`viz viz-area-chart ${seen ? 'in' : ''}`} style={{ height }}>
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label={series.map((s) => s.label).join(', ')}
          tabIndex={0}
          onPointerMove={(e) => move(e.clientX, e.currentTarget)}
          onPointerLeave={() => setHover(null)}
          onFocus={() => setHover(n - 1)}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? n - 1) - 1))
            if (e.key === 'ArrowRight') setHover((h) => Math.min(n - 1, (h ?? n - 1) + 1))
          }}>
          <defs>
            {series.map((s, si) => (
              <linearGradient key={s.key} id={`${gid}-${si}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor={s.color} stopOpacity={si === 0 ? 0.24 : 0.1} />
                <stop offset="1" stopColor={s.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} className="viz-grid" />
              <text x={padL - 8} y={y(t) + 4} textAnchor="end" className="viz-axis">{axisFormat(t)}</text>
            </g>
          ))}
          {labels.map((l, i) => (i % every === (n - 1) % every ? <text key={i} x={x(i)} y={height - 8} textAnchor="middle" className={`viz-axis ${hover === i ? 'on' : ''}`}>{l}</text> : null))}
          {series.map((s, si) => {
            const pts = data[si].map((v, i) => [x(i), y(v)] as [number, number])
            const cut = partialLast && n > 2
            const line = smoothPath(cut ? pts.slice(0, -1) : pts)
            const [px, py] = pts[n - 2] ?? pts[0]
            const [lx, ly] = pts[n - 1]
            return (
              <g key={s.key}>
                <path className="viz-area" style={{ transitionDelay: `${0.5 + si * 0.15}s` }} d={`${line}${cut ? ` L${lx},${ly}` : ''} L${x(n - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill={`url(#${gid}-${si})`} />
                <path className="viz-line" style={{ transitionDelay: `${si * 0.18}s` }} d={line} pathLength={1} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                {cut && <path className="viz-area" style={{ transitionDelay: '1.3s' }} d={`M${px},${py} L${lx},${ly}`} fill="none" stroke={s.color} strokeWidth="2.5" strokeDasharray="5 5" strokeLinecap="round" />}
              </g>
            )
          })}
          {endLabel && series[0] && (
            <g className="viz-dot">
              <circle cx={x(n - 1)} cy={y(data[0][n - 1])} r="5" fill={series[0].color} stroke="var(--surface)" strokeWidth="2.5" />
              <text x={x(n - 1) - 10} y={Math.max(12, y(data[0][n - 1]) - 10)} textAnchor="end" className="viz-endlbl">{partialLast ? `${format(data[0][n - 1])} עד היום` : format(data[0][n - 1])}</text>
            </g>
          )}
          {hover !== null && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={padT - 6} y2={padT + ph} className="viz-cross" />
              {series.map((s, si) => <circle key={s.key} cx={x(hover)} cy={y(data[si][hover])} r="5" fill={s.color} stroke="var(--surface)" strokeWidth="2.5" />)}
            </g>
          )}
        </svg>
      )}
      {hover !== null && w > 0 && (
        <Tip x={x(hover)} y={padT} width={w} title={partialLast && hover === n - 1 ? `${labels[hover]} (עד היום)` : labels[hover]} rows={series.map((s, si) => ({ color: s.color, label: s.label, value: format(data[si][hover]), line: true }))} />
      )}
    </div>
  )
}

// ---------- עמודות (מוערמות כשיש כמה סדרות) ----------
export function Columns({ labels, series, data, format = (n: number) => String(n), axisFormat = compact, height = 230, dim, totalLabel = 'סה״כ', unit = '' }: {
  labels: string[]; series: Series[]; data: number[][]; format?: (n: number) => string; axisFormat?: (n: number) => string; height?: number; dim?: boolean[]; totalLabel?: string; unit?: string
}) {
  const [box, w] = useWidth<HTMLDivElement>()
  const seen = useInView(box)
  const cid = useId()
  const [hover, setHover] = useState<number | null>(null)
  const n = labels.length
  const padL = 40, padR = 10, padT = 22, padB = 28
  const pw = Math.max(10, w - padL - padR)
  const ph = height - padT - padB
  const totals = labels.map((_, i) => series.reduce((s, _x, si) => s + (data[si][i] ?? 0), 0))
  const { max, step } = niceScale(Math.max(1, ...totals))
  const band = pw / Math.max(1, n)
  const bw = Math.max(6, Math.min(26, band * 0.62))
  const base = padT + ph
  const y = (v: number) => (v / max) * ph
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step)
  const peak = totals.indexOf(Math.max(...totals))
  const every = w < 520 && n > 8 ? 2 : 1
  return (
    <div ref={box} className={`viz viz-columns ${seen ? 'in' : ''}`} style={{ height }}>
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label={`${totalLabel} לפי חודש`} onPointerLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={w - padR} y1={base - y(t)} y2={base - y(t)} className="viz-grid" />
              <text x={padL - 8} y={base - y(t) + 4} textAnchor="end" className="viz-axis">{axisFormat(t)}</text>
            </g>
          ))}
          {labels.map((l, i) => {
            const cx = padL + band * i + band / 2
            const x0 = cx - bw / 2
            const h = y(totals[i])
            const top = base - h
            const r = Math.min(4, h / 2)
            let acc = 0
            return (
              <g key={i} className={`viz-col ${dim?.[i] ? 'dim' : ''} ${hover !== null && hover !== i ? 'fade' : ''}`}>
                <clipPath id={`${cid}-${i}`}><path d={`M${x0},${base} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + bw - r} Q${x0 + bw},${top} ${x0 + bw},${top + r} V${base} Z`} /></clipPath>
                <g className="viz-grow" clipPath={`url(#${cid}-${i})`} style={{ transitionDelay: `${i * 0.045}s` }}>
                  {series.map((s, si) => {
                    const v = data[si][i] ?? 0
                    if (!v) return null
                    const sh = y(v)
                    const sy = base - acc - sh
                    acc += sh
                    // רווח של 2 פיקסלים בצבע הרקע בין מקטעים
                    const gap = acc < h - 0.5 ? 2 : 0
                    return <rect key={s.key} x={x0} y={sy + gap} width={bw} height={Math.max(0, sh - gap)} fill={s.color} />
                  })}
                </g>
                {(i === peak || i === n - 1) && totals[i] > 0 && <text className="viz-cap" x={cx} y={top - 6} textAnchor="middle">{axisFormat(totals[i])}</text>}
                {i % every === (n - 1) % every && <text x={cx} y={height - 8} textAnchor="middle" className={`viz-axis ${hover === i ? 'on' : ''}`}>{l}</text>}
                <rect x={padL + band * i} y={padT - 10} width={band} height={ph + 10} fill="transparent" tabIndex={0}
                  onPointerEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} />
              </g>
            )
          })}
        </svg>
      )}
      {hover !== null && w > 0 && (
        <Tip x={padL + band * hover + band / 2 + (hover < n / 2 ? bw / 2 : -bw / 2)} y={padT} width={w} title={`${labels[hover]} · ${totalLabel} ${format(totals[hover])}${unit}`}
          rows={series.length > 1 ? series.filter((_, si) => data[si][hover]).map((s) => ({ color: s.color, label: s.label, value: `${format(data[series.indexOf(s)][hover])}${unit}` })) : []} />
      )}
    </div>
  )
}

// ---------- עוגה (חלק מהשלם: עד 4 חלקים בצבע, והשאר מקובצים ל"אחר" אפור) ----------
export interface Part { key: string; label: string; value: number; color: string }
export function Donut({ parts, centerLabel, format = (n: number) => String(n), size = 168, max = 5 }: { parts: Part[]; centerLabel: string; format?: (n: number) => string; size?: number; max?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const seen = useInView(ref)
  const [hover, setHover] = useState<string | null>(null)
  const sorted = [...parts].filter((p) => p.value > 0)
  const shown = sorted.length > max ? [...sorted.slice(0, max - 1), { key: '__other', label: 'אחר', color: '#94a3b8', value: sorted.slice(max - 1).reduce((s, p) => s + p.value, 0) }] : sorted
  const total = shown.reduce((s, p) => s + p.value, 0)
  const R = 54, SW = 18
  let acc = 0
  const h = shown.find((p) => p.key === hover)
  return (
    <div ref={ref} className={`viz viz-donut ${seen ? 'in' : ''}`}>
      <div className="viz-donut-svg" style={{ width: size, height: size }}>
        <svg viewBox="0 0 140 140" width={size} height={size} role="img" aria-label={`${centerLabel}: ${format(total)}`}>
          <circle cx="70" cy="70" r={R} fill="none" stroke="var(--line-2)" strokeWidth={SW} />
          {shown.map((p, i) => {
            const len = total ? (p.value / total) * 100 : 0
            const gap = shown.length > 1 ? 0.9 : 0
            const el = (
              <circle key={p.key} cx="70" cy="70" r={R} fill="none" stroke={p.color} strokeWidth={hover === p.key ? SW + 5 : SW} pathLength={100}
                className={`viz-seg ${hover && hover !== p.key ? 'fade' : ''}`}
                style={{ '--len': `${Math.max(0, len - gap)}`, strokeDashoffset: -acc, transitionDelay: `${0.15 + i * 0.09}s` } as CSSProperties}
                transform="rotate(-90 70 70)"
                onPointerEnter={() => setHover(p.key)} onPointerLeave={() => setHover(null)} />
            )
            acc += len
            return el
          })}
        </svg>
        <div className="viz-donut-c">
          <b>{h && format(h.value)}<span hidden={!!h}><CountUp value={total} format={format} /></span></b>
          <small>{h ? h.label : centerLabel}</small>
        </div>
      </div>
      <div className="viz-donut-legend">
        {shown.map((p) => (
          <div key={p.key} className={`viz-dl ${hover === p.key ? 'on' : ''}`} onPointerEnter={() => setHover(p.key)} onPointerLeave={() => setHover(null)}>
            <i style={{ background: p.color }} />
            <span className="grow">{p.label}</span>
            <b className="num">{format(p.value)}</b>
            <span className="viz-pct num">{total ? Math.round((p.value / total) * 100) : 0}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------- שורות אופקיות: דירוג (לקוחות, סוכנים, מקורות) או שלבים (צנרת) ----------
export interface BarRow { key: string; label: ReactNode; value: number; display?: ReactNode; sub?: ReactNode; color?: string }
export function BarList({ rows, format = (n: number) => String(n), ramp, color = 'var(--brand)', labelWidth = 128 }: { rows: BarRow[]; format?: (n: number) => string; ramp?: boolean; color?: string; labelWidth?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const seen = useInView(ref)
  const max = Math.max(1, ...rows.map((r) => r.value))
  // סולם אורדינלי לשלבים: אותו גוון, מבהיר לכהה
  const rampColor = (i: number) => `color-mix(in srgb, var(--brand) ${Math.round(100 - (i / Math.max(1, rows.length - 1)) * 62)}%, #0a3550)`
  return (
    <div ref={ref} className={`viz viz-bars ${seen ? 'in' : ''}`} style={{ '--lw': `${labelWidth}px` } as CSSProperties}>
      {rows.map((r, i) => (
        <div key={r.key} className="viz-br" title={typeof r.label === 'string' ? `${r.label}: ${format(r.value)}` : undefined}>
          <div className="viz-br-l">{r.label}{r.sub && <div className="viz-br-s">{r.sub}</div>}</div>
          <div className="viz-br-t">
            <div className="viz-br-f" style={{ width: `${(r.value / max) * 100}%`, background: r.color ?? (ramp ? rampColor(i) : color), transitionDelay: `${0.1 + i * 0.06}s` }} />
          </div>
          <div className="viz-br-v num">{r.display ?? format(r.value)}</div>
        </div>
      ))}
    </div>
  )
}

// ---------- מד עגול: אחוז מתוך 100 ----------
export function Ring({ value, label, color = 'var(--brand)', size = 74, sub }: { value: number; label: string; color?: string; size?: number; sub?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const seen = useInView(ref)
  const v = Math.max(0, Math.min(100, value))
  return (
    <div ref={ref} className={`viz viz-ring ${seen ? 'in' : ''}`}>
      <div className="viz-ring-svg" style={{ width: size, height: size }}>
        <svg viewBox="0 0 80 80" width={size} height={size} role="img" aria-label={`${label}: ${Math.round(v)}%`}>
          <circle cx="40" cy="40" r="32" fill="none" stroke={`color-mix(in srgb, ${color} 16%, var(--surface))`} strokeWidth="9" />
          <circle className="viz-seg" cx="40" cy="40" r="32" fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" pathLength={100} transform="rotate(-90 40 40)" style={{ '--len': `${v}` } as CSSProperties} />
        </svg>
        <b><CountUp value={v} format={(n) => `${n}%`} /></b>
      </div>
      <div className="viz-ring-l">
        <div className="small strong">{label}</div>
        {sub && <div className="tiny muted">{sub}</div>}
      </div>
    </div>
  )
}

// ---------- כרטיס מדד: מספר רץ, שינוי וקו מגמה ----------
const tones: Record<string, [string, string]> = {
  brand: ['var(--brand-50)', 'var(--brand-700)'],
  success: ['var(--success-50)', 'var(--success)'],
  warning: ['var(--warning-50)', 'var(--warning)'],
  danger: ['var(--danger-50)', 'var(--danger)'],
  violet: ['var(--violet-50)', 'var(--violet)'],
}
export function KpiTile({ icon, label, value, format, decimals, trend, sub, spark, sparkColor, tone = 'brand', onClick }: {
  icon: ReactNode; label: string; value: number; format?: (n: number) => string; decimals?: number; trend?: ReactNode; sub?: ReactNode; spark?: number[]; sparkColor?: string; tone?: keyof typeof tones; onClick?: () => void
}) {
  return (
    <div className={`card kpi ${onClick ? 'link' : ''}`} onClick={onClick}>
      <div className="kpi-top">
        <div className="kpi-ico" style={{ background: tones[tone][0], color: tones[tone][1] }}>{icon}</div>
        <div className="kpi-lbl">{label}</div>
      </div>
      <div className="kpi-val"><CountUp value={value} format={format} decimals={decimals} /></div>
      <div className="kpi-foot">
        <div className="kpi-meta">
          {trend}
          {sub && <div className="kpi-sub">{sub}</div>}
        </div>
        {spark && <Sparkline values={spark} color={sparkColor ?? tones[tone][1]} label={`${label}: מגמה`} />}
      </div>
    </div>
  )
}
