// נתוני הדגמה: ספקים, הזמנות רכש, מנהלי מחלקה בתיקים. מקבל את מסד הנתונים אחרי הבנייה הבסיסית ומשלים אותו במקום.
import type { DB, PurchaseOrder, Supplier } from './types'
import { addDays, ymd } from './format'

const daysAgo = (n: number, h = 10) => {
  const d = addDays(new Date(), -n)
  d.setHours(h, 0, 0, 0)
  return d.toISOString()
}
const day = (n: number) => ymd(addDays(new Date(), n))
const yy = String(new Date().getFullYear()).slice(2)

const suppliers: Supplier[] = [
  {
    id: 'sp1', name: 'אוויר-טק הפצה בע״מ', category: 'units', contactName: 'רונן אלמוג', phone: '0549001122', email: 'orders@airtech-dist.example', website: 'https://airtech-dist.example',
    address: 'המלאכה 14, חולון', vatNum: '514220031', paymentTerms: 'שוטף + 60', rating: 5, active: true, priorityId: 'S10041', createdAt: daysAgo(700),
    notes: 'יבואן יחידות VRF ומיני מרכזי. אספקה למחסן תוך 2–3 ימי עבודה, הזמנה עד 12:00.',
  },
  {
    id: 'sp2', name: 'צנרת הבירה', category: 'materials', contactName: 'שלומי בן חמו', phone: '0526612290', email: 'sales@tzneret-habira.example',
    address: 'האומן 22, תלפיות, ירושלים', vatNum: '512987654', paymentTerms: 'שוטף + 30', rating: 4, active: true, priorityId: 'S10017', createdAt: daysAgo(900),
    notes: 'צנרת נחושת, בידוד, תעלות, משאבות ניקוז ובקרים. איסוף עצמי או משלוח למחרת.',
  },
  {
    id: 'sp3', name: 'מנופי ההר', category: 'crane', contactName: 'אבי סויסה', phone: '0503345566', address: 'אזור התעשייה הר טוב',
    vatNum: '038812457', paymentTerms: 'מזומן / העברה ביום העבודה', rating: 4, active: true, createdAt: daysAgo(500),
    notes: 'מנוף 30 מ׳ ומשאית מנוף. צריך לתאם 48 שעות מראש ולוודא אישור חניה.',
  },
  {
    id: 'sp4', name: 'אורן חשמל והנדסה', category: 'electric', contactName: 'אורן שרעבי', phone: '0528876543', email: 'oren.elec@example.com',
    address: 'בית שמש', vatNum: '029934411', paymentTerms: 'שוטף + 30', rating: 5, active: true, createdAt: daysAgo(420),
    notes: 'קבלן משנה לחשמל: נקודות ייעודיות, הגדלת חיבור ולוחות. חשמלאי מוסמך.',
  },
  {
    id: 'sp5', name: 'ש.מ. בידוד ותעלות', category: 'subcontractor', contactName: 'שמעון מלכה', phone: '0541239870',
    address: 'גבעת שאול, ירושלים', vatNum: '515667788', paymentTerms: 'שוטף + 45', rating: 3, active: true, createdAt: daysAgo(300),
    notes: 'ייצור והתקנת תעלות פח ובידוד לפרויקטים גדולים.',
  },
  {
    id: 'sp6', name: 'הובלות גלעד', category: 'other', contactName: 'גלעד', phone: '0507712345', paymentTerms: 'לפי הובלה', rating: 4, active: false, createdAt: daysAgo(800),
    notes: 'הובלת יחידות גדולות. לא בשימוש מאז שהספק מספק עד המחסן.',
  },
]

