// נתוני הדגמה. הלקוחות, האנשים והמחירים בדויים; הם בנויים סביב תחומי הפעילות של החברה.
import { defaultConfig } from './configDefaults'
import { applyPlatformSeed } from './seedPlatform'
import { applyCollabSeed } from './seedCollab'
import { applyAdminSeed } from './seedAdmin'
import { applyHistorySeed } from './seedHistory'
import type {
  Activity,
  Apartment,
  Appointment,
  BuildingProject,
  Case,
  CatalogItem,
  Contact,
  Contract,
  Customer,
  DB,
  Doc,
  InstalledUnit,
  Message,
  MoneyLine,
  Notification,
  Photo,
  Quote,
  QuoteLine,
  ServiceCall,
  StockEntry,
  Task,
  User,
} from './types'
import { addDays, atTime, ymd } from './format'
import { defaultTerms } from './quote'
import { brand } from '../brand'

const synced = (priorityId: string, hoursAgo = 3) => ({
  status: 'synced' as const,
  priorityId,
  lastSync: new Date(Date.now() - hoursAgo * 3600_000).toISOString(),
})

// יום עבודה n ימים מהיום: מדלג על שבת (ושישי לפגישות שאינן קצרות)
function workday(n: number, allowFriday = false): Date {
  let d = addDays(new Date(), n)
  while (d.getDay() === 6 || (!allowFriday && d.getDay() === 5)) d = addDays(d, n >= 0 ? 1 : -1)
  return d
}
const at = (n: number, hhmm: string, allowFriday = false) => atTime(workday(n, allowFriday), hhmm).toISOString()
function ago(days: number, hhmm = '10:00') {
  const t = atTime(addDays(new Date(), -days), hhmm)
  if (t.getTime() <= Date.now()) return t.toISOString()
  const [h, m] = hhmm.split(':').map(Number)
  return new Date(Date.now() - (1440 - h * 60 - m) * 6000).toISOString()
}
const dayStr = (n: number) => ymd(workday(n))

function svgData(svg: string) {
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)
}

function sketch(label: string, kind: 'unit' | 'panel' | 'wall' | 'outdoor'): string {
  const shapes = {
    unit: '<rect x="60" y="70" width="280" height="80" rx="14" fill="#f1f5f9" stroke="#94a3b8" stroke-width="3"/><rect x="80" y="125" width="240" height="8" rx="4" fill="#cbd5e1"/><circle cx="310" cy="95" r="6" fill="#22c55e"/>',
    panel: '<rect x="120" y="40" width="160" height="180" rx="8" fill="#e2e8f0" stroke="#64748b" stroke-width="3"/><g fill="#475569">' +
      Array.from({ length: 6 }, (_, i) => `<rect x="${140 + (i % 3) * 42}" y="${70 + Math.floor(i / 3) * 60}" width="30" height="40" rx="3"/>`).join('') + '</g>',
    wall: '<rect x="20" y="20" width="360" height="220" fill="#f8fafc" stroke="#cbd5e1" stroke-width="3"/><rect x="230" y="60" width="110" height="140" fill="#bae6fd" stroke="#64748b" stroke-width="3"/><rect x="60" y="60" width="120" height="40" rx="8" fill="#e2e8f0" stroke="#94a3b8" stroke-width="2" stroke-dasharray="6 5"/>',
    outdoor: '<rect x="90" y="60" width="220" height="150" rx="10" fill="#e2e8f0" stroke="#64748b" stroke-width="3"/><circle cx="170" cy="135" r="52" fill="none" stroke="#64748b" stroke-width="4"/><path d="M170 85v100M120 135h100" stroke="#94a3b8" stroke-width="3"/>',
  }
  return svgData(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 260"><rect width="400" height="260" fill="#ffffff"/>${shapes[kind]}<text x="200" y="248" text-anchor="middle" font-family="Arial" font-size="16" fill="#334155">${label}</text></svg>`,
  )
}

const signatureSvg = (seed: number) =>
  svgData(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 90"><path d="M20 ${60 - seed} C 50 10, 70 80, 95 45 S 140 20, 160 55 S 210 75, 230 35 S 270 40, 285 ${50 + seed}" fill="none" stroke="#1c2127" stroke-width="3" stroke-linecap="round"/></svg>`,
  )

const users: User[] = [
  { id: 'u-admin', name: 'דוד מזרחי', role: 'admin', title: 'מנכ״ל', phone: '0502201100', email: `david@${brand.domain}`, color: '#0f766e', active: true },
  { id: 'u-office', name: 'משה כהן', role: 'office', title: 'מנהל תפעול ותיאום', phone: '0502201101', email: `office@${brand.domain}`, color: '#0ea5e9', active: true },
  { id: 'u-agent1', name: 'אבי לוי', role: 'agent', title: 'יועץ מכירות — פרטיים', phone: '0502201102', region: 'ירושלים', color: '#00aeef', active: true },
  { id: 'u-agent2', name: 'יוסי פרץ', role: 'agent', title: 'יועץ מכירות — פרויקטים ומוסדות', phone: '0502201103', region: 'ירושלים ובית שמש', color: '#6366f1', active: true },
  { id: 'u-eng', name: 'אלי שטרן', role: 'engineer', title: 'מהנדס מיזוג ראשי', phone: '0502201104', email: `eng@${brand.domain}`, color: '#8b5cf6', active: true },
  {
    id: 'u-inst1', name: 'סאמר חלבי', role: 'installer', title: 'ראש צוות התקנות', phone: '0502201105', region: 'ירושלים', color: '#16a34a',
    skills: ['VRF', 'מיני מרכזי', 'עבודה בגובה'], certifications: [{ type: 'עבודה בגובה', expires: dayStr(140) }, { type: 'גזי קירור', expires: dayStr(420) }], active: true,
  },
  {
    id: 'u-inst2', name: 'יעקב דהן', role: 'installer', title: 'מתקין', phone: '0502201106', region: 'בית שמש', color: '#f59e0b',
    skills: ['מזגנים עיליים', 'מיני מרכזי'], certifications: [{ type: 'עבודה בגובה', expires: dayStr(12) }], active: true,
  },
  {
    id: 'u-tech', name: 'נתן גבאי', role: 'installer', title: 'טכנאי שירות', phone: '0502201107', region: 'ירושלים', color: '#f97316',
    skills: ['שירות', 'שחרור עשן', 'חימום'], certifications: [{ type: 'חשמל', expires: dayStr(300) }, { type: 'גזי קירור', expires: dayStr(200) }], active: true,
  },
]

const addr = (id: string, city: string, street: string, number: string, extra: Partial<{ floor: string; apartment: string; entryNotes: string; label: string }> = {}) => ({
  id, city, street, number, ...extra,
})

