// טיוטת הצעת מחיר מתמונות הסקר ונתוני החדרים.
// סדר עדיפויות: שרת אינטגרציות (המפתח בשרת) → מפתח שהוזן בדפדפן הזה (הדגמה) → מנוע חישוב מקומי.
// ה-AI בוחר רק פריטים מהקטלוג; המחירים תמיד מגיעים מהמחירון, לא מהמודל.
import { app } from '../store'
import { api, serverConfigured } from './server'
import type { AiMeta, Case, CatalogItem, Photo, QuoteLine, Survey } from '../types'
import { projectTypeLabel } from '../labels'
import { nowIso, uid } from '../format'

// מסמך מקור שמצרפים לניתוח: תוכנית אדריכל, כתב כמויות, מפרט, הצעה של ספק או תמונה
export interface SourceFile {
  id: string
  name: string
  mime: string
  dataUrl: string
  size: number
}

// דרך השרת הבקשה עוברת דרך Vercel (מגבלה של 4.5MB לבקשה); ישירות מהדפדפן עד 32MB לבקשה
export function sourceLimit(mode: 'server' | 'browser' | 'demo') {
  return { files: 5, bytes: (mode === 'server' ? 3 : 20) * 1024 * 1024 }
}

export const sourceKind = (mime: string, name = ''): 'pdf' | 'image' | 'text' | null =>
  mime === 'application/pdf' || /\.pdf$/i.test(name) ? 'pdf'
    : mime.startsWith('image/') ? 'image'
    : mime.startsWith('text/') || /\.(txt|csv)$/i.test(name) ? 'text'
    : null

export interface AiDraft {
  lines: QuoteLine[]
  meta: AiMeta
}

interface ModelLine {
  itemId: string
  qty: number
  room: string
  reason: string
}
interface ModelOut {
  summary: string
  confidence: 'low' | 'medium' | 'high'
  assumptions: string[]
  questions: string[]
  lines: ModelLine[]
}

const sunLabel = { low: 'נמוכה', medium: 'בינונית', high: 'גבוהה' } as const

function schema(catalog: CatalogItem[]) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'confidence', 'assumptions', 'questions', 'lines'],
    properties: {
      summary: { type: 'string', description: 'תיאור קצר בעברית של מה שנראה בתמונות ובנתונים' },
      confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
      assumptions: { type: 'array', items: { type: 'string' } },
      questions: { type: 'array', items: { type: 'string' } },
      lines: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['itemId', 'qty', 'room', 'reason'],
          properties: {
            itemId: { type: 'string', enum: catalog.map((c) => c.id) },
            qty: { type: 'number' },
            room: { type: 'string' },
            reason: { type: 'string' },
          },
        },
      },
    },
  }
}

const SYSTEM = `אתה מעריך מחירים בכיר בחברת מיזוג אוויר בישראל. אתה מקבל תמונות מסקר בשטח, נתוני חדרים ורשימת פריטים מהקטלוג של החברה, ובונה טיוטת הצעת מחיר שאיש מכירות יבדוק לפני שליחה.
כללים:
- בחר רק פריטים מהקטלוג, לפי ה-itemId שלהם. אל תמציא פריטים ואל תציין מחירים: המחירים נלקחים מהמחירון.
- בחר תפוקה לפי שטח החדר, גובה התקרה והחשיפה לשמש. כלל אצבע בישראל: כ-650 BTU למ״ר, יותר בחשיפה גבוהה ובתקרה גבוהה.
- הוסף עבודה ואביזרים שנדרשים בפועל: התקנה לכל יחידה, צנרת מעבר לבסיס, נקודות חשמל אם הלוח לא מוכן, פירוק מזגנים קיימים, עבודה בגובה או מנוף אם צריך.
- מה שרואים בתמונות (לוחית יצרן, מצב לוח החשמל, מיקום יחידה חיצונית, תקרה) משמש לדיוק. מה שלא רואים, כתוב כהנחה.
- כתוב בעברית פשוטה וקצרה. בכל שורה, reason קצר שמסביר למה השורה נדרשת.
- confidence: low אם חסרים נתונים מהותיים, medium אם יש מספיק לטיוטה, high רק אם הכל ברור.
- questions: מה איש המכירות צריך לברר עם הלקוח או בשטח לפני שליחה.
- לפעמים מצורפים מסמכי מקור (תוכנית אדריכל, כתב כמויות, מפרט טכני, הצעה של ספק או מתחרה). קח מהם חדרים, מידות, כמויות ודרישות, וב-reason ציין מאיזה מסמך הנתון (למשל "לפי התוכנית, עמ׳ 2"). אם המסמך סותר את הסקר בשטח, העדף את הסקר וכתוב את הסתירה ב-questions.`

