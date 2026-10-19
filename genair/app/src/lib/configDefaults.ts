// ברירות המחדל של הרשימות שהמנהל עורך (הגדרות ← רשימות). בלי תלות ב-store, כדי שה-seed יוכל להשתמש בהן.
import type { Config, ListOption } from './types'

function opt(key: string, label: string, color?: string, system = false): ListOption {
  return { key, label, color, active: true, system }
}

export function defaultConfig(): Config {
  return {
    projectTypes: [
      { ...opt('apartment', 'דירה', '#00aeef', true), autoName: true },
      { ...opt('luxury', 'דירת יוקרה / בית פרטי', '#7c3aed', true), autoName: true },
      { ...opt('institution', 'מוסדות ומבני ציבור', '#0f766e', true), autoName: false },
      { ...opt('commercial', 'מסחר ותעשייה', '#ea580c', true), autoName: false },
      { ...opt('residential_building', 'בנייה רוויה', '#2563eb', true), autoName: false },
      { ...opt('underfloor_heating', 'חימום תת-רצפתי', '#dc2626', true), autoName: true },
      { ...opt('smoke_ventilation', 'אוורור ושחרור עשן', '#e11d48', true), autoName: false },
      { ...opt('replacement', 'החלפת מזגן', '#16a34a', true), autoName: true },
      { ...opt('other', 'אחר', '#64748b', true), autoName: false },
    ],
    caseStages: [
      opt('lead', 'ליד חדש', '#64748b', true),
      opt('survey', 'סקר בשטח', '#0ea5e9', true),
      opt('quote', 'הצעת מחיר', '#7c3aed', true),
      opt('approved', 'אושר', '#16a34a', true),
      opt('scheduled', 'מתואם להתקנה', '#2563eb', true),
      opt('installing', 'בהתקנה', '#ea580c', true),
      opt('completed', 'הותקן', '#0f766e', true),
      opt('closed', 'נסגר', '#334155', true),
      opt('lost', 'לא נסגר', '#94a3b8', true),
    ],
    tags: [opt('vip', 'VIP', '#ca8a04'), opt('urgent_install', 'התקנה דחופה', '#dc2626'), opt('architect', 'דרך אדריכל', '#7c3aed'), opt('crane', 'צריך מנוף', '#ea580c')],
    expenseCategories: [opt('equipment', 'ציוד', '#2563eb'), opt('materials', 'חומרים', '#0ea5e9'), opt('labor', 'עבודה', '#16a34a'), opt('subcontractor', 'קבלן משנה', '#7c3aed'), opt('crane', 'מנוף', '#ea580c'), opt('transport', 'הובלה', '#64748b'), opt('other', 'אחר', '#94a3b8')],
    budgetItemTypes: [opt('equipment', 'ציוד', '#2563eb'), opt('labor', 'עבודה', '#16a34a'), opt('services', 'שירותים', '#ea580c'), opt('contingency', 'בלת״מ', '#94a3b8')],
    paymentMethods: [opt('credit', 'אשראי'), opt('bit', 'Bit'), opt('transfer', 'העברה בנקאית'), opt('check', 'צ׳ק'), opt('cash', 'מזומן')],
    contactMethods: [opt('none', 'ללא'), opt('phone', 'טלפון'), opt('whatsapp', 'וואטסאפ'), opt('email', 'אימייל'), opt('referral', 'הפנייה'), opt('website', 'אתר'), opt('other', 'אחר')],
    driveFolders: [
      opt('office', 'משרד', '#2563eb', true),
      opt('customer', 'לקוח', '#16a34a', true),
      opt('installer', 'מתקין', '#ea580c', true),
      opt('engineering', 'הנדסה', '#7c3aed', true),
      opt('suppliers', 'ספקים', '#dc2626', true),
      opt('archive', 'ארכיון', '#64748b', true),
    ],
    taskStatuses: [opt('new', 'חדש', '#2563eb', true), opt('in_progress', 'בביצוע', '#ea580c'), opt('waiting_approval', 'ממתין לאישור', '#ca8a04'), opt('waiting', 'ממתין', '#64748b'), opt('done', 'הושלם', '#16a34a', true)],
    taskPriorities: [opt('low', 'נמוכה', '#64748b', true), opt('normal', 'רגילה', '#2563eb', true), opt('high', 'גבוהה', '#dc2626', true)],
    leaveTypes: [opt('vacation', 'חופשה', '#16a34a'), opt('sick', 'מחלה', '#dc2626'), opt('reserve', 'מילואים', '#4d7c0f'), opt('personal', 'יום אישי', '#7c3aed'), opt('holiday', 'חג / ערב חג', '#ca8a04')],
    supplierCategories: [opt('units', 'יחידות מיזוג', '#00aeef'), opt('materials', 'צנרת וחומרים', '#2563eb'), opt('subcontractor', 'קבלן משנה', '#7c3aed'), opt('crane', 'מנופים', '#ea580c'), opt('electric', 'חשמל', '#ca8a04'), opt('other', 'אחר', '#64748b')],
    commissionRules: [{ id: 'cr-default', name: 'עמלה בסיסית', pct: 3, base: 'net', active: true }],
    flowStages: [
      { id: 'fs-docs', name: 'קליטה ומסמכים', color: '#64748b', tasks: [{ title: 'להעלות תוכניות ומסמכים מהלקוח', role: 'agent', dueDays: 2 }, { title: 'לפתוח לקוח ב-Priority', role: 'office', dueDays: 1 }] },
      { id: 'fs-survey', name: 'סקר ותכנון', color: '#0ea5e9', caseStage: 'quote', tasks: [{ title: 'לתאם ולבצע סקר בשטח', role: 'agent', dueDays: 3 }, { title: 'לבדוק עומסים ולוח חשמל', role: 'engineer', dueDays: 5 }] },
      { id: 'fs-quote', name: 'הצעה ואישור', color: '#7c3aed', caseStage: 'approved', tasks: [{ title: 'לשלוח הצעת מחיר ולעקוב', role: 'agent', dueDays: 2 }] },
      { id: 'fs-order', name: 'הזמנת ציוד ותיאום', color: '#2563eb', caseStage: 'scheduled', tasks: [{ title: 'להזמין ציוד מהספק', role: 'department_managers', dueDays: 2 }, { title: 'לתאם מועד התקנה עם הלקוח', role: 'office', dueDays: 3 }] },
      { id: 'fs-install', name: 'התקנה ומסירה', color: '#ea580c', caseStage: 'completed', tasks: [{ title: 'לוודא ציוד ומנוף לפני יום ההתקנה', role: 'project_manager', dueDays: 1 }] },
      { id: 'fs-close', name: 'גבייה וסגירה', color: '#0f766e', caseStage: 'closed', tasks: [{ title: 'לגבות יתרה', role: 'office', dueDays: 7 }, { title: 'להציע חוזה תחזוקה', role: 'agent', dueDays: 7 }] },
    ],
    caseTemplates: [
      { id: 'ct-residential', name: 'פרויקט מגורים', projectTypes: ['apartment', 'luxury', 'replacement', 'underfloor_heating'], stageIds: ['fs-docs', 'fs-survey', 'fs-quote', 'fs-order', 'fs-install', 'fs-close'], active: true },
      { id: 'ct-large', name: 'פרויקט גדול / מוסדי', projectTypes: ['institution', 'commercial', 'residential_building', 'smoke_ventilation'], stageIds: ['fs-docs', 'fs-survey', 'fs-quote', 'fs-order', 'fs-install', 'fs-close'], defaultTags: ['architect'], active: true },
    ],
    caseNumbering: { mode: 'global', prefix: 'GN-', pad: 4 },
    theme: 'genair',
    installerDayCost: 1100,
  }
}