const customers: Customer[] = [
  { id: 'c1', name: 'משפחת גולדברג', type: 'private', phone: '0523456781', email: 'goldberg.family@example.com', addresses: [addr('ad1', 'ירושלים', 'אבן עזרא', '12', { floor: '3', apartment: '7', entryNotes: 'קוד בניין 1948#' })], sync: synced('C10023'), createdAt: ago(420), tags: ['לקוח חוזר'] },
  { id: 'c2', name: 'יעקב ברגר', type: 'private', phone: '0548812234', addresses: [addr('ad2', 'ירושלים', 'קצנלבוגן', '40', { floor: '5' })], sync: synced('C10088'), createdAt: ago(30) },
  { id: 'c3', name: 'משפחת אוחיון', type: 'private', phone: '0506612398', email: 'ohayon@example.com', addresses: [addr('ad3', 'בית שמש', 'נחל שורק', '18', { label: 'וילה' })], sync: synced('C10102'), createdAt: ago(45) },
  { id: 'c4', name: 'שמואל רוזנטל', type: 'private', phone: '0527001144', email: 'rosenthal@example.com', addresses: [addr('ad4', 'ירושלים', 'עמק רפאים', '41', { floor: '6', label: 'פנטהאוז' })], sync: synced('C10109'), createdAt: ago(38), tags: ['VIP'] },
  { id: 'c5', name: 'מלון נוף ההרים', type: 'business', phone: '026543210', email: 'maintenance@nofheharim.example', idNumber: '515123456', addresses: [addr('ad5', 'ירושלים', 'שדרות הרצל', '88')], sync: synced('C10011', 20), createdAt: ago(900) },
  { id: 'c6', name: 'דיור מוגן נווה השקד', type: 'institution', phone: '026789900', email: 'office@nevehashaked.example', idNumber: '580112233', addresses: [addr('ad6', 'ירושלים', 'גולומב', '52')], sync: { status: 'error', error: 'Priority: חסר ח.פ בכרטיס הלקוח', lastSync: ago(1), attempts: 3 }, createdAt: ago(600) },
  { id: 'c7', name: 'מרפאת שיניים ד״ר אלון', type: 'business', phone: '0544019911', addresses: [addr('ad7', 'מבשרת ציון', 'הקסטל', '3')], sync: { status: 'pending' }, createdAt: ago(0, '09:12') },
  { id: 'c8', name: 'אפיק יזמות ובנייה בע״מ', type: 'developer', phone: '0732220000', email: 'projects@afik.example', idNumber: '514998877', addresses: [addr('ad8', 'בית שמש', 'רמת בית שמש — מתחם הרכס', '1')], sync: synced('C10140'), createdAt: ago(200) },
  { id: 'c9', name: 'מרכז חינוכי גבעת המבתר', type: 'institution', phone: '025824400', addresses: [addr('ad9', 'ירושלים', 'שמואל הנביא', '120')], sync: synced('C10077'), createdAt: ago(90) },
  { id: 'c10', name: 'משפחת שפירא', type: 'private', phone: '0583317720', addresses: [addr('ad10', 'מבשרת ציון', 'החוצבים', '7')], temp: true, sync: { status: 'not_synced' }, createdAt: ago(0, '08:40') },
  { id: 'c11', name: 'מקווה טהרה — שכונת רמות', type: 'institution', phone: '025861122', addresses: [addr('ad11', 'ירושלים', 'סולם יעקב', '9')], sync: synced('C10131'), createdAt: ago(25) },
  { id: 'c12', name: 'מרכז מסחרי גבעת שאול', type: 'business', phone: '026512233', email: 'binuy@givatshaul-center.example', idNumber: '512340987', addresses: [addr('ad12', 'ירושלים', 'כנפי נשרים', '15')], sync: synced('C10009', 30), createdAt: ago(1100) },
]

const contacts: Contact[] = [
  { id: 'ct1', customerId: 'c1', name: 'אהרון גולדברג', phone: '0523456781', primary: true },
  { id: 'ct2', customerId: 'c2', name: 'יעקב ברגר', phone: '0548812234', primary: true },
  { id: 'ct3', customerId: 'c3', name: 'רפאל אוחיון', phone: '0506612398', primary: true },
  { id: 'ct4', customerId: 'c4', name: 'שמואל רוזנטל', phone: '0527001144', primary: true },
  { id: 'ct4b', customerId: 'c4', name: 'אדריכל עמית ברק', role: 'אדריכל', phone: '0547003355' },
  { id: 'ct5', customerId: 'c5', name: 'גיל אברמוב', role: 'מנהל אחזקה', phone: '0545120099', primary: true },
  { id: 'ct6', customerId: 'c6', name: 'יהודה פרידמן', role: 'מנהל אדמיניסטרטיבי', phone: '0527788990', primary: true },
  { id: 'ct7', customerId: 'c7', name: 'ד״ר עידו אלון', phone: '0544019911', primary: true },
  { id: 'ct8', customerId: 'c8', name: 'אלעד ששון', role: 'מנהל פרויקט', phone: '0503321122', primary: true },
  { id: 'ct9', customerId: 'c9', name: 'הרב מנחם וייס', role: 'מנהל', phone: '0527654321', primary: true },
  { id: 'ct10', customerId: 'c10', name: 'בנימין שפירא', phone: '0583317720', primary: true },
  { id: 'ct11', customerId: 'c11', name: 'ישראל קליין', role: 'גבאי', phone: '0533109988', primary: true },
  { id: 'ct12', customerId: 'c12', name: 'אורן מימון', role: 'מנהל המבנה', phone: '0546601234', primary: true },
]

const item = (id: string, sku: string, name: string, category: CatalogItem['category'], unit: string, price: number, extra: Partial<CatalogItem> = {}): CatalogItem => ({
  id, sku, name, category, unit, price, cost: Math.round(price * (category === 'labor' || category === 'service' ? 0.45 : 0.68)), sync: synced(sku, 6), active: true, ...extra,
})