// פרטים מזהים לא נשלחים ל-AI: שם הלקוח ואנשי הקשר, טלפון, אימייל ורחוב. העיר, החדרים והמידות כן (צריך אותם להצעה)
const PHONE_RE = /(?:\+?972[-\s]?|0)\d{1,2}[-\s]?\d{3}[-\s]?\d{4}/g
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
export function redactor(c: Case): (t?: string) => string {
  const d = app().db
  const cust = d.customers.find((x) => x.id === c.customerId)
  const contacts = d.contacts.filter((x) => x.customerId === c.customerId || c.contactIds?.includes(x.id))
  const pairs: [string | undefined, string][] = [
    [cust?.name, 'הלקוח'],
    [cust?.name.replace(/^(משפחת|מר|גב׳|גברת)\s+/, ''), 'הלקוח'],
    ...contacts.map((x): [string, string] => [x.name, 'איש הקשר']),
    ...(cust?.addresses ?? []).map((a): [string, string] => [a.street, 'רחוב']),
  ]
  const words = pairs.map(([w, l]) => [w?.trim() ?? '', l] as const).filter(([w]) => w.length >= 2).sort((a, b) => b[0].length - a[0].length)
  return (t = '') => {
    let out = t.replace(EMAIL_RE, '[אימייל]').replace(PHONE_RE, '[טלפון]')
    for (const [w, l] of words) out = out.split(w).join(`[${l}]`)
    return out
  }
}

function describe(c: Case, survey: Survey, catalog: CatalogItem[]) {
  const safe = redactor(c)
  const rooms = survey.rooms.length
    ? survey.rooms
        .map((r) => `- ${safe(r.name)}: ${r.areaSqm ?? '?'} מ״ר, תקרה ${r.ceilingM ?? 2.7} מ׳, חשיפה לשמש ${r.sunExposure ? sunLabel[r.sunExposure] : 'לא ידועה'}${r.floor !== undefined ? `, קומה ${r.floor}` : ''}${r.notes ? ` (${safe(r.notes)})` : ''}`)
        .join('\n')
    : 'לא הוזנו חדרים.'
  const items = catalog
    .filter((i) => i.active)
    .map((i) => `${i.id} | ${i.name} | ${i.unit}${i.btu ? ` | ${i.btu} BTU` : ''}`)
    .join('\n')
  return `סוג פרויקט: ${projectTypeLabel[c.projectType]}
כותרת התיק: ${safe(c.title)}
${c.notes ? `הערות מהפנייה: ${safe(c.notes)}\n` : ''}
חדרים:
${rooms}

נתוני שטח:
- אורך צנרת משוער כולל: ${survey.pipeLengthM ?? 'לא נמדד'} מ׳
- עבודה בגובה: ${survey.workAtHeight ? 'כן' : 'לא'}
- מנוף: ${survey.craneNeeded ? 'כן' : 'לא'}
- לוח חשמל מוכן לנקודות חדשות: ${survey.electricalReady === undefined ? 'לא ידוע' : survey.electricalReady ? 'כן' : 'לא'}
- מזגנים קיימים לפירוק: ${survey.existingUnitsToRemove ?? 0}
${survey.voiceNotes ? `- הערות קוליות מהסקר: ${safe(survey.voiceNotes)}\n` : ''}${survey.notes ? `- הערות: ${safe(survey.notes)}\n` : ''}
קטלוג (itemId | שם | יחידה | תפוקה):
${items}`
}

// תמונה ל-base64 שהמודל מקבל: SVG עובר רסטר ל-PNG, תמונות גדולות מוקטנות (חוסך טוקנים)
async function toImageBlock(p: Photo, max = 1568): Promise<{ type: 'image'; source: { type: 'base64'; media_type: string; data: string } } | null> {
  try {
    const img = new Image()
    img.src = p.dataUrl
    await img.decode()
    const scale = Math.min(1, max / Math.max(img.naturalWidth || 800, img.naturalHeight || 600))
    const w = Math.round((img.naturalWidth || 800) * scale)
    const h = Math.round((img.naturalHeight || 600) * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    const data = canvas.toDataURL('image/jpeg', 0.85).split(',')[1]
    return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } }
  } catch {
    return null
  }
}

