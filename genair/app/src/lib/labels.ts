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

export type Tone = 'neutral' | 'info' | 'brand' | 'success' | 'warning' | 'danger' | 'muted'

export const roleLabel: Record<Role, string> = {
  admin: 'ניהול',
  office: 'משרד ותיאום',
  agent: 'סוכן',
  engineer: 'מהנדס',
  installer: 'מתקין',
}

export const stageLabel: Record<CaseStage, string> = {
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

export const projectTypeLabel: Record<ProjectType, string> = {
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