const catalog: CatalogItem[] = [
  item('i-w1', 'AC-W09', 'מזגן עילי 1 כ״ס Inverter (9,000 BTU)', 'unit', 'יח׳', 2890, { btu: 9000, hp: 1, warrantyMonths: 36 }),
  item('i-w15', 'AC-W12', 'מזגן עילי 1.5 כ״ס Inverter (12,000 BTU)', 'unit', 'יח׳', 3390, { btu: 12000, hp: 1.5, warrantyMonths: 36 }),
  item('i-w2', 'AC-W18', 'מזגן עילי 2 כ״ס Inverter (18,000 BTU)', 'unit', 'יח׳', 4690, { btu: 18000, hp: 2, warrantyMonths: 36 }),
  item('i-w25', 'AC-W24', 'מזגן עילי 2.5 כ״ס Inverter (24,000 BTU)', 'unit', 'יח׳', 5990, { btu: 24000, hp: 2.5, warrantyMonths: 36 }),
  item('i-m3', 'AC-M30', 'מיני מרכזי 3 כ״ס Inverter (30,000 BTU)', 'unit', 'יח׳', 9800, { btu: 30000, hp: 3, warrantyMonths: 60 }),
  item('i-m4', 'AC-M40', 'מיני מרכזי 4 כ״ס Inverter (40,000 BTU)', 'unit', 'יח׳', 12400, { btu: 40000, hp: 4, warrantyMonths: 60 }),
  item('i-m5', 'AC-M48', 'מיני מרכזי 5 כ״ס Inverter (48,000 BTU)', 'unit', 'יח׳', 14900, { btu: 48000, hp: 5, warrantyMonths: 60 }),
  item('i-vrf-o', 'VRF-OD10', 'מערכת VRF — יחידה חיצונית 10 כ״ס', 'unit', 'יח׳', 38000, { hp: 10, warrantyMonths: 60 }),
  item('i-vrf-i', 'VRF-ID2', 'VRF — יחידה פנימית סמויה 2 כ״ס', 'unit', 'יח׳', 4200, { hp: 2, warrantyMonths: 60 }),
  item('i-hp', 'HT-HP12', 'משאבת חום לחימום תת-רצפתי 12kW', 'heating', 'יח׳', 21500, { warrantyMonths: 60 }),
  item('i-ufh', 'HT-UFH', 'צנרת חימום תת-רצפתי כולל מחלק (למ״ר)', 'heating', 'מ״ר', 185),
  item('i-fan', 'SM-FAN', 'מפוח שחרור עשן כולל בקר', 'ventilation', 'יח׳', 6800, { warrantyMonths: 24 }),
  item('l-inst', 'LB-INST', 'התקנה סטנדרטית מזגן עילי (עד 3 מ׳ צנרת)', 'labor', 'יח׳', 650),
  item('l-instm', 'LB-INSTM', 'התקנת מיני מרכזי כולל תעלות ופתחים', 'labor', 'יח׳', 3200),
  item('l-pipe', 'MT-PIPE', 'תוספת צנרת נחושת מבודדת', 'material', 'מ״א', 140),
  item('l-height', 'LB-HEIGHT', 'עבודה בגובה / סנפלינג', 'labor', 'יח׳', 900),
  item('l-crane', 'LB-CRANE', 'מנוף (חצי יום)', 'labor', 'יח׳', 1600),
  item('l-prep', 'LB-PREP', 'הכנה למזגן — צנרת סמויה לנקודה', 'labor', 'נק׳', 850),
  item('l-remove', 'LB-REMOVE', 'פירוק מזגן ישן ופינוי', 'labor', 'יח׳', 350),
  item('l-elec', 'LB-ELEC', 'נקודת חשמל ייעודית למזגן', 'labor', 'נק׳', 450),
  item('l-pump', 'AC-PUMP', 'משאבת ניקוז', 'accessory', 'יח׳', 380),
  item('l-wifi', 'AC-WIFI', 'בקר חכם Wi-Fi', 'accessory', 'יח׳', 420),
  item('s-annual', 'SV-ANNUAL', 'טיפול תקופתי — ניקוי ובדיקה ליחידה', 'service', 'יח׳', 290),
  item('s-visit', 'SV-VISIT', 'ביקור טכנאי (קריאת שירות)', 'service', 'ביקור', 290),
  item('s-gas', 'SV-GAS', 'מילוי גז קירור', 'service', 'יח׳', 450),
  item('s-smoke', 'SV-SMOKE', 'בדיקה שנתית למערכת שחרור עשן כולל אישור', 'service', 'מערכת', 1450),
]

const price = (id: string) => catalog.find((c) => c.id === id)!.price
const unitOf = (id: string) => catalog.find((c) => c.id === id)!.unit
const nameOf = (id: string) => catalog.find((c) => c.id === id)!.name
let lineSeq = 0
const L = (itemId: string, qty: number, room?: string, aiReason?: string): QuoteLine => ({
  id: `ln${++lineSeq}`, itemId, description: nameOf(itemId), qty, unit: unitOf(itemId), unitPrice: price(itemId), room, aiReason,
})

const photos = (prefix: string, list: [string, Photo['tag'], 'unit' | 'panel' | 'wall' | 'outdoor'][], days: number): Photo[] =>
  list.map(([caption, tag, kind], i) => ({ id: `${prefix}p${i}`, dataUrl: sketch(caption, kind), caption, tag, takenAt: ago(days, '11:00') }))

const emptySurvey = { rooms: [], photos: [] }

function mkCase(c: Partial<Case> & Pick<Case, 'id' | 'number' | 'title' | 'customerId' | 'addressId' | 'projectType' | 'stage' | 'createdAt'>): Case {
  return {
    contactIds: [],
    source: 'phone',
    installerIds: [],
    priority: 'normal',
    tags: [],
    survey: emptySurvey,
    portal: { token: `pt-${c.id}`, enabled: true },
    updatedAt: c.createdAt,
    ...c,
  }
}