async function callClaude(body: unknown): Promise<{ stop_reason: string; content: { type: string; text?: string }[]; model: string }> {
  const s = app().settings
  if (serverConfigured()) {
    return api('/api/ai/messages', { method: 'POST', json: body, headers: { 'anthropic-beta': 'server-side-fallback-2026-07-01' } })
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': s.anthropicKey.trim(),
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json?.error?.message || `שגיאת AI ${res.status}`)
  return json
}

export function aiMode(): 'server' | 'browser' | 'demo' {
  const s = app().settings
  if (serverConfigured()) return 'server'
  if (s.anthropicKey.trim()) return 'browser'
  return 'demo'
}

async function sourceBlocks(sources: SourceFile[], px: number): Promise<unknown[]> {
  const out: unknown[] = []
  for (const [i, f] of sources.entries()) {
    const kind = sourceKind(f.mime, f.name)
    const label = { type: 'text', text: `מסמך מקור ${i + 1}: ${f.name}` }
    if (kind === 'pdf') {
      out.push(label, { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.dataUrl.split(',')[1] } })
    } else if (kind === 'image') {
      const img = await toImageBlock({ id: f.id, dataUrl: f.dataUrl, takenAt: '' } as Photo, px)
      if (img) out.push(label, img)
    } else if (kind === 'text') {
      const text = await (await fetch(f.dataUrl)).text()
      out.push({ type: 'text', text: `${label.text}\n${text.slice(0, 60_000)}` })
    }
  }
  return out
}

export async function draftQuote(c: Case, survey: Survey, catalog: CatalogItem[], sources: SourceFile[] = []): Promise<AiDraft> {
  const mode = aiMode()
  if (mode === 'demo') return demoDraft(c, survey, catalog)

  const s = app().settings
  // דרך השרת: עד 6 תמונות ב-1280px, כדי להישאר מתחת למגבלת גודל הבקשה (4.5MB ב-Vercel)
  const maxImages = mode === 'server' ? 6 : 8
  const px = mode === 'server' ? 1280 : 1568
  const photos = survey.photos.slice(0, maxImages)
  const images = await Promise.all(photos.map((p) => toImageBlock(p, px)))
  const content: unknown[] = []
  const safe = redactor(c)
  photos.forEach((p, i) => {
    if (images[i]) {
      content.push({ type: 'text', text: `תמונה ${i + 1}: ${p.caption ? safe(p.caption) : 'ללא כיתוב'}` })
      content.push(images[i])
    }
  })
  // מסמכים לפני הטקסט המסכם, כמו שהמודל מצפה
  content.push(...(await sourceBlocks(sources.slice(0, sourceLimit(mode).files), px)))
  content.push({ type: 'text', text: describe(c, survey, catalog) })

  const body = {
    model: s.aiModel,
    max_tokens: 16000,
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: schema(catalog) } },
    system: SYSTEM,
    messages: [{ role: 'user', content }],
  }
  const res = await callClaude(body)
  if (res.stop_reason === 'refusal') throw new Error('המודל סירב לבקשה. נסו לנסח מחדש את ההערות או להסיר תמונה.')
  if (res.stop_reason === 'max_tokens') throw new Error('התשובה נקטעה. נסו עם פחות תמונות.')
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
  const out = JSON.parse(text) as ModelOut
  return {
    lines: toLines(out.lines, catalog),
    meta: {
      source: 'claude',
      model: res.model,
      confidence: out.confidence,
      summary: out.summary,
      assumptions: out.assumptions,
      questions: out.questions,
      createdAt: nowIso(),
    },
  }
}

function toLines(lines: ModelLine[], catalog: CatalogItem[]): QuoteLine[] {
  const out: QuoteLine[] = []
  for (const l of lines) {
    const item = catalog.find((c) => c.id === l.itemId)
    if (!item || !(l.qty > 0)) continue
    out.push({
      id: uid('ln'),
      itemId: item.id,
      description: item.name,
      qty: Math.round(l.qty * 100) / 100,
      unit: item.unit,
      unitPrice: item.price,
      room: l.room || undefined,
      aiReason: l.reason,
    })
  }
  return out
}

