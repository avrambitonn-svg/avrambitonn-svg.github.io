// התסריט של ההדגמה: פרקים ושלבים. כל שלב מצביע על אלמנט אמיתי במסך (לפי טקסט, כדי לשרוד שינויים בעיצוב)
import { app } from '../../lib/store'
import type { Step, Target } from './engine'

export const chapters = [
  { id: 'intro', title: 'פתיחה', sub: 'מה נראה בהדגמה' },
  { id: 'dashboard', title: 'הדשבורד', sub: 'מה דורש טיפול, מי בשטח, משימות והתראות' },
  { id: 'newcase', title: 'פתיחת תיק בשטח', sub: 'לקוח, סוג פרויקט וצוות בדקה' },
  { id: 'case', title: 'ניהול תיק', sub: 'פלואו, סקר, משימות, מסמכים, כספים וצ׳אט' },
  { id: 'quote', title: 'הצעת מחיר עם AI', sub: 'מתמונות הסקר ומסמכים, ועד PDF ממותג' },
  { id: 'portal', title: 'האזור האישי של הלקוח', sub: 'אישור, חתימה ומקדמה מהנייד' },
  { id: 'schedule', title: 'תיאום ושיבוץ', sub: 'יומן, שבת וחג, מועדים פנויים' },
  { id: 'field', title: 'אפליקציית השטח', sub: 'מה המתקין רואה ביום העבודה' },
  { id: 'service', title: 'שירות ותחזוקה', sub: 'קריאות, אחריות וחוזים' },
  { id: 'projects', title: 'בנייה רוויה', sub: 'פרויקטים של יזמים ושדרוגי דיירים' },
  { id: 'stock', title: 'מלאי, ספקים ורכש', sub: 'מחסן, רכבים והזמנות רכש' },
  { id: 'team', title: 'עבודת צוות', sub: 'משימות, חופשות וצ׳אט' },
  { id: 'manage', title: 'ניהול ודוחות', sub: 'דוחות, משתמשים והגדרות' },
  { id: 'integrations', title: 'חיבורים', sub: 'Priority, וואטסאפ, גוגל ועוד' },
  { id: 'end', title: 'סיכום', sub: '' },
] as const

// קיצורים לכתיבת יעדים
const card = (title: string, exact = false): Target => ({ text: title, sel: '.card-head h2, .card-head', closest: '.card', exact })
const btn = (text: string, within?: string): Target => ({ text, sel: 'button, a, label.btn', within })
const tab = (text: string): Target => ({ text, sel: '[role=tab]' })
const field = (label: string, within?: string): Target => ({ text: label, sel: 'label', within })

const asUser = (id: string) => () => { if (app().currentUserId !== id) app().setUser(id) }
const closeModal = () => { (document.querySelector('.modal [aria-label="סגירה"]') as HTMLElement | null)?.click() }
const clearSearch = () => {
  const el = document.querySelector('.topbar input') as HTMLInputElement | null
  if (!el) return
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, '')
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.blur()
}