export function applyAdminSeed(db: DB): void {
  db.suppliers = suppliers
  const cost = (itemId: string) => db.catalog.find((c) => c.id === itemId)?.cost ?? 0
  const name = (itemId: string) => db.catalog.find((c) => c.id === itemId)?.name ?? itemId
  const unit = (itemId: string) => db.catalog.find((c) => c.id === itemId)?.unit
  const line = (itemId: string, qty: number) => ({ itemId, description: name(itemId), qty, unitCost: cost(itemId), unit: unit(itemId) })

  const orders: PurchaseOrder[] = [
    {
      id: 'po1', number: `PO-${yy}-0001`, supplierId: 'sp1', caseId: 'k3', status: 'received', toLocation: 'מחסן ראשי',
      lines: [line('i-vrf-o', 1), line('i-vrf-i', 7), { description: 'הובלה ופריקה במנוף לאתר', qty: 1, unitCost: 3968 }],
      expectedAt: day(-15), createdAt: daysAgo(18), sentAt: daysAgo(18, 12), confirmedAt: daysAgo(17), receivedAt: daysAgo(14), createdBy: 'u-office', sentVia: 'email', moneyLineId: 'mn3',
      notes: 'פנטהאוז עמק רפאים. לתאם פריקה עם סאמר.',
    },
    {
      id: 'po2', number: `PO-${yy}-0002`, supplierId: 'sp3', caseId: 'k3', status: 'confirmed',
      lines: [{ description: 'מנוף 30 מ׳ — חצי יום, הרמת יחידה חיצונית לגג', qty: 1, unitCost: 1200 }],
      expectedAt: day(3), createdAt: daysAgo(4), sentAt: daysAgo(4, 11), confirmedAt: daysAgo(3), createdBy: 'u-office', sentVia: 'whatsapp', notes: 'עמק רפאים 41. אישור חניה מהעירייה בטיפול.',
    },
    {
      id: 'po3', number: `PO-${yy}-0003`, supplierId: 'sp2', status: 'sent', toLocation: 'מחסן ראשי',
      lines: [line('l-pipe', 200), line('l-wifi', 12), line('l-pump', 6)],
      expectedAt: day(2), createdAt: daysAgo(1), sentAt: daysAgo(1, 14), createdBy: 'u-office', sentVia: 'whatsapp',
    },
    {
      id: 'po4', number: `PO-${yy}-0004`, supplierId: 'sp1', status: 'draft', toLocation: 'מחסן ראשי',
      lines: [line('i-w15', 8), line('i-w25', 3), line('i-m4', 2)],
      createdAt: daysAgo(0, 8), createdBy: 'u-office', notes: 'השלמת מלאי לפני הקיץ',
    },
  ]
  db.purchaseOrders = orders
  db.counters = { ...db.counters, po: orders.length }

  // הוצאות קיימות בתיק k3 מקושרות לספקים; קטגוריות וסוגי סעיפים לפי הרשימות בהגדרות
  db.money = db.money.map((m) => {
    if (m.id === 'mn1') return { ...m, budgetType: 'equipment' }
    if (m.id === 'mn2') return { ...m, budgetType: 'labor' }
    if (m.id === 'mn3') return { ...m, category: 'equipment', supplierId: 'sp1', purchaseOrderId: 'po1', method: 'transfer' }
    if (m.id === 'mn4') return { ...m, category: 'crane', supplierId: 'sp3', method: 'transfer' }
    if (m.id === 'mn5') return { ...m, method: 'transfer' }
    if (m.id === 'mn6') return { ...m, method: 'transfer' }
    if (m.id === 'mn7') return { ...m, agentId: 'u-agent2', status: 'pending' }
    return m
  })
  if (!db.money.some((m) => m.id === 'mn8')) {
    db.money.push({ id: 'mn8', caseId: 'k3', kind: 'expense', category: 'subcontractor', description: 'נקודות חשמל ייעודיות ליחידות', amount: 1650, at: day(-6), supplierId: 'sp4', method: 'transfer' })
  }

  // צוות מורחב: מנהלי מחלקה ומנהל פרויקט, ואופן יצירת הקשר
  db.cases = db.cases.map((k) => {
    if (k.id === 'k3') return { ...k, departmentManagerIds: ['u-office', 'u-eng'], projectManagerId: 'u-inst1', contactMethod: 'referral' }
    if (k.id === 'k5') return { ...k, departmentManagerIds: ['u-office'], projectManagerId: 'u-eng', contactMethod: 'phone' }
    if (k.id === 'k1') return { ...k, contactMethod: 'phone' }
    if (k.id === 'k6') return { ...k, contactMethod: 'website' }
    if (k.id === 'k9') return { ...k, contactMethod: 'whatsapp' }
    return k
  })
  // איש קשר שנוצר מתוך תיק
  db.contacts = db.contacts.map((c) => (c.id === 'ct4b' ? { ...c, fromCaseId: 'k3' } : c))
}