const cases: Case[] = [
  mkCase({
    id: 'k1', number: 'GN-260138', title: 'מיזוג דירה — גולדברג, רחביה', customerId: 'c1', contactIds: ['ct1'], addressId: 'ad1', projectType: 'apartment', stage: 'quote', source: 'returning', agentId: 'u-agent1', createdAt: ago(6),
    survey: {
      rooms: [
        { id: 'r1', name: 'סלון ופינת אוכל', areaSqm: 34, ceilingM: 2.7, sunExposure: 'high', floor: 3 },
        { id: 'r2', name: 'חדר הורים', areaSqm: 14, sunExposure: 'medium', floor: 3 },
        { id: 'r3', name: 'חדר ילדים', areaSqm: 11, sunExposure: 'low', floor: 3 },
        { id: 'r4', name: 'חדר ילדים 2', areaSqm: 10, sunExposure: 'low', floor: 3 },
      ],
      pipeLengthM: 18, workAtHeight: false, electricalReady: false, existingUnitsToRemove: 1,
      voiceNotes: 'הלקוח רוצה שקט בחדרי השינה. יחידה חיצונית אפשר לשים במרפסת השירות. יש מזגן ישן בסלון לפירוק.',
      photos: photos('k1', [['מזגן קיים בסלון', 'existing_unit', 'unit'], ['קיר סלון — מיקום מוצע', 'wall', 'wall'], ['לוח חשמל', 'electric_panel', 'panel'], ['מרפסת שירות', 'outdoor', 'outdoor']], 5),
      doneAt: ago(5, '11:30'), doneBy: 'u-agent1',
    },
    updatedAt: ago(1),
  }),
  mkCase({ id: 'k2', number: 'GN-260133', title: 'החלפת 2 מזגנים — ברגר, הר נוף', customerId: 'c2', contactIds: ['ct2'], addressId: 'ad2', projectType: 'replacement', stage: 'approved', source: 'phone', agentId: 'u-agent1', createdAt: ago(12), updatedAt: ago(1) }),
  mkCase({
    id: 'k3', number: 'GN-260127', title: 'פנטהאוז עמק רפאים — מערכת VRF', customerId: 'c4', contactIds: ['ct4', 'ct4b'], addressId: 'ad4', projectType: 'luxury', stage: 'scheduled', source: 'referral', agentId: 'u-agent2', engineerId: 'u-eng', installerIds: ['u-inst1', 'u-inst2'], priority: 'high', tags: ['VIP', 'VRF'],
    installWindow: { from: dayStr(3), to: dayStr(4) }, createdAt: ago(38), updatedAt: ago(3),
  }),
  mkCase({ id: 'k4', number: 'GN-260129', title: 'וילה בבית שמש — 2 מיני מרכזיים', customerId: 'c3', contactIds: ['ct3'], addressId: 'ad3', projectType: 'luxury', stage: 'installing', source: 'website', agentId: 'u-agent1', engineerId: 'u-eng', installerIds: ['u-inst1', 'u-inst2'], installWindow: { from: dayStr(0), to: dayStr(0) }, createdAt: ago(30), updatedAt: ago(0, '08:00') }),
  mkCase({ id: 'k5', number: 'GN-260135', title: 'דיור מוגן נווה השקד — החלפת מערכת אגף ב׳', customerId: 'c6', contactIds: ['ct6'], addressId: 'ad6', projectType: 'institution', stage: 'survey', source: 'returning', agentId: 'u-agent2', engineerId: 'u-eng', priority: 'high', createdAt: ago(9), updatedAt: ago(2) }),
  mkCase({ id: 'k6', number: 'GN-260141', title: 'מרפאת שיניים — מיני מרכזי לקומת טיפולים', customerId: 'c7', contactIds: ['ct7'], addressId: 'ad7', projectType: 'commercial', stage: 'lead', source: 'website', createdAt: ago(0, '09:12'), notes: 'השאיר פרטים באתר: "צריך מיזוג שקט לחדרי טיפולים, 4 חדרים + המתנה".' }),
  mkCase({
    id: 'k7', number: 'GN-260137', title: 'מקווה רמות — חימום מים ותת-רצפתי', customerId: 'c11', contactIds: ['ct11'], addressId: 'ad11', projectType: 'underfloor_heating', stage: 'quote', source: 'referral', agentId: 'u-agent2', engineerId: 'u-eng', createdAt: ago(7), updatedAt: ago(1),
    survey: { rooms: [{ id: 'r7', name: 'אולם המקווה', areaSqm: 85 }], notes: 'רצפת אבן קיימת, הלקוח מבקש פתרון בלי פירוק מלא.', photos: [], doneAt: ago(4), doneBy: 'u-eng' },
  }),
  mkCase({ id: 'k8', number: 'GN-260139', title: 'נופי הרכס — בניין A, דירה 12 (שינוי דייר)', customerId: 'c8', contactIds: ['ct8'], addressId: 'ad8', projectType: 'residential_building', stage: 'quote', source: 'other', agentId: 'u-agent2', buildingProjectId: 'p1', apartmentId: 'ap-A-12', createdAt: ago(4), updatedAt: ago(2) }),
  mkCase({ id: 'k9', number: 'GN-260142', title: 'משפחת שפירא — מיזוג לבית חדש', customerId: 'c10', contactIds: ['ct10'], addressId: 'ad10', projectType: 'apartment', stage: 'lead', source: 'whatsapp', createdAt: ago(0, '08:40'), notes: 'פנה בוואטסאפ: "עברנו דירה, צריכים 4 מזגנים. מתי אפשר לבוא לראות?"' }),
  mkCase({ id: 'k10', number: 'GN-260118', title: 'מלון נוף ההרים — חדרי אירוח קומה 3', customerId: 'c5', contactIds: ['ct5'], addressId: 'ad5', projectType: 'commercial', stage: 'completed', source: 'returning', agentId: 'u-agent2', installerIds: ['u-inst1'], createdAt: ago(48), updatedAt: ago(6) }),
  mkCase({ id: 'k11', number: 'GN-250412', title: 'גולדברג — חדר עבודה', customerId: 'c1', contactIds: ['ct1'], addressId: 'ad1', projectType: 'apartment', stage: 'closed', source: 'phone', agentId: 'u-agent1', installerIds: ['u-inst2'], createdAt: ago(410), updatedAt: ago(395), closedAt: ago(395) }),
  mkCase({ id: 'k12', number: 'GN-260109', title: 'מרכז חינוכי — מיזוג 6 כיתות', customerId: 'c9', contactIds: ['ct9'], addressId: 'ad9', projectType: 'institution', stage: 'lost', source: 'phone', agentId: 'u-agent2', createdAt: ago(70), updatedAt: ago(40), lostReason: 'בחרו הצעה זולה יותר של מתחרה' }),
  mkCase({ id: 'k13', number: 'GN-240207', title: 'מרכז מסחרי — מערכת שחרור עשן', customerId: 'c12', contactIds: ['ct12'], addressId: 'ad12', projectType: 'smoke_ventilation', stage: 'closed', source: 'other', agentId: 'u-agent2', engineerId: 'u-eng', createdAt: ago(760), updatedAt: ago(700), closedAt: ago(700) }),
]

function mkQuote(q: Partial<Quote> & Pick<Quote, 'id' | 'caseId' | 'number' | 'lines' | 'status' | 'createdAt'>): Quote {
  return {
    version: 1, discountPct: 0, vatPct: 18, validUntil: ymd(addDays(new Date(q.createdAt), 14)), terms: defaultTerms, sync: { status: 'not_synced' }, ...q,
  }
}

