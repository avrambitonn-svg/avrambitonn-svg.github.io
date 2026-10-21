// חיבורים "באפס מאמץ": קישורים שעובדים בלי מפתח, בלי שרת ובלי אישור של אף אחד
import { brand } from '../../brand'
import { intlPhone } from '../format'
import type { Address } from '../types'

/**
 * קישור שנבנה מנתונים שמורים (אתר ספק, קישור למסמך, קובץ מצורף): רק http(s), mailto, tel, blob,
 * ותמונה או PDF מוטמעים (data:). כל השאר (javascript: למשל) מחזיר undefined, והקישור לא מוצג.
 */
export function safeHref(u?: string | null): string | undefined {
  const v = (u ?? '').trim()
  if (!v) return undefined
  if (/^data:/i.test(v)) return /^data:(image\/[\w.+-]+|application\/pdf)[;,]/i.test(v) ? v : undefined
  try {
    const p = new URL(v, window.location.href).protocol
    return ['http:', 'https:', 'mailto:', 'tel:', 'blob:'].includes(p) ? v : undefined
  } catch {
    return undefined
  }
}

export const addressText = (a?: Address) =>
  a ? [a.street && `${a.street} ${a.number ?? ''}`.trim(), a.city].filter(Boolean).join(', ') : ''

// וואטסאפ: פותח שיחה עם הודעה מוכנה (בנייד: אפליקציה, במחשב: WhatsApp Web)
export function whatsappLink(phoneNumber: string, text: string) {
  return `https://wa.me/${intlPhone(phoneNumber)}?text=${encodeURIComponent(text)}`
}

export const telLink = (p: string) => `tel:${p.replace(/[^\d+]/g, '')}`
export const smsLink = (p: string, body: string) => `sms:${p.replace(/[^\d+]/g, '')}?&body=${encodeURIComponent(body)}`
export const mailLink = (to: string, subject: string, body: string) =>
  `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`

export const wazeLink = (a?: Address) => `https://waze.com/ul?q=${encodeURIComponent(addressText(a))}&navigate=yes`
export const mapsLink = (a?: Address) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressText(a))}`
export const mapsEmbed = (a?: Address) => `https://maps.google.com/maps?q=${encodeURIComponent(addressText(a))}&z=16&output=embed&hl=iw`

// יומן גוגל: קישור "הוסף ליומן" (בלי API)
function gcalDate(iso: string) {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}
export function googleCalendarLink(ev: { title: string; start: string; end: string; details?: string; location?: string }) {
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: ev.title,
    dates: `${gcalDate(ev.start)}/${gcalDate(ev.end)}`,
    details: ev.details ?? '',
    location: ev.location ?? '',
    ctz: 'Asia/Jerusalem',
  })
  return `https://calendar.google.com/calendar/render?${p.toString()}`
}

// קובץ ICS: נפתח בכל יומן (גוגל, אאוטלוק, אייפון)
export function icsFile(events: { id: string; title: string; start: string; end: string; details?: string; location?: string }[]) {
  const esc = (s = '') => s.replace(/[\\;,]/g, (m) => '\\' + m).replace(/\n/g, '\\n')
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${brand.nameEn}//Ops//HE`, 'CALSCALE:GREGORIAN']
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.id}@genair-ops`,
      `DTSTAMP:${gcalDate(new Date().toISOString())}`,
      `DTSTART:${gcalDate(e.start)}`,
      `DTEND:${gcalDate(e.end)}`,
      `SUMMARY:${esc(e.title)}`,
      `DESCRIPTION:${esc(e.details)}`,
      `LOCATION:${esc(e.location)}`,
      'BEGIN:VALARM',
      'TRIGGER:-PT60M',
      'ACTION:DISPLAY',
      `DESCRIPTION:${esc(e.title)}`,
      'END:VALARM',
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' })
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

// כתובת מלאה לפורטל הלקוח (עובד גם בתת-נתיב)
export function portalUrl(token: string) {
  const base = window.location.href.split('#')[0]
  return `${base}#/portal/${token}`
}

export async function shareOrCopy(data: { title: string; text: string; url?: string }): Promise<'shared' | 'copied' | 'failed'> {
  try {
    if (navigator.share) {
      await navigator.share(data)
      return 'shared'
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return 'failed'
  }
  try {
    await navigator.clipboard.writeText([data.text, data.url].filter(Boolean).join('\n'))
    return 'copied'
  } catch {
    return 'failed'
  }
}