type S = Omit<Step, 'id'>
const raw: S[] = [
  // ---------- פתיחה ----------
  { chapter: 'intro', route: '/', before: asUser('u-admin'), title: "מערכת התפעול של ג'נאייר", text: 'בכמה דקות נעבור על כל המערכת: מהליד הראשון, דרך הסקר בשטח והצעת המחיר, ועד ההתקנה, השירות והדוחות. הכל על נתוני הדגמה.', read: 6500 },

  // ---------- דשבורד ----------
  { chapter: 'dashboard', route: '/', target: '.content .grid.g4', title: 'המספרים שחשובים עכשיו', text: 'לידים חדשים, הצעות שמחכות ללקוח, מה נסגר החודש וקריאות שירות פתוחות. כל מספר מוביל לרשימה המלאה.' },
  { chapter: 'dashboard', target: card('דורש טיפול עכשיו'), title: 'דורש טיפול עכשיו', text: 'המערכת מוצאת לבד מה תקוע: הצעה שנצפתה ולא אושרה, ליד שלא חזרו אליו, חוזה שמסתיים, שגיאת סנכרון. כל שורה מובילה ישר למקום.' },
  { chapter: 'dashboard', target: card('היום בשטח'), title: 'מי בשטח היום', text: 'כל הצוותים, הכתובות והשעות. הסטטוס מתעדכן מהנייד של המתקין: בדרך, בעבודה, הסתיים.' },
  { chapter: 'dashboard', target: card('תיקים אחרונים'), title: 'תיקים אחרונים', text: 'התיקים שנפתחו לאחרונה והשלב של כל אחד.' },
  { chapter: 'dashboard', target: card('המשימות שלי'), optional: true, title: 'המשימות שלי', text: 'משימות אישיות, משימות שנוצרו אוטומטית מהפלואו, ומשימות ששיתפו איתי. עם עדיפות ותזכורת.' },
  { chapter: 'dashboard', target: '.topbar input', action: { type: 'גולדברג' }, title: 'חיפוש אחד לכל המערכת', text: 'מחפשים תיק, לקוח, טלפון או קריאת שירות מכל מסך.', after: clearSearch },
  { chapter: 'dashboard', target: '[aria-label="התראות"]', action: 'press', title: 'התראות בזמן אמת', text: 'כל עובד מקבל את מה שרלוונטי לו: תיק חדש, הצעה שאושרה, מתקין בדרך, הודעה מלקוח.', after: () => (document.querySelector('[aria-label="התראות"]') as HTMLElement | null)?.click() },
  { chapter: 'dashboard', target: { text: '°', sel: '.topbar .chip' }, optional: true, title: 'מזג אוויר', text: 'התחזית בירושלים. ביום של התקנה חיצונית או עבודה בגובה המערכת מזהירה מראש מגשם, רוח וחום.' },
  { chapter: 'dashboard', target: 'label[title^="תצוגה לפי"]', optional: true, title: 'כל תפקיד רואה מערכת אחרת', text: 'מנהל, משרד, סוכן, מהנדס ומתקין. כל אחד רואה רק את מה שהוא צריך. בהדגמה אפשר להחליף תפקיד מכאן.' },

  // ---------- פתיחת תיק ----------
  { chapter: 'newcase', route: '/', target: btn('תיק חדש'), action: 'click', title: 'תיק חדש', text: 'הסוכן פותח תיק בשטח, מהנייד, תוך דקה.' },
  { chapter: 'newcase', target: { text: 'חיפוש', sel: '.content input' }, action: { type: '052' }, title: 'קודם הלקוח', text: 'מחפשים לפי שם או טלפון. לקוח חדש נפתח כ"לקוח זמני" ומקבל מספר קבוע ב-Priority, והמערכת מזהה כפילות לפי מספר הטלפון.' },
  { chapter: 'newcase', target: btn('ללא לקוח'), action: 'press', title: 'גם בלי לקוח', text: 'ליד מקבלן או מאדריכל? פותחים תיק עכשיו ומשייכים לקוח אחר כך, מדף התיק.' },
  { chapter: 'newcase', target: btn('הבא', '.content'), action: 'click', title: 'הלאה', text: 'ארבעה שלבים קצרים: לקוח, פרטי הפרויקט, צוות וסיכום.', read: 2600 },
  { chapter: 'newcase', target: '.content .choice-grid', title: 'סוג הפרויקט', text: 'דירה, בית פרטי, מוסדות, בנייה רוויה, חימום תת-רצפתי. לכל סוג תבנית עבודה משלו, ואת הרשימה המנהל עורך בעצמו.' },
  { chapter: 'newcase', target: field('שם התיק', '.content'), action: { type: 'מיזוג דירה — הדגמה' }, optional: true, title: 'שם ומספר', text: 'השם יכול להיבנות לבד לפי סוג הפרויקט והלקוח. המספר אוטומטי, או לפי ראשי התיבות של הסוכן.' },
  { chapter: 'newcase', target: btn('הבא', '.content'), action: 'click', title: 'הלאה', text: 'מקור הפנייה, עדיפות, תגיות והערות נשמרים עם התיק.', read: 2600 },
  { chapter: 'newcase', target: { text: 'מנהלי מחלקה', sel: '.content *', closest: '.card' }, optional: true, title: 'צוות התיק', text: 'סוכן, מהנדס, כמה מנהלי מחלקה ומנהל פרויקט. כולם מקבלים את משימות התיק אוטומטית, לפי תבנית העבודה.' },
  { chapter: 'newcase', target: btn('הבא', '.content'), action: 'click', optional: true, title: 'סיכום', text: 'בודקים הכל לפני היצירה.', read: 2400 },
  { chapter: 'newcase', target: btn('יצירת התיק'), title: 'בלחיצה על "יצירת התיק"', text: 'נפתח מספר תיק, תיקייה ב-Google Drive, פלואו עבודה עם משימות לכל אחד, והתראות לצוות. עכשיו נעבור לתיק קיים כדי לראות הכל.', read: 6000 },

  // ---------- ניהול תיק ----------
  { chapter: 'case', route: '/cases/k1', target: { text: 'גולדברג', sel: 'h1', closest: '.card' }, title: 'כל התיק בעמוד אחד', text: 'השלב בצנרת, סוג הפרויקט ופעולות מהירות: שינוי שלב, שיבוץ, הצעה מ-AI ווואטסאפ ללקוח.' },
  { chapter: 'case', target: card('פלואו'), optional: true, title: 'פלואו עבודה', text: 'התיק עובר שלבים קבועים, ובכל שלב נפתחות משימות לאנשים הנכונים. שלב נסגר לבד כשהתיק מתקדם בצנרת.' },
  { chapter: 'case', target: card('לקוח', true), title: 'הלקוח ואנשי הקשר', text: 'סטטוס הסנכרון ל-Priority, איש קשר ראשי, וחיוג, וואטסאפ וניווט ב-Waze בלחיצה.' },
  { chapter: 'case', target: card('צוות', true), title: 'הצוות', text: 'מי אחראי על מה: סוכן, מהנדס, מנהלי מחלקה, מנהל פרויקט ומתקינים. מי שמצורף מקבל התראה.' },
  { chapter: 'case', target: tab('סקר בשטח'), action: 'press', title: 'הסקר בשטח', text: 'חדרים, שטח, גובה תקרה, חשיפה לשמש, תמונות מהמצלמה והקלטה קולית במקום הקלדה.' },
  { chapter: 'case', target: tab('משימות'), action: 'press', title: 'משימות התיק', text: 'משימות ידניות ומשימות שהפלואו פתח, עם אחראי, תאריך ותזכורת.' },
  { chapter: 'case', target: tab('מסמכים'), action: 'press', title: 'מסמכים', text: 'תיקיות קבועות לכל תיק: משרד, לקוח, מתקין, ספקים וארכיון. גוררים קבצים לכאן, והם נשמרים גם ב-Google Drive.' },
  { chapter: 'case', target: tab('כספים'), action: 'press', title: 'כספים', text: 'תקציב מול ביצוע: סעיפי תקציב, הוצאות לפי ספק, עמלות סוכן לפי כללים, תשלומים ויתרה לגבייה.' },
  { chapter: 'case', target: tab('צ׳אט'), action: 'press', title: 'צ׳אט והודעות', text: 'שתי שיחות בכל תיק: מול הלקוח (וואטסאפ והאזור האישי) ושיחה פנימית של הצוות, עם אזכור @.' },
  { chapter: 'case', target: tab('היסטוריה'), action: 'press', title: 'היסטוריה', text: 'כל מה שקרה בתיק ומי עשה את זה, עם סינון לפי סוג והוספת הערות.' },
  { chapter: 'case', target: tab('אזור אישי'), action: 'press', title: 'קישור אישי ללקוח', text: 'לכל לקוח קישור וקוד QR לאזור האישי שלו. בלי סיסמה ובלי אפליקציה.' },

  // ---------- הצעת מחיר ----------
  { chapter: 'quote', route: '/cases/k1', target: tab('סקר בשטח'), action: 'press', title: 'מהסקר להצעה', text: 'כל מה שנאסף בשטח הופך לטיוטת הצעה בלחיצה אחת.', read: 3500 },
  { chapter: 'quote', target: btn('בניית טיוטה מהסקר'), action: 'click', title: 'טיוטה מ-AI', text: 'Claude מקבל את תמונות הסקר ונתוני החדרים ובונה טיוטה מתוך הקטלוג של החברה בלבד.' },
  { chapter: 'quote', target: { text: 'מסמכי מקור', within: '.modal', sel: '.ai-sec-title, div' }, title: 'גם מתוכנית או מכתב כמויות', text: 'אפשר לצרף תוכנית אדריכל, כתב כמויות או מפרט ב-PDF. ה-AI קורא אותם ומשלב את הכמויות והמידות בטיוטה.' },
  { chapter: 'quote', target: btn('בניית טיוטה', '.modal-foot, .modal'), action: 'click', title: 'בונים', text: 'המחירים תמיד נלקחים מהמחירון. ה-AI רק בוחר פריטים וכמויות.' },
  { chapter: 'quote', target: { text: 'יצירת הצעה', within: '.modal', sel: 'button' }, title: 'בודקים ומאשרים', text: 'כל שורה עם הסבר למה היא נדרשת, רמת ביטחון, הנחות ושאלות לבירור. מתקנים כמויות ומחירים, ורק אז נוצרת הצעה.', after: closeModal },
  { chapter: 'quote', route: '/quotes/q1', target: { text: 'הצעת מחיר', sel: 'h1' }, title: 'עורך ההצעה', text: 'שורות לפי חדרים, הנחה, מע״מ, תוקף ותנאים. כל גרסה נשמרת.' },
  { chapter: 'quote', target: btn('מהקטלוג'), title: 'מהמחירון', text: 'בחירה לפי שם, מק״ט או קטגוריה. המחירים מגיעים מ-Priority.' },
  { chapter: 'quote', target: { text: 'רווחיות', sel: '.hd', closest: 'div' }, optional: true, pad: 12, title: 'רווחיות', text: 'עלות, רווח ומרווח לכל הצעה. רק הנהלה ומשרד רואים את זה, ויש אזהרה כשהמרווח נמוך.' },
  { chapter: 'quote', target: btn('שליחה'), title: 'שליחה ללקוח', text: 'בוואטסאפ עם קישור לאזור האישי, או במייל. ההצעה מסומנת כנשלחה, ורואים מתי הלקוח צפה בה.' },
  { chapter: 'quote', target: btn('הדפסה'), title: 'PDF ממותג', text: "הצעה מודפסת בעיצוב של ג'נאייר, עם קוד QR לאזור האישי." },

  // ---------- האזור האישי ----------
  { chapter: 'portal', route: '/portal/pt-k1', target: { text: 'שלום', sel: 'h1' }, title: 'מה הלקוח רואה', text: 'דף אישי בעיצוב החברה: איפה הפרויקט עומד, ההצעה, מועדים, מסמכים ואחריות.' },
  { chapter: 'portal', target: '[aria-label="שלבי הפרויקט"]', title: 'איפה הפרויקט עומד', text: 'הלקוח יודע תמיד מה השלב הבא. פחות טלפונים למשרד.' },
  { chapter: 'portal', target: btn('אישור ההצעה וחתימה'), action: 'click', title: 'אישור בלחיצה', text: 'הלקוח מאשר את ההצעה מהנייד.' },
  { chapter: 'portal', target: { text: 'חתימה', within: '.modal', sel: 'label, span, div' }, title: 'חתימה ומקדמה', text: 'חתימה באצבע, ואז מקדמה באשראי, Bit או העברה. ההצעה הופכת להזמנה ב-Priority, והמשרד מקבל התראה.', after: closeModal },
  { chapter: 'portal', target: btn('יש לי שאלה'), optional: true, title: 'שאלה או תקלה', text: 'שאלה נשלחת לצוות, וקריאת שירות נפתחת מכאן עם תמונה של התקלה.' },

  // ---------- תיאום ----------
  { chapter: 'schedule', route: '/calendar', before: asUser('u-admin'), target: btn('חודש'), action: 'press', title: 'לוח זמנים', text: 'כל הצוות ביומן אחד. שבתות וחגים חסומים, וביום שישי מופיעה שעת הסיום לפני כניסת השבת.' },
  { chapter: 'schedule', target: btn('שבוע'), action: 'press', title: 'תצוגה שבועית', text: 'לפי שעות, עם חפיפות, קו "עכשיו" והיעדרויות של עובדים.' },
  { chapter: 'schedule', target: btn('יום'), action: 'press', optional: true, title: 'תצוגת יום', text: 'כל העבודות של היום, לפי עובד.' },
  { chapter: 'schedule', route: '/cases/k2', target: btn('שיבוץ'), action: 'click', title: 'שיבוץ התקנה', text: 'משבצים ישר מהתיק.' },
  { chapter: 'schedule', target: { text: 'מועדים פנויים', within: '.modal', sel: 'h3, b, div, .card-head', closest: '.card' }, optional: true, title: 'מועדים פנויים', text: 'המערכת מציעה את המועדים הקרובים לפי שעות העבודה, הצוות, חופשות, שבת וחג.' },
  { chapter: 'schedule', target: '.modal .pick-list', optional: true, title: 'מי פנוי', text: 'רואים מי פנוי ומי עסוק באותה שעה. מתקין בחופשה לא זמין, ומתקין שתעודת העבודה בגובה שלו פגה מסומן.', after: closeModal },

  // ---------- שטח ----------
  { chapter: 'field', route: '/field', before: asUser('u-inst1'), target: { text: 'היום', sel: '.content h2', closest: '.card', exact: true }, optional: true, title: 'היום של המתקין', text: 'המתקין נכנס ישר לעבודות של היום, לפי סדר, עם ניווט, חיוג ווואטסאפ ללקוח.' },
  { chapter: 'field', target: [btn('יצאתי לדרך'), btn('התחלתי לעבוד'), btn('לסיום ומסירה')], optional: true, title: 'כפתור אחד לכל העבודה', text: '"יצאתי לדרך" שולח ללקוח הודעה עם שעת הגעה, "התחלתי לעבוד" מעדכן את המשרד, ו"סיום ומסירה" סוגר את העבודה.' },
  { chapter: 'field', target: card('מלאי ברכב'), optional: true, title: 'מה חסר ברכב', text: 'השוואה בין הציוד שצריך להתקנות של היום למלאי שיש ברכב.' },
  { chapter: 'field', route: '/field/ap1', target: card('צ׳קליסט'), optional: true, title: 'צ׳קליסט', text: 'שלבי העבודה בשטח, כדי ששום דבר לא יישכח.' },
  { chapter: 'field', target: card('תמונות'), optional: true, title: 'תמונות לפני ואחרי', text: 'ישר מהמצלמה, נשמרות בתיק.' },
  { chapter: 'field', target: card('חלקים'), optional: true, title: 'חלקים מהרכב', text: 'מה שנצרך בעבודה יורד מהמלאי ברכב.' },
  { chapter: 'field', target: card('סיום ומסירה'), optional: true, title: 'סיום ומסירה', text: 'מספרים סידוריים, חתימת הלקוח באצבע, ואחריות שנרשמת לכל יחידה. הלקוח מקבל הודעת סיום ובקשה לביקורת בגוגל.' },

  // ---------- שירות ----------
  { chapter: 'service', route: '/service', before: asUser('u-admin'), target: '.content .stat-row, .content .page-head', title: 'קריאות שירות', text: 'דחיפות, טכנאי, זמן תגובה ממוצע ומה ממתין לחלק.' },
  { chapter: 'service', route: '/service/sc1', target: card('היחידה'), optional: true, title: 'אחריות אוטומטית', text: 'המערכת יודעת לבד אם המזגן באחריות, לפי תאריך ההתקנה והמספר הסידורי, ואם יש חוזה שירות.' },
  { chapter: 'service', route: '/contracts', target: { text: 'שחרור עשן', sel: '.content b, .content h2, .content h3, .content strong', closest: 'div' }, optional: true, title: 'חוזים ותחזוקה', text: 'חוזי שירות, ביקורים קרובים וחידושים. מערכת שחרור עשן צריכה אישור שנתי לכבאות, והמערכת מזכירה מראש.' },

  // ---------- בנייה רוויה ----------
  { chapter: 'projects', route: '/projects/p1', target: card('דירות'), title: 'פרויקט של יזם', text: 'כל הדירות לפי קומות, תוכנית בסיס, ושדרוגים שהדיירים מאשרים ומשלמים ישירות.' },

  // ---------- מלאי וספקים ----------
  { chapter: 'stock', route: '/inventory', target: '.content .page-head', title: 'מלאי', text: 'מחסן ורכבי המתקינים, התראה כשחסר, העברות בלחיצה והצעת הזמנה מספק.' },
  { chapter: 'stock', route: '/suppliers', target: '.content .page-head', title: 'ספקים', text: 'אנשי קשר, תנאי תשלום, הזמנות רכש, הוצאות לפי תיק ומסמכים. הזמנה שמתקבלת נכנסת למלאי ולתקציב התיק.' },

  // ---------- צוות ----------
  { chapter: 'team', route: '/tasks', target: '.content .page-head', title: 'משימות', text: 'שלי, ששותפו איתי ושיצרתי. משתפים משימה עם עובד, ותזכורת בלחיצה: בעוד שעה, היום ב-16:00 או מחר בבוקר.' },
  { chapter: 'team', route: '/leave', target: '.content .page-head', title: 'אישורי חופשה', text: 'עובד מבקש, מנהל מאשר. מי שבחופשה לא יופיע כפנוי בשיבוץ.' },
  { chapter: 'team', target: '.cw-fab', optional: true, action: 'press', title: 'צ׳אט', text: 'שיחות צוות ופניות לקוחות במקום אחד, עם התראה על הודעה חדשה.', after: () => (document.querySelector('.cw-fab') as HTMLElement | null)?.click() },

  // ---------- ניהול ----------
  { chapter: 'manage', route: '/reports', target: '.content .page-head', title: 'דוחות', text: 'הכנסות, תיקים שנפתחו ונסגרו, ביצועי סוכנים, תפוקת מתקינים, לקוחות מובילים וסיבות הפסד. השוואה לתקופה הקודמת, וייצוא ל-PDF ול-Excel.' },
  { chapter: 'manage', target: card('לקוחות מובילים'), optional: true, title: 'לקוחות מובילים', text: 'מי מביא הכי הרבה עבודה.' },
  { chapter: 'manage', route: '/users', target: '.content .page-head', title: 'משתמשים והרשאות', text: 'כל עובד עם תפקיד והרשאות. מתקין רואה את העבודות שלו, סוכן את הלקוחות שלו, הנהלה הכל.' },
  { chapter: 'manage', route: '/settings', target: tab('רשימות'), action: 'press', title: 'הגדרות בלי מתכנת', text: 'סוגי פרויקטים, סטטוסים, תגיות, אמצעי תשלום, כללי עמלות ומספור תיקים. המנהל משנה לבד.' },
  { chapter: 'manage', target: tab('תהליכי עבודה'), action: 'press', title: 'תהליכי עבודה', text: 'תבניות תיקים ושלבי פלואו: מה קורה בכל שלב ומי מקבל איזו משימה.' },

  // ---------- חיבורים ----------
  { chapter: 'integrations', route: '/settings', target: tab('חיבורים'), action: 'press', title: 'חיבורים בלי הגדרה', text: 'וואטסאפ, Waze, יומן גוגל, שבת וחגים, מזג אוויר, הכתבה קולית ו-QR עובדים מהרגע הראשון.' },
  { chapter: 'integrations', route: '/settings/priority', target: '.content .page-head', title: 'Priority', text: 'לקוחות, מחירים והזמנות עוברים ל-Priority בלי הקלדה כפולה. מסך הסנכרון מראה מה ממתין, מה נכשל ולמה.' },

  // ---------- סיום ----------
  { chapter: 'end', route: '/', title: 'מערכת אחת, מהליד ועד השירות', text: 'פתיחת תיק בשטח, הצעה מ-AI, אישור וחתימה של הלקוח, שיבוץ חכם, אפליקציית שטח, שירות ודוחות. הכל מחובר ל-Priority, לוואטסאפ ולגוגל.', read: 8000 },
]

export const steps: Step[] = raw.map((s, i) => ({ ...s, id: `s${i + 1}` }))