const quotes: Quote[] = [
  mkQuote({
    id: 'q1', caseId: 'k1', number: 'Q-26-0091', status: 'viewed', createdAt: ago(3), sentAt: ago(2, '12:10'), viewedAt: ago(1, '20:41'), createdBy: 'u-agent1', discountPct: 5,
    lines: [
      L('i-w25', 1, 'סלון ופינת אוכל', '34 מ״ר עם חשיפה גבוהה לשמש: נדרשים כ-24,000 BTU'),
      L('i-w15', 1, 'חדר הורים', '14 מ״ר, חשיפה בינונית'),
      L('i-w1', 2, 'חדרי ילדים', 'חדרים קטנים בצד הצפוני'),
      L('l-inst', 4), L('l-pipe', 18, undefined, 'לפי המדידה בסקר: 18 מ׳ צנרת מעבר לבסיס'), L('l-elec', 2, undefined, 'בלוח רואים מקום לשני מפסקים בלבד'),
      L('l-remove', 1, 'סלון', 'מזגן ישן בסלון לפירוק'), L('l-wifi', 1, 'סלון'),
    ],
    ai: {
      source: 'claude', model: 'claude-opus-5-5', confidence: 'medium', createdAt: ago(3, '09:20'),
      summary: 'דירת 4 חדרים בקומה 3. מזגן ישן בסלון לפירוק, לוח חשמל עם מקום מוגבל, יחידות חיצוניות במרפסת השירות.',
      assumptions: ['גובה תקרה סטנדרטי (2.7 מ׳) בכל החדרים', 'מרפסת השירות מאפשרת התקנה בלי עבודה בגובה'],
      questions: ['האם יש קיר משותף לשכן במיקום היחידות החיצוניות?', 'האם הלקוח מעדיף מיני מרכזי במקום 4 עיליים?'],
    },
  }),
  mkQuote({
    id: 'q2', caseId: 'k2', number: 'Q-26-0086', status: 'approved', createdAt: ago(10), sentAt: ago(9), viewedAt: ago(8), decidedAt: ago(2, '19:05'), createdBy: 'u-agent1',
    lines: [L('i-w15', 2, 'חדרי שינה'), L('l-inst', 2), L('l-remove', 2), L('l-pipe', 4)],
    signature: { name: 'יעקב ברגר', dataUrl: signatureSvg(6), at: ago(2, '19:05') },
    deposit: { amount: 1700, paidAt: ago(2, '19:07'), method: 'credit' }, sync: synced('PQ26000412', 40),
  }),
  mkQuote({
    id: 'q3', caseId: 'k3', number: 'Q-26-0071', status: 'approved', createdAt: ago(30), sentAt: ago(29), viewedAt: ago(29), decidedAt: ago(20), createdBy: 'u-agent2', discountPct: 4,
    lines: [L('i-vrf-o', 1, 'גג'), L('i-vrf-i', 7, 'כל החדרים'), L('l-instm', 7), L('l-pipe', 60), L('l-crane', 1), L('l-height', 1), L('l-wifi', 7), L('l-elec', 2)],
    signature: { name: 'שמואל רוזנטל', dataUrl: signatureSvg(10), at: ago(20) }, deposit: { amount: 26000, paidAt: ago(19), method: 'transfer' }, sync: synced('PQ26000377', 400),
  }),
  mkQuote({
    id: 'q4', caseId: 'k4', number: 'Q-26-0079', status: 'approved', createdAt: ago(24), sentAt: ago(23), viewedAt: ago(23), decidedAt: ago(18), createdBy: 'u-agent1',
    lines: [L('i-m4', 1, 'קומת קרקע'), L('i-m3', 1, 'קומה עליונה'), L('l-instm', 2), L('l-pipe', 22), L('l-pump', 1), L('l-wifi', 2)],
    signature: { name: 'רפאל אוחיון', dataUrl: signatureSvg(3), at: ago(18) }, deposit: { amount: 6400, paidAt: ago(18), method: 'bit' }, sync: synced('PQ26000390', 300),
  }),
  mkQuote({
    id: 'q5', caseId: 'k7', number: 'Q-26-0093', status: 'draft', createdAt: ago(1), createdBy: 'u-agent2',
    lines: [L('i-hp', 1, 'חדר מכונות', 'אולם 85 מ״ר: משאבת חום 12kW עם רזרבה'), L('i-ufh', 85, 'אולם המקווה'), L('l-elec', 1)],
    ai: {
      source: 'demo', confidence: 'low', createdAt: ago(1, '15:00'), summary: 'טיוטה ראשונית לפי שטח האולם בלבד.',
      assumptions: ['בידוד רצפה סטנדרטי'], questions: ['נדרש חישוב עומסים של המהנדס לפני שליחה', 'האם יש צורך גם בחימום מי הבור?'],
    },
  }),
  mkQuote({
    id: 'q6', caseId: 'k8', number: 'Q-26-0092', status: 'sent', createdAt: ago(2), sentAt: ago(2, '16:30'), createdBy: 'u-agent2',
    lines: [L('i-m4', 1, 'שדרוג מ-3 ל-4 כ״ס'), L('l-prep', 1, 'ממ״ד'), L('i-w1', 1, 'ממ״ד'), L('l-wifi', 1)],
  }),
  mkQuote({
    id: 'q7', caseId: 'k10', number: 'Q-26-0058', status: 'approved', createdAt: ago(46), sentAt: ago(45), viewedAt: ago(45), decidedAt: ago(40), createdBy: 'u-agent2', discountPct: 7,
    lines: [L('i-w15', 6, 'חדרים 301-306'), L('l-inst', 6), L('l-remove', 6), L('l-pipe', 24)],
    signature: { name: 'גיל אברמוב', dataUrl: signatureSvg(8), at: ago(40) }, deposit: { amount: 7000, paidAt: ago(39), method: 'transfer' }, sync: synced('PQ26000301', 900),
  }),
  mkQuote({ id: 'q8', caseId: 'k12', number: 'Q-26-0044', status: 'rejected', createdAt: ago(65), sentAt: ago(64), viewedAt: ago(60), decidedAt: ago(40), createdBy: 'u-agent2', lines: [L('i-w2', 6, 'כיתות'), L('l-inst', 6), L('l-elec', 6)] }),
]

const checklistInstall = (done: number) =>
  ['בדיקת מיקומים מול הלקוח', 'קידוח ומעברי צנרת', 'התקנת יחידות פנימיות', 'התקנת יחידות חיצוניות', 'ואקום ובדיקת לחצים', 'הפעלה ובדיקת ניקוז', 'הדרכת לקוח ותפעול שלט', 'ניקיון האתר'].map(
    (text, i) => ({ id: `cl${i}`, text, done: i < done }),
  )

const appointments: Appointment[] = [
  { id: 'ap1', type: 'installation', title: 'התקנת 2 מיני מרכזיים — וילה אוחיון', caseId: 'k4', customerId: 'c3', addressId: 'ad3', start: at(0, '08:00'), end: at(0, '15:30'), userIds: ['u-inst1', 'u-inst2'], status: 'in_progress', checklist: checklistInstall(4), photosBefore: photos('ap1b', [['תקרה לפני פתיחה', 'before', 'wall']], 0), photosAfter: [] },
  { id: 'ap2', type: 'survey', title: 'סקר הנדסי — אגף ב׳', caseId: 'k5', customerId: 'c6', addressId: 'ad6', start: at(1, '10:00'), end: at(1, '11:30'), userIds: ['u-agent2', 'u-eng'], status: 'confirmed', checklist: [], photosBefore: [], photosAfter: [] },
  { id: 'ap3', type: 'installation', title: 'VRF פנטהאוז — יום 1 (יחידה חיצונית ומנוף)', caseId: 'k3', customerId: 'c4', addressId: 'ad4', start: at(3, '07:30'), end: at(3, '16:00'), userIds: ['u-inst1', 'u-inst2'], status: 'confirmed', checklist: checklistInstall(0), photosBefore: [], photosAfter: [], notes: 'מנוף מוזמן ל-07:30. לתאם חניה מול ועד הבית.' },
  { id: 'ap4', type: 'installation', title: 'VRF פנטהאוז — יום 2 (יחידות פנימיות והפעלה)', caseId: 'k3', customerId: 'c4', addressId: 'ad4', start: at(4, '08:00'), end: at(4, '16:00'), userIds: ['u-inst1', 'u-inst2'], status: 'planned', checklist: checklistInstall(0), photosBefore: [], photosAfter: [] },
  { id: 'ap5', type: 'service', title: 'נזילת מים ממזגן בסלון', serviceCallId: 'sc1', customerId: 'c1', addressId: 'ad1', start: at(0, '16:00'), end: at(0, '17:00'), userIds: ['u-tech'], status: 'planned', checklist: [], photosBefore: [], photosAfter: [] },
  { id: 'ap6', type: 'maintenance', title: 'טיפול חצי-שנתי — 6 מזגנים קומה 3', contractId: 'kt1', customerId: 'c5', addressId: 'ad5', start: at(1, '13:00'), end: at(1, '16:00'), userIds: ['u-tech'], status: 'planned', checklist: [], photosBefore: [], photosAfter: [] },
  { id: 'ap7', type: 'inspection', title: 'בדיקה ואישור שנתי — מערכת שחרור עשן', contractId: 'kt2', customerId: 'c12', addressId: 'ad12', start: at(2, '09:00'), end: at(2, '12:00'), userIds: ['u-tech', 'u-eng'], status: 'confirmed', checklist: [], photosBefore: [], photosAfter: [] },
  { id: 'ap8', type: 'installation', title: 'התקנת 6 מזגנים — קומה 3', caseId: 'k10', customerId: 'c5', addressId: 'ad5', start: ago(7, '08:00'), end: ago(7, '17:00'), userIds: ['u-inst1'], status: 'done', checklist: checklistInstall(8), photosBefore: [], photosAfter: photos('ap8a', [['חדר 302 אחרי התקנה', 'after', 'unit']], 7), customerSignature: { name: 'גיל אברמוב', dataUrl: signatureSvg(5), at: ago(7, '17:05') } },
  { id: 'ap9', type: 'meeting', title: 'פגישת סטטוס עם היזם — נופי הרכס', customerId: 'c8', start: at(0, '11:00'), end: at(0, '12:00'), userIds: ['u-agent2', 'u-eng'], status: 'confirmed', checklist: [], photosBefore: [], photosAfter: [] },
]

