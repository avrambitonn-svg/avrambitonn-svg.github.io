// חגים, ערבי חג וזמני כניסת שבת מ-Hebcal (חינמי, בלי מפתח).
// משמש לשיבוץ: לא קובעים עבודה בשבת ובחג, ובשישי ובערב חג מסיימים לפני כניסת השבת.
import { brand } from '../../brand'

export interface HolidayDay {
  date: string // YYYY-MM-DD
  title: string
  kind: 'holiday' | 'erev' | 'cholhamoed' | 'fast' | 'other'
  blocksWork: boolean
}

export interface Calendar {
  days: HolidayDay[]
  candles: Record<string, string> // YYYY-MM-DD -> HH:MM (הדלקת נרות)
}

const CACHE_KEY = 'genair-hebcal-v2'
const empty: Calendar = { days: [], candles: {} }

function readCache(): Record<string, Calendar> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')
  } catch {
    return {}
  }
}

interface HebcalItem {
  date: string
  title: string
  hebrew?: string
  category: string
  subcat?: string
  yomtov?: boolean
}

export async function loadYear(year: number): Promise<Calendar> {
  const cache = readCache()
  if (cache[year]) return cache[year]
  const url = `https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&min=on&mod=off&nx=off&ss=off&mf=off&c=on&i=on&year=${year}&month=x&lg=he&geo=geoname&geonameid=${brand.geo.geonameid}`
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(String(res.status))
    const json = (await res.json()) as { items: HebcalItem[] }
    const cal: Calendar = { days: [], candles: {} }
    for (const x of json.items) {
      if (x.category === 'candles') {
        cal.candles[x.date.slice(0, 10)] = x.date.slice(11, 16)
        continue
      }
      if (x.category !== 'holiday') continue
      const title = x.hebrew || x.title
      const kind: HolidayDay['kind'] = x.yomtov
        ? 'holiday'
        : /^ערב /.test(title)
          ? 'erev'
          : /חוה״מ|חול המועד/.test(title)
            ? 'cholhamoed'
            : x.subcat === 'fast'
              ? 'fast'
              : 'other'
      cal.days.push({ date: x.date.slice(0, 10), title, kind, blocksWork: Boolean(x.yomtov) })
    }
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ...cache, [year]: cal }))
    } catch {
      /* אחסון מלא: עובדים בלי מטמון */
    }
    return cal
  } catch {
    return empty
  }
}

export async function loadCalendar(from: Date, to: Date): Promise<Calendar> {
  const years = [...new Set([from.getFullYear(), to.getFullYear()])]
  const parts = await Promise.all(years.map(loadYear))
  return { days: parts.flatMap((p) => p.days), candles: Object.assign({}, ...parts.map((p) => p.candles)) }
}

const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export interface DayStatus {
  ok: boolean // אפשר לעבוד
  short: boolean // יום קצר (שישי / ערב חג)
  endBy?: string // לסיים עד (שעה לפני כניסת שבת/חג)
  label?: string
}

// סיום עבודה שעה וחצי לפני הדלקת נרות
function minus(hhmm: string, minutes: number) {
  const [h, m] = hhmm.split(':').map(Number)
  const t = h * 60 + m - minutes
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

export function dayStatus(d: Date, cal: Calendar): DayStatus {
  const k = key(d)
  const h = cal.days.find((x) => x.date === k)
  const candles = cal.candles[k]
  if (d.getDay() === 6) return { ok: false, short: false, label: 'שבת' }
  if (h?.blocksWork) return { ok: false, short: false, label: h.title }
  if (candles || d.getDay() === 5 || h?.kind === 'erev') {
    return { ok: true, short: true, endBy: candles ? minus(candles, 90) : '13:00', label: h?.title ?? (d.getDay() === 5 ? 'יום שישי' : undefined) }
  }
  return { ok: true, short: false, label: h?.title }
}