// מנוע חישוב מקומי: עובד בלי מפתח, לפי כללי אצבע של הענף
export function demoDraft(c: Case, survey: Survey, catalog: CatalogItem[]): AiDraft {
  const units = catalog.filter((i) => i.category === 'unit' && i.btu && i.active).sort((a, b) => a.btu! - b.btu!)
  const find = (id: string) => catalog.find((x) => x.id === id)
  const out: ModelLine[] = []
  const assumptions: string[] = []
  const questions: string[] = []
  let unitCount = 0

  for (const r of survey.rooms) {
    if (!r.areaSqm) {
      questions.push(`לא הוזן שטח ל"${r.name}"`)
      continue
    }
    const sun = r.sunExposure === 'high' ? 1.15 : r.sunExposure === 'low' ? 0.9 : 1
    const ceiling = (r.ceilingM ?? 2.7) / 2.7
    const need = Math.round(r.areaSqm * 650 * sun * ceiling)
    const pick = units.find((u) => u.btu! >= need) ?? units[units.length - 1]
    if (!pick) continue
    out.push({ itemId: pick.id, qty: 1, room: r.name, reason: `${r.areaSqm} מ״ר${r.sunExposure === 'high' ? ', חשיפה גבוהה' : ''}: נדרשים כ-${need.toLocaleString('he-IL')} BTU` })
    unitCount++
    if (!r.ceilingM) assumptions.push(`גובה תקרה 2.7 מ׳ ב"${r.name}"`)
  }

  const wall = out.filter((l) => (find(l.itemId)?.btu ?? 0) <= 24000).length
  const central = unitCount - wall
  if (wall) out.push({ itemId: 'l-inst', qty: wall, room: '', reason: 'התקנה לכל מזגן עילי' })
  if (central) out.push({ itemId: 'l-instm', qty: central, room: '', reason: 'התקנת מיני מרכזי כולל תעלות' })
  const extraPipe = Math.max(0, (survey.pipeLengthM ?? 0) - unitCount * 3)
  if (extraPipe) out.push({ itemId: 'l-pipe', qty: extraPipe, room: '', reason: `${survey.pipeLengthM} מ׳ צנרת, מתוכם ${unitCount * 3} מ׳ כלולים בהתקנה` })
  else if (survey.pipeLengthM === undefined) questions.push('לא נמדד אורך צנרת: המחיר יכול להשתנות')
  if (survey.electricalReady === false) out.push({ itemId: 'l-elec', qty: Math.max(1, Math.ceil(unitCount / 2)), room: '', reason: 'הלוח לא מוכן לנקודות חדשות' })
  if (survey.electricalReady === undefined) questions.push('לבדוק את לוח החשמל: האם צריך נקודות ייעודיות?')
  if (survey.existingUnitsToRemove) out.push({ itemId: 'l-remove', qty: survey.existingUnitsToRemove, room: '', reason: 'פירוק ופינוי מזגנים קיימים' })
  if (survey.workAtHeight) out.push({ itemId: 'l-height', qty: 1, room: '', reason: 'יחידה חיצונית שדורשת עבודה בגובה' })
  if (survey.craneNeeded) out.push({ itemId: 'l-crane', qty: 1, room: '', reason: 'הרמת ציוד במנוף' })
  if (c.projectType === 'luxury' && unitCount) out.push({ itemId: 'l-wifi', qty: unitCount, room: '', reason: 'בקר חכם: סטנדרט בפרויקטי יוקרה' })
  if (!survey.photos.length) assumptions.push('אין תמונות מהסקר: הטיוטה מבוססת על נתוני החדרים בלבד')
  if (!survey.rooms.length) questions.push('לא הוזנו חדרים: אי אפשר לחשב תפוקה')

  return {
    lines: toLines(out, catalog),
    meta: {
      source: 'demo',
      confidence: questions.length > 1 || !survey.rooms.length ? 'low' : 'medium',
      summary: unitCount ? `${unitCount} יחידות לפי ${survey.rooms.length} חדרים, חושב לפי שטח וחשיפה לשמש.` : 'אין מספיק נתונים לחישוב.',
      assumptions,
      questions,
      createdAt: nowIso(),
    },
  }
}