const serviceCalls: ServiceCall[] = [
  { id: 'sc1', number: 'SC-0312', customerId: 'c1', addressId: 'ad1', unitId: 'un1', description: 'המזגן בסלון מטפטף מים על הקיר', symptom: 'leak', urgency: 'high', status: 'scheduled', assigneeId: 'u-tech', underWarranty: true, source: 'whatsapp', createdAt: ago(1, '18:20') },
  { id: 'sc2', number: 'SC-0313', customerId: 'c2', addressId: 'ad2', description: 'מזגן לא מקרר, מופיע קוד E4', symptom: 'error_code', errorCode: 'E4', urgency: 'normal', status: 'new', source: 'phone', createdAt: ago(0, '09:30') },
  { id: 'sc3', number: 'SC-0309', customerId: 'c5', addressId: 'ad5', unitId: 'un4', contractId: 'kt1', description: 'רעש חזק מהיחידה החיצונית בחדר 305', symptom: 'noise', urgency: 'normal', status: 'in_progress', assigneeId: 'u-tech', underWarranty: true, source: 'phone', createdAt: ago(2) },
  { id: 'sc4', number: 'SC-0306', customerId: 'c6', addressId: 'ad6', contractId: 'kt3', description: 'מנוע מאוורר יחידה פנימית שרוף — ממתין לחלק מהספק', symptom: 'not_cooling', urgency: 'high', status: 'waiting_parts', assigneeId: 'u-tech', underWarranty: false, charge: 980, source: 'phone', createdAt: ago(5) },
  { id: 'sc5', number: 'SC-0301', customerId: 'c3', addressId: 'ad3', description: 'בדיקת ניקוז לפני ההתקנה החדשה', symptom: 'other', urgency: 'low', status: 'done', assigneeId: 'u-tech', resolution: 'נוקה קו ניקוז, תקין', charge: 290, source: 'phone', createdAt: ago(12), closedAt: ago(11) },
  { id: 'sc6', number: 'SC-0298', customerId: 'c5', addressId: 'ad5', unitId: 'un3', description: 'שלט לא מגיב בחדר 303', symptom: 'remote', urgency: 'low', status: 'done', assigneeId: 'u-tech', resolution: 'הוחלף מקלט IR', underWarranty: true, source: 'whatsapp', createdAt: ago(5), closedAt: ago(4) },
]

const units: InstalledUnit[] = [
  { id: 'un1', customerId: 'c1', addressId: 'ad1', caseId: 'k11', itemId: 'i-w2', model: 'מזגן עילי 2 כ״ס Inverter', serial: 'GW18-2508-44120', location: 'סלון', btu: 18000, installedAt: ymd(addDays(new Date(), -395)), warrantyUntil: ymd(addDays(new Date(), 700)), lastServiceAt: ymd(addDays(new Date(), -30)), nextServiceAt: ymd(addDays(new Date(), 40)) },
  { id: 'un2', customerId: 'c1', addressId: 'ad1', caseId: 'k11', itemId: 'i-w1', model: 'מזגן עילי 1 כ״ס Inverter', serial: 'GW09-2508-44121', location: 'חדר עבודה', btu: 9000, installedAt: ymd(addDays(new Date(), -395)), warrantyUntil: ymd(addDays(new Date(), 700)), nextServiceAt: ymd(addDays(new Date(), 40)) },
  ...Array.from({ length: 6 }, (_, i): InstalledUnit => ({
    id: `un${3 + i}`, customerId: 'c5', addressId: 'ad5', caseId: 'k10', itemId: 'i-w15', model: 'מזגן עילי 1.5 כ״ס Inverter', serial: `GW12-2609-7${7100 + i}`, location: `חדר ${301 + i}`, btu: 12000,
    installedAt: ymd(addDays(new Date(), -7)), warrantyUntil: ymd(addDays(new Date(), 3 * 365 - 7)), nextServiceAt: dayStr(1),
  })),
  { id: 'un9', customerId: 'c12', addressId: 'ad12', caseId: 'k13', itemId: 'i-fan', model: 'מפוח שחרור עשן כולל בקר', serial: 'SMF-2406-1188', location: 'גג — חדר מדרגות מערבי', installedAt: ymd(addDays(new Date(), -700)), warrantyUntil: ymd(addDays(new Date(), 30)), lastServiceAt: ymd(addDays(new Date(), -363)), nextServiceAt: dayStr(2) },
  { id: 'un10', customerId: 'c12', addressId: 'ad12', caseId: 'k13', itemId: 'i-fan', model: 'מפוח שחרור עשן כולל בקר', serial: 'SMF-2406-1189', location: 'גג — חדר מדרגות מזרחי', installedAt: ymd(addDays(new Date(), -700)), warrantyUntil: ymd(addDays(new Date(), 30)), lastServiceAt: ymd(addDays(new Date(), -363)), nextServiceAt: dayStr(2) },
]

const contracts: Contract[] = [
  { id: 'kt1', number: 'CT-0019', customerId: 'c5', title: 'תחזוקה חצי-שנתית — חדרי אירוח', type: 'maintenance', unitIds: ['un3', 'un4', 'un5', 'un6', 'un7', 'un8'], frequencyMonths: 6, pricePerYear: 3480, startDate: ymd(addDays(new Date(), -7)), endDate: ymd(addDays(new Date(), 358)), nextVisit: dayStr(1), autoRenew: true, status: 'active' },
  { id: 'kt2', number: 'CT-0011', customerId: 'c12', title: 'בדיקה ואישור שנתי — שחרור עשן', type: 'smoke_annual', unitIds: ['un9', 'un10'], frequencyMonths: 12, pricePerYear: 2900, startDate: ymd(addDays(new Date(), -700)), endDate: ymd(addDays(new Date(), 30)), nextVisit: dayStr(2), autoRenew: true, status: 'expiring', notes: 'האישור נדרש לכיבוי אש עד סוף החודש' },
  { id: 'kt3', number: 'CT-0016', customerId: 'c6', title: 'תחזוקה רבעונית — כל המבנה', type: 'maintenance', unitIds: [], frequencyMonths: 3, pricePerYear: 14400, startDate: ymd(addDays(new Date(), -345)), endDate: ymd(addDays(new Date(), 20)), nextVisit: dayStr(15), autoRenew: false, status: 'expiring' },
  { id: 'kt4', number: 'CT-0021', customerId: 'c11', title: 'תחזוקה שנתית — מערכת חימום', type: 'heating', unitIds: [], frequencyMonths: 12, pricePerYear: 1900, startDate: ymd(addDays(new Date(), -20)), endDate: ymd(addDays(new Date(), 345)), nextVisit: ymd(addDays(new Date(), 160)), autoRenew: true, status: 'active' },
  { id: 'kt5', number: 'CT-0008', customerId: 'c1', title: 'טיפול שנתי — 2 מזגנים', type: 'maintenance', unitIds: ['un1', 'un2'], frequencyMonths: 12, pricePerYear: 580, startDate: ymd(addDays(new Date(), -395)), endDate: ymd(addDays(new Date(), -30)), nextVisit: ymd(addDays(new Date(), 40)), autoRenew: false, status: 'expired' },
]

