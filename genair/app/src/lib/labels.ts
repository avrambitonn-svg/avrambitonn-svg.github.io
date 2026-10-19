// תוויות לתצוגה. סוגי פרויקטים וסטטוסי תיקים נקראים מההגדרות (הגדרות ← רשימות), עם ברירת מחדל מובנית.
import type {
  AppointmentStatus,
  AppointmentType,
  ApartmentPlanStatus,
  CaseStage,
  ContractType,
  CustomerType,
  ItemCategory,
  LeadSource,
  ProjectType,
  QuoteStatus,
  Role,
  ServiceStatus,
  SyncStatus,
} from './types'
import type { Config, ListOption } from './types'
import { useApp } from './store'

export type Tone = 'neutral' | 'info' | 'brand' | 'success' | 'warning' | 'danger' | 'muted'

export const roleLabel: Record<Role, string> = {
  admin: 'ניהול',
  office: 'משרד ותיאום',
  agent: 'סוכן',
  engineer: 'מהנדס',
  installer: 'מתקין',
}

const builtinStageLabel: Record<CaseStage, string> = {
  lead: 'ליד חדש',
  survey: 'סקר בשטח',
  quote: 'הצעת מחיר',
  approved: 'אושר',
  scheduled: 'מתואם להתקנה',
  installing: 'בהתקנה',
  completed: 'הותקן',
  closed: 'נסגר',
  lost: 'לא נסגר',
}

export const stageTone: Record<CaseStage, Tone> = {
  lead: 'info',
  survey: 'info',
  quote: 'brand',
  approved: 'success',
  scheduled: 'warning',
  installing: 'warning',
  completed: 'success',
  closed: 'muted',
  lost: 'danger',
}

// סדר השלבים בצנרת המכירה (בלי "לא נסגר")
export const pipeline: CaseStage[] = ['lead', 'survey', 'quote', 'approved', 'scheduled', 'installing', 'completed', 'closed']

const builtinProjectTypeLabel: Record<string, string> = {
  apartment: 'דירה',
  luxury: 'דירת יוקרה / בית פרטי',
  institution: 'מוסדות ומבני ציבור',
  commercial: 'מסחר ותעשייה',
  residential_building: 'בנייה רוויה',
  underfloor_heating: 'חימום תת-רצפתי',
  smoke_ventilation: 'אוורור ושחרור עשן',
  replacement: 'החלפת מזגן',
  other: 'אחר',
}

// ---------- רשימות מההגדרות ----------
// קריאה עצלה מה-store בתוך המלכודת: אין תלות בסדר טעינת המודולים (ואם ה-store עוד לא מוכן, חוזרים לברירת המחדל)
function liveConfig(): Config | undefined {
  try {
    return useApp.getState().db.config
  } catch {
    return undefined
  }
}

const protoKeys = new Set(Object.getOwnPropertyNames(Object.prototype))

// מפה שמתנהגת כמו Record רגיל (גם Object.keys/entries), אבל קוראת את הרשימה העדכנית.
// keys: רק פריטים פעילים (לבחירה ברשימות); get: כל פריט, גם מושבת (כדי שרשומות ישנות יוצגו נכון)
function liveLabels<K extends string>(builtin: Record<string, string>, list: (c: Config) => ListOption[] | undefined, keysOf?: () => string[]): Record<K, string> {
  const items = () => {
    const c = liveConfig()
    return (c && list(c)) || undefined
  }
  const label = (key: string): string | undefined => items()?.find((o) => o.key === key)?.label || builtin[key]
  const keys = (): string[] => (keysOf ? keysOf() : items()?.filter((o) => o.active).map((o) => o.key) ?? Object.keys(builtin))
  return new Proxy({} as Record<K, string>, {
    get(_t, key) {
      if (typeof key !== 'string') return undefined
      if (protoKeys.has(key)) return (Object.prototype as unknown as Record<string, unknown>)[key]
      return label(key) ?? key
    },
    has: (_t, key) => typeof key === 'string' && label(key) !== undefined,
    ownKeys: () => keys(),
    getOwnPropertyDescriptor: (_t, key) => {
      if (typeof key !== 'string' || !keys().includes(key)) return undefined
      return { value: label(key) ?? key, enumerable: true, configurable: true, writable: false }
    },
    set: () => false,
    deleteProperty: () => false,
  })
}

const caseStageKeys = Object.keys(builtinStageLabel)
export const stageLabel: Record<CaseStage, string> = liveLabels<CaseStage>(builtinStageLabel, (c) => c.caseStages, () => caseStageKeys)
export const projectTypeLabel: Record<ProjectType, string> = liveLabels<ProjectType>(builtinProjectTypeLabel, (c) => c.projectTypes)

