// הודעות ללקוחות. במצב "קישור" (ברירת מחדל) נפתח וואטסאפ עם הודעה מוכנה, בלי API ובלי עלות.
// במצב Cloud API ההודעה נשלחת מהשרת (דורש חשבון WhatsApp Business מאומת ותבניות מאושרות).
import { brand } from '../brand'
import { app } from './store'
import { api, serverConfigured } from './integrations/server'
import { whatsappLink } from './integrations/links'
import type { Channel, ID, Message } from './types'
import { nowIso, uid } from './format'
import { toast } from '../components/ui'

export type TemplateKey =
  | 'quote'
  | 'quote_reminder'
  | 'survey'
  | 'schedule'
  | 'on_the_way'
  | 'completed'
  | 'review'
  | 'service_received'
  | 'maintenance'
  | 'deposit'
  | 'portal'
  | 'free'

export const templates: Record<TemplateKey, { label: string; text: string }> = {
  quote: { label: 'שליחת הצעת מחיר', text: 'שלום {name}, מצורפת הצעת המחיר של {brand}. אפשר לצפות, לשאול ולאשר כאן: {portal}' },
  quote_reminder: { label: 'תזכורת להצעה', text: 'שלום {name}, רצינו לוודא שקיבלת את הצעת המחיר. ההצעה בתוקף עד {valid}. לשאלות אני זמין: {portal}' },
  survey: { label: 'אישור סקר בשטח', text: 'שלום {name}, נקבע סקר בשטח ל-{date} בשעה {time} בכתובת {address}. נגיע עם מדידות וייעוץ. {brand}' },
  schedule: { label: 'אישור מועד התקנה', text: 'שלום {name}, ההתקנה נקבעה ל-{date} בשעה {time}. הצוות: {team}. לפרטים ושינויים: {portal}' },
  on_the_way: { label: 'המתקין בדרך', text: 'שלום {name}, {team} בדרך אליכם, צפי הגעה בעוד כ-{eta} דקות. {brand}' },
  completed: { label: 'סיום התקנה', text: 'שלום {name}, ההתקנה הסתיימה. טופס המסירה, האחריות והוראות השימוש נמצאים כאן: {portal}. תודה שבחרתם ב-{brand}!' },
  review: { label: 'בקשת חוות דעת', text: 'שלום {name}, נשמח לשמוע איך היה. חוות דעת קצרה עוזרת לנו מאוד: {review}' },
  service_received: { label: 'קריאת שירות התקבלה', text: 'שלום {name}, קריאת השירות {number} התקבלה. נחזור אליך לתיאום מועד בהקדם. {brand}' },
  maintenance: { label: 'תזכורת טיפול תקופתי', text: 'שלום {name}, הגיע הזמן לטיפול התקופתי במזגנים (ניקוי פילטרים ובדיקה). להשבת "כן" ונתאם מועד. {brand}' },
  deposit: { label: 'אישור קבלת מקדמה', text: 'שלום {name}, קיבלנו את המקדמה ע״ס {amount}. תודה! ניצור קשר לתיאום מועד ההתקנה. {brand}' },
  portal: { label: 'קישור לאזור האישי', text: 'שלום {name}, כאן אפשר לראות את כל פרטי הפרויקט, המסמכים והמועדים: {portal}' },
  free: { label: 'הודעה חופשית', text: '' },
}

export function fill(text: string, vars: Record<string, string | number | undefined>) {
  return text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? (k === 'brand' ? brand.name : '')))
}

export async function sendMessage(opts: {
  to: string
  body: string
  channel?: Channel
  caseId?: ID
  serviceCallId?: ID
  customerId?: ID
  templateKey?: TemplateKey
}): Promise<Message> {
  const s = app().settings
  const channel = opts.channel ?? 'whatsapp'
  let status: Message['status'] = 'opened'
  if (channel === 'whatsapp' && s.whatsappMode === 'cloud_api' && serverConfigured()) {
    try {
      await api('/api/whatsapp/send', { method: 'POST', json: { to: opts.to, text: opts.body } })
      status = 'sent'
    } catch (e) {
      // ההודעה מהשרת (למשל "יותר מדי בקשות" או תבנית שלא אושרה)
      status = 'failed'
      toast.error(`וואטסאפ: ${(e as Error).message}`)
    }
  } else if (channel === 'whatsapp') {
    window.open(whatsappLink(opts.to, opts.body), '_blank', 'noopener')
  } else if (channel === 'portal') {
    // תשובה באזור האישי: רק נשמרת, והלקוח רואה אותה בפורטל (בלי חלון וואטסאפ)
    status = 'sent'
  }
  const msg: Message = {
    id: uid('m'),
    caseId: opts.caseId,
    serviceCallId: opts.serviceCallId,
    customerId: opts.customerId,
    channel,
    direction: 'out',
    body: opts.body,
    at: nowIso(),
    by: app().currentUserId,
    status,
    templateKey: opts.templateKey,
  }
  app().upsert('messages', msg)
  app().log({ kind: 'message', caseId: opts.caseId, serviceCallId: opts.serviceCallId, customerId: opts.customerId, text: channel === 'portal' ? `תשובה ללקוח באזור האישי: ${opts.body.slice(0, 60)}` : `נשלחה הודעה: ${templates[opts.templateKey ?? 'free'].label}` })
  return msg
}