const statuses: Apartment['planStatus'][] = ['base', 'requested', 'quoted', 'approved', 'base', 'approved', 'requested', 'base', 'quoted', 'installed', 'base', 'quoted', 'approved', 'base', 'requested', 'base']
const tenantNames = ['משפחת כץ', 'משפחת עזרא', 'משפחת לנדאו', 'משפחת ביבס', 'משפחת חדד', 'משפחת רבינוביץ', 'משפחת אזולאי', 'משפחת זילבר', 'משפחת טל', 'משפחת נחום', 'משפחת גרין', 'משפחת יוסף', 'משפחת שמעוני', 'משפחת בר', 'משפחת פרלמן', 'משפחת מלכה']
const apartments: Apartment[] = statuses.map((planStatus, i) => {
  const floor = Math.floor(i / 2) + 1
  const number = String(i + 1)
  const upgrades: QuoteLine[] =
    planStatus === 'base' ? [] : i % 3 === 0 ? [L('i-m4', 1, 'שדרוג ל-4 כ״ס')] : i % 3 === 1 ? [L('l-prep', 1, 'ממ״ד'), L('i-w1', 1, 'ממ״ד')] : [L('l-wifi', 1), L('l-prep', 1, 'חדר עבודה')]
  return {
    id: `ap-A-${number}`, building: 'A', floor, number, rooms: i % 4 === 0 ? 5 : 4, tenantName: tenantNames[i], tenantPhone: `05${2 + (i % 4)}${String(3100000 + i * 7311).slice(0, 7)}`,
    planStatus, upgrades, caseId: number === '12' ? 'k8' : undefined,
  }
})

const projects: BuildingProject[] = [
  {
    id: 'p1', name: 'נופי הרכס — בית שמש', developerId: 'c8', city: 'בית שמש', address: 'מתחם הרכס, רמת בית שמש', totalApartments: 48,
    basePlan: 'מיני מרכזי 3 כ״ס לכל דירה, כולל הכנה לחדר השינה הראשי. שינויים בתשלום ישיר מהדייר.',
    basePlanLines: [L('i-m3', 1, 'כל הדירה'), L('l-instm', 1)], changesDeadline: dayStr(21), stage: 'tenant_changes', engineerId: 'u-eng', apartments, createdAt: ago(200),
  },
]

const stock: StockEntry[] = [
  { id: 'st1', itemId: 'i-w1', location: 'מחסן ראשי', qty: 14, min: 6 },
  { id: 'st2', itemId: 'i-w15', location: 'מחסן ראשי', qty: 4, min: 6 },
  { id: 'st3', itemId: 'i-w2', location: 'מחסן ראשי', qty: 7, min: 4 },
  { id: 'st4', itemId: 'i-w25', location: 'מחסן ראשי', qty: 2, min: 3 },
  { id: 'st5', itemId: 'i-m3', location: 'מחסן ראשי', qty: 3, min: 2 },
  { id: 'st6', itemId: 'i-m4', location: 'מחסן ראשי', qty: 1, min: 2 },
  { id: 'st7', itemId: 'i-vrf-i', location: 'מחסן ראשי', qty: 8, min: 0 },
  { id: 'st8', itemId: 'l-pipe', location: 'מחסן ראשי', qty: 320, min: 150 },
  { id: 'st9', itemId: 'l-pump', location: 'מחסן ראשי', qty: 9, min: 5 },
  { id: 'st10', itemId: 'l-wifi', location: 'מחסן ראשי', qty: 3, min: 8 },
  { id: 'st11', itemId: 'l-pipe', location: 'רכב — סאמר חלבי', qty: 40, min: 30 },
  { id: 'st12', itemId: 'l-pump', location: 'רכב — סאמר חלבי', qty: 2, min: 2 },
  { id: 'st13', itemId: 'l-pipe', location: 'רכב — יעקב דהן', qty: 18, min: 30 },
  { id: 'st14', itemId: 's-gas', location: 'רכב — נתן גבאי', qty: 3, min: 2 },
  { id: 'st15', itemId: 'l-wifi', location: 'רכב — נתן גבאי', qty: 1, min: 2 },
]

const tasks: Task[] = [
  { id: 't1', title: 'לחזור לגולדברג לגבי ההצעה (נצפתה אתמול בערב)', caseId: 'k1', assigneeId: 'u-agent1', createdBy: 'u-office', due: dayStr(0), done: false, priority: 'high', createdAt: ago(1) },
  { id: 't2', title: 'לתאם מועד התקנה עם ברגר (מקדמה שולמה)', caseId: 'k2', assigneeId: 'u-office', createdBy: 'u-admin', due: dayStr(0), done: false, priority: 'high', createdAt: ago(1) },
  { id: 't3', title: 'חישוב עומסים למקווה לפני שליחת הצעה', caseId: 'k7', assigneeId: 'u-eng', createdBy: 'u-agent2', due: dayStr(2), done: false, priority: 'normal', createdAt: ago(1) },
  { id: 't4', title: 'להזמין מנוף ל-VRF פנטהאוז', caseId: 'k3', assigneeId: 'u-office', createdBy: 'u-eng', due: dayStr(1), done: true, priority: 'normal', createdAt: ago(4) },
  { id: 't5', title: 'לחדש חוזה תחזוקה — נווה השקד (פג בעוד 20 יום)', assigneeId: 'u-agent2', createdBy: 'u-admin', due: dayStr(5), done: false, priority: 'normal', createdAt: ago(2) },
  { id: 't6', title: 'לחדש אישור עבודה בגובה ליעקב דהן', assigneeId: 'u-office', createdBy: 'u-admin', due: dayStr(7), done: false, priority: 'high', createdAt: ago(2) },
]

const messages: Message[] = [
  { id: 'm1', caseId: 'k1', customerId: 'c1', channel: 'whatsapp', direction: 'out', body: 'שלום אהרון, מצורפת הצעת המחיר למיזוג הדירה ברחביה. אפשר לצפות ולאשר כאן: {portal}', at: ago(2, '12:10'), by: 'u-agent1', status: 'read', templateKey: 'quote' },
  { id: 'm2', caseId: 'k1', customerId: 'c1', channel: 'whatsapp', direction: 'in', body: 'תודה, נעבור על זה בערב. אפשר לשים את המזגן בחדר ההורים מעל הדלת?', at: ago(2, '13:02'), status: 'read' },
  { id: 'm3', caseId: 'k1', customerId: 'c1', channel: 'whatsapp', direction: 'out', body: 'בטח, נעדכן את המיקום בתוכנית. אם יש עוד שאלות, אני זמין.', at: ago(2, '13:15'), by: 'u-agent1', status: 'read' },
  { id: 'm4', caseId: 'k3', customerId: 'c4', channel: 'whatsapp', direction: 'out', body: 'שלום שמואל, ההתקנה נקבעה ל-{date}. המנוף יגיע ב-07:30. נשמח לתיאום מול ועד הבית לגבי החניה.', at: ago(3), by: 'u-office', status: 'delivered', templateKey: 'schedule' },
  { id: 'm5', caseId: 'k9', customerId: 'c10', channel: 'whatsapp', direction: 'in', body: 'שלום, עברנו דירה במבשרת וצריכים 4 מזגנים. מתי אפשר לבוא לראות?', at: ago(0, '08:40'), status: 'read' },
  { id: 'm6', serviceCallId: 'sc1', customerId: 'c1', channel: 'whatsapp', direction: 'in', body: 'המזגן בסלון מטפטף מים על הקיר 😕', at: ago(1, '18:20'), status: 'read' },
]