const colorIn = (list: ListOption[] | undefined, key?: string) => (key ? list?.find((o) => o.key === key)?.color : undefined)
export const stageColor = (s: CaseStage) => colorIn(liveConfig()?.caseStages, s) ?? '#64748b'
export const projectTypeColor = (t?: string) => colorIn(liveConfig()?.projectTypes, t) ?? '#64748b'
export const projectTypeAutoName = (t?: string) => !!liveConfig()?.projectTypes.find((o) => o.key === t)?.autoName
// תגיות נשמרות בתיק כטקסט (או כמפתח, אם הגיעו מתבנית): מחזירים תווית וצבע מההגדרות
const tagOpt = (t: string) => liveConfig()?.tags.find((o) => o.key === t || o.label === t)
export const tagLabel = (t: string) => tagOpt(t)?.label ?? t
export const tagColor = (t: string) => tagOpt(t)?.color

export const sourceLabel: Record<LeadSource, string> = {
  phone: 'טלפון',
  whatsapp: 'וואטסאפ',
  website: 'אתר',
  referral: 'המלצה',
  facebook: 'פייסבוק / אינסטגרם',
  returning: 'לקוח חוזר',
  portal: 'פורטל לקוח',
  other: 'אחר',
}

export const customerTypeLabel: Record<CustomerType, string> = {
  private: 'פרטי',
  business: 'עסק',
  institution: 'מוסד',
  developer: 'יזם / קבלן',
}

export const quoteStatusLabel: Record<QuoteStatus, string> = {
  draft: 'טיוטה',
  sent: 'נשלחה',
  viewed: 'נצפתה',
  approved: 'אושרה',
  rejected: 'נדחתה',
  expired: 'פג תוקף',
}

export const quoteStatusTone: Record<QuoteStatus, Tone> = {
  draft: 'muted',
  sent: 'info',
  viewed: 'brand',
  approved: 'success',
  rejected: 'danger',
  expired: 'warning',
}

export const appointmentTypeLabel: Record<AppointmentType, string> = {
  survey: 'סקר בשטח',
  installation: 'התקנה',
  service: 'קריאת שירות',
  maintenance: 'טיפול תקופתי',
  inspection: 'בדיקה שנתית',
  meeting: 'פגישה',
}

export const appointmentTypeColor: Record<AppointmentType, string> = {
  survey: '#00aeef',
  installation: '#16a34a',
  service: '#f97316',
  maintenance: '#8b5cf6',
  inspection: '#e11d48',
  meeting: '#64748b',
}

export const appointmentStatusLabel: Record<AppointmentStatus, string> = {
  planned: 'מתוכנן',
  confirmed: 'אושר ע״י הלקוח',
  on_the_way: 'בדרך',
  in_progress: 'בביצוע',
  done: 'בוצע',
  cancelled: 'בוטל',
}

export const serviceStatusLabel: Record<ServiceStatus, string> = {
  new: 'חדשה',
  assigned: 'שובצה',
  scheduled: 'מתואמת',
  in_progress: 'בטיפול',
  waiting_parts: 'ממתינה לחלק',
  done: 'טופלה',
  cancelled: 'בוטלה',
}

export const serviceStatusTone: Record<ServiceStatus, Tone> = {
  new: 'info',
  assigned: 'brand',
  scheduled: 'brand',
  in_progress: 'warning',
  waiting_parts: 'danger',
  done: 'success',
  cancelled: 'muted',
}

export const contractTypeLabel: Record<ContractType, string> = {
  maintenance: 'תחזוקת מזגנים',
  smoke_annual: 'בדיקה ואישור שנתי — שחרור עשן',
  heating: 'תחזוקת חימום תת-רצפתי',
  vrf_service: 'שירות מערכת VRF',
}

export const planStatusLabel: Record<ApartmentPlanStatus, string> = {
  base: 'תוכנית בסיס',
  requested: 'ביקש שינוי',
  quoted: 'נשלחה הצעה',
  approved: 'אישר שינוי',
  installed: 'בוצע',
}

export const planStatusTone: Record<ApartmentPlanStatus, Tone> = {
  base: 'muted',
  requested: 'info',
  quoted: 'brand',
  approved: 'success',
  installed: 'success',
}

export const categoryLabel: Record<ItemCategory, string> = {
  unit: 'יחידות מיזוג',
  labor: 'עבודה',
  material: 'חומרים',
  accessory: 'אביזרים',
  service: 'שירות ותחזוקה',
  heating: 'חימום',
  ventilation: 'אוורור ועשן',
}

export const syncLabel: Record<SyncStatus, string> = {
  synced: 'מסונכרן',
  pending: 'ממתין',
  error: 'שגיאה',
  not_synced: 'לא מסונכרן',
  disabled: 'כבוי',
}

export const syncTone: Record<SyncStatus, Tone> = {
  synced: 'success',
  pending: 'warning',
  error: 'danger',
  not_synced: 'muted',
  disabled: 'muted',
}
