// תחזית מ-Open-Meteo (חינמי, בלי מפתח): גשם ורוח משפיעים על התקנת יחידות חיצוניות ועבודה בגובה
import { brand } from '../../brand'

export interface DayForecast {
  date: string
  tMax: number
  tMin: number
  rainProb: number
  windMax: number
  code: number
}

let memo: { at: number; data: DayForecast[] } | null = null

export async function forecast(lat = brand.geo.lat, lng = brand.geo.lng): Promise<DayForecast[]> {
  if (memo && Date.now() - memo.at < 30 * 60_000) return memo.data
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max&timezone=Asia%2FJerusalem&forecast_days=10`
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(String(res.status))
    const j = await res.json()
    const d = j.daily
    const data: DayForecast[] = d.time.map((date: string, i: number) => ({
      date,
      tMax: Math.round(d.temperature_2m_max[i]),
      tMin: Math.round(d.temperature_2m_min[i]),
      rainProb: d.precipitation_probability_max[i] ?? 0,
      windMax: Math.round(d.wind_speed_10m_max[i] ?? 0),
      code: d.weather_code[i],
    }))
    memo = { at: Date.now(), data }
    return data
  } catch {
    return []
  }
}

export function weatherIcon(code: number): string {
  if (code === 0) return '☀️'
  if (code <= 3) return '⛅'
  if (code <= 48) return '🌫️'
  if (code <= 67 || (code >= 80 && code <= 82)) return '🌧️'
  if (code <= 77) return '❄️'
  if (code >= 95) return '⛈️'
  return '☁️'
}

// אזהרה לעבודה בחוץ: גשם צפוי או רוח חזקה
export function outdoorRisk(f?: DayForecast): string | null {
  if (!f) return null
  if (f.rainProb >= 60) return `${f.rainProb}% סיכוי לגשם`
  if (f.windMax >= 40) return `רוח עד ${f.windMax} קמ״ש`
  if (f.tMax >= 35) return `חום כבד (${f.tMax}°)`
  return null
}