const activities: Activity[] = [
  { id: 'ac1', at: ago(0, '09:12'), kind: 'created', caseId: 'k6', text: 'ליד חדש מהאתר: מרפאת שיניים ד״ר אלון' },
  { id: 'ac2', at: ago(0, '08:40'), kind: 'created', caseId: 'k9', text: 'ליד חדש מוואטסאפ: משפחת שפירא (לקוח זמני)' },
  { id: 'ac3', at: ago(0, '08:05'), kind: 'appointment', caseId: 'k4', userId: 'u-inst1', text: 'הצוות הגיע לאתר והתחיל בהתקנה' },
  { id: 'ac4', at: ago(1, '20:41'), kind: 'portal', caseId: 'k1', text: 'הלקוח צפה בהצעת המחיר Q-26-0091 בפורטל' },
  { id: 'ac5', at: ago(2, '19:05'), kind: 'quote', caseId: 'k2', text: 'הלקוח אישר וחתם על הצעה Q-26-0086' },
  { id: 'ac6', at: ago(2, '19:07'), kind: 'payment', caseId: 'k2', text: 'התקבלה מקדמה ₪1,700 באשראי' },
  { id: 'ac7', at: ago(2, '12:10'), kind: 'message', caseId: 'k1', userId: 'u-agent1', text: 'נשלחה הצעת מחיר בוואטסאפ' },
  { id: 'ac8', at: ago(3, '09:20'), kind: 'quote', caseId: 'k1', userId: 'u-agent1', text: 'נבנתה טיוטת הצעה מתמונות הסקר (AI), נבדקה ותוקנה' },
  { id: 'ac9', at: ago(5, '11:30'), kind: 'note', caseId: 'k1', userId: 'u-agent1', text: 'הסקר בשטח הושלם: 4 חדרים, 4 תמונות' },
  { id: 'ac10', at: ago(6), kind: 'created', caseId: 'k1', userId: 'u-office', text: 'התיק נפתח' },
  { id: 'ac11', at: ago(3), kind: 'appointment', caseId: 'k3', userId: 'u-office', text: 'נקבעה התקנה ל-2 ימים, הלקוח אישר' },
  { id: 'ac12', at: ago(6), kind: 'stage', caseId: 'k10', userId: 'u-inst1', text: 'ההתקנה הסתיימה, הלקוח חתם על טופס מסירה' },
  { id: 'ac13', at: ago(1), kind: 'sync', customerId: 'c6', text: 'שגיאת סנכרון ל-Priority: חסר ח.פ בכרטיס הלקוח' },
]

const docs: Doc[] = [
  { id: 'd1', caseId: 'k3', folder: 'engineering', name: 'תוכנית מיזוג — פנטהאוז.pdf', mime: 'application/pdf', size: 1840000, uploadedBy: 'u-eng', uploadedAt: ago(25) },
  { id: 'd2', caseId: 'k3', folder: 'customer', name: 'תוכנית אדריכלית קומה 6.pdf', mime: 'application/pdf', size: 3200000, uploadedAt: ago(33) },
  { id: 'd3', caseId: 'k3', folder: 'suppliers', name: 'הזמנת ציוד VRF מהספק.pdf', mime: 'application/pdf', size: 210000, uploadedBy: 'u-office', uploadedAt: ago(15) },
  { id: 'd4', caseId: 'k10', folder: 'installer', name: 'טופס מסירה חתום — קומה 3.pdf', mime: 'application/pdf', size: 120000, uploadedBy: 'u-inst1', uploadedAt: ago(7) },
  { id: 'd5', caseId: 'k1', folder: 'office', name: 'הצעת מחיר Q-26-0091.pdf', mime: 'application/pdf', size: 98000, uploadedBy: 'u-agent1', uploadedAt: ago(2) },
]

const money: MoneyLine[] = [
  { id: 'mn1', caseId: 'k3', kind: 'budget', category: 'ציוד', description: 'יחידות VRF', amount: 52000, at: dayStr(-25) },
  { id: 'mn2', caseId: 'k3', kind: 'budget', category: 'עבודה', description: 'צוות התקנה, 2 ימים', amount: 9000, at: dayStr(-25) },
  { id: 'mn3', caseId: 'k3', kind: 'expense', category: 'ציוד', description: 'חשבונית ספק — יחידות VRF', amount: 49800, at: dayStr(-14) },
  { id: 'mn4', caseId: 'k3', kind: 'expense', category: 'שירותים', description: 'מנוף — הזמנה', amount: 1200, at: dayStr(-3) },
  { id: 'mn5', caseId: 'k3', kind: 'payment', category: 'מקדמה', description: 'העברה בנקאית', amount: 26000, at: dayStr(-19) },
  { id: 'mn6', caseId: 'k10', kind: 'payment', category: 'מקדמה', description: 'העברה בנקאית', amount: 7000, at: dayStr(-39) },
  { id: 'mn7', caseId: 'k10', kind: 'commission', category: 'עמלת סוכן', description: 'יוסי פרץ — 3%', amount: 1013, at: dayStr(-6), userId: 'u-agent2' },
]

const notifications: Notification[] = [
  { id: 'n1', at: ago(0, '09:12'), userId: 'u-admin', text: 'ליד חדש מהאתר: מרפאת שיניים ד״ר אלון', link: '/cases/k6', read: false },
  { id: 'n2', at: ago(1, '20:41'), userId: 'u-admin', text: 'גולדברג צפו בהצעת המחיר', link: '/cases/k1', read: false },
  { id: 'n3', at: ago(1), userId: 'u-admin', text: 'שגיאת סנכרון ל-Priority: נווה השקד', link: '/settings/priority', read: false },
  { id: 'n4', at: ago(2, '19:05'), userId: 'u-admin', text: 'ברגר אישר וחתם על ההצעה, מקדמה התקבלה', link: '/cases/k2', read: true },
]

export function seedDB(): DB {
  // עותק עמוק, כדי ש"איפוס הדגמה" יתחיל תמיד מאותה נקודה
  const db: DB = structuredClone({
    users,
    customers,
    contacts,
    cases,
    catalog,
    quotes,
    appointments,
    serviceCalls,
    units,
    contracts,
    projects,
    stock,
    tasks,
    messages,
    activities,
    docs,
    money,
    notifications,
    chat: [],
    leaves: [],
    suppliers: [],
    purchaseOrders: [],
    stockMoves: [],
    config: defaultConfig(),
    counters: { case: 142, quote: 93, service: 313, contract: 21, apt: 0, po: 0 },
  })
  // נתוני הדגמה של כל מודול נמצאים בקובץ משלו
  applyPlatformSeed(db)
  applyCollabSeed(db)
  applyAdminSeed(db)
  applyHistorySeed(db)
  return db
}
