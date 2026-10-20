// מודל הנתונים של המערכת. לכל ישות יש מקור אמת אחד: מה שמגיע מ-Priority מסומן ב-prioritySync.

export type ID = string
export type ISO = string // תאריך-שעה ב-ISO

export type Role = 'admin' | 'office' | 'agent' | 'engineer' | 'installer'

export interface Certification {
  type: 'עבודה בגובה' | 'חשמל' | 'גזי קירור' | 'מנוף'
  expires: string // YYYY-MM-DD
}

export interface User {
  id: ID
  name: string
  role: Role
  title: string
  phone: string
  email?: string
  region?: string
  skills?: string[]
  color: string
  certifications?: Certification[]
  active: boolean
  functions?: UserFunction[] // [platform] מנהל מחלקה / מנהל פרויקט, בנוסף לתפקיד
  googleCalendarId?: string // [platform] היומן האישי שאליו נכנסים האירועים שלו
  initials?: string // [admin] ראשי תיבות באנגלית למספור תיקים לפי סוכן (DM-0012)
}

export type SyncStatus = 'synced' | 'pending' | 'error' | 'not_synced' | 'disabled'

export interface SyncState {
  status: SyncStatus
  priorityId?: string
  lastSync?: ISO
  error?: string
  attempts?: number // ניסיונות שנכשלו מאז הסנכרון האחרון שהצליח
  hash?: string // [platform] מה נשלח ל-Priority בפעם האחרונה (מנוע הסנכרון בשרת)
  remoteHash?: string // [platform] איך הרשומה נראתה ב-Priority בפעם האחרונה
  key?: { NAME: string; FIRM?: number } // [platform] מפתח איש הקשר ב-Priority
}

// [platform] יתרת הלקוח ב-Priority (אובליגו), נמשכת אוטומטית
export interface PriorityBalance {
  obligo: number
  invoices: number
  account: number
  orders: number
  at: ISO
}

// [platform] מצב ההזמנה ב-Priority, נמשך אוטומטית
export interface PriorityOrder {
  number: string
  status?: string
  closed?: boolean
  total?: number
  statusAt?: ISO
  at: ISO
}

export interface Address {
  id: ID
  label?: string
  city: string
  street: string
  number?: string
  floor?: string
  apartment?: string
  entryNotes?: string
}

export type CustomerType = 'private' | 'business' | 'institution' | 'developer'

export interface Customer {
  id: ID
  name: string
  type: CustomerType
  phone: string
  email?: string
  idNumber?: string // ת"ז או ח"פ
  addresses: Address[]
  temp?: boolean // לקוח זמני, עד שנפתח ב-Priority
  sync: SyncState
  balance?: PriorityBalance // [platform]
  tags?: string[]
  notes?: string
  createdAt: ISO
}

export interface Contact {
  id: ID
  customerId: ID
  name: string
  role?: string
  phone: string
  email?: string
  primary?: boolean
  fromCaseId?: ID // [admin] נוצר מתוך תיק (כרטיס הלקוח בתיק / אשף פתיחת תיק)
  sync?: SyncState // [platform]
}

export type CaseStage =
  | 'lead'
  | 'survey'
  | 'quote'
  | 'approved'
  | 'scheduled'
  | 'installing'
  | 'completed'
  | 'closed'
  | 'lost'

export type ProjectType =
  | 'apartment'
  | 'luxury'
  | 'institution'
  | 'commercial'
  | 'residential_building'
  | 'underfloor_heating'
  | 'smoke_ventilation'
  | 'replacement'
  | 'other'
  | (string & {}) // סוגים שהוגדרו בהגדרות

export type LeadSource = 'phone' | 'whatsapp' | 'website' | 'referral' | 'facebook' | 'returning' | 'portal' | 'other'

export interface Photo {
  id: ID
  dataUrl: string
  caption?: string
  tag?: 'existing_unit' | 'nameplate' | 'wall' | 'electric_panel' | 'outdoor' | 'room' | 'before' | 'after' | 'other'
  takenAt: ISO
  by?: ID
}

export interface SurveyRoom {
  id: ID
  name: string
  areaSqm?: number
  ceilingM?: number
  sunExposure?: 'low' | 'medium' | 'high'
  floor?: number
  notes?: string
}

export interface Survey {
  rooms: SurveyRoom[]
  pipeLengthM?: number
  workAtHeight?: boolean
  craneNeeded?: boolean
  electricalReady?: boolean
  existingUnitsToRemove?: number
  voiceNotes?: string // תמלול הקלטה
  notes?: string
  photos: Photo[]
  doneAt?: ISO
  doneBy?: ID
}

export interface Case {
  id: ID
  number: string
  title: string
  customerId: ID
  payerCustomerId?: ID
  contactIds: ID[]
  addressId: ID
  projectType: ProjectType
  stage: CaseStage
  source: LeadSource
  agentId?: ID
  engineerId?: ID
  managerId?: ID
  installerIds: ID[]
  priority: 'normal' | 'high' | 'urgent'
  tags: string[]
  notes?: string
  survey: Survey
  installWindow?: { from: string; to: string } // YYYY-MM-DD
  portal: { token: string; enabled: boolean; lastViewedAt?: ISO }
  driveFolderUrl?: string
  buildingProjectId?: ID
  apartmentId?: ID
  lostReason?: string
  createdAt: ISO
  updatedAt: ISO
  closedAt?: ISO
  departmentManagerIds?: ID[] // [admin] מנהלי מחלקה: כולם מקבלים את משימות התיק
  projectManagerId?: ID // [admin]
  contactMethod?: string // [admin] אופן הפנייה (מפתח מ-config.contactMethods)
  templateId?: ID // [collab] תבנית התיק שממנה נבנה הפלואו
  flow?: CaseFlow // [collab]
  driveFolderId?: string // [platform]
  driveFolders?: Record<string, string> // [platform] מפתח תיקייה -> מזהה תיקייה ב-Drive
  createdVia?: 'lead' // [platform] נפתח בשרת מטופס הפנייה הציבורי; מכשיר של המשרד משלים פלואו, Drive ו-Priority
  leadFollowupsAt?: ISO // [platform] מתי ההשלמות האלה רצו (פעם אחת)
  followupsBy?: ID // [platform]
}

export type ItemCategory = 'unit' | 'labor' | 'material' | 'accessory' | 'service' | 'heating' | 'ventilation'

export interface CatalogItem {
  id: ID
  sku: string
  name: string
  category: ItemCategory
  unit: string // יח׳, מ״א, שעה, פרויקט
  price: number // לפני מע"מ
  cost: number
  btu?: number
  hp?: number
  warrantyMonths?: number
  sync: SyncState
  active: boolean
}

export interface QuoteLine {
  id: ID
  itemId?: ID
  description: string
  qty: number
  unit: string
  unitPrice: number
  room?: string
  aiReason?: string
}

export type QuoteStatus = 'draft' | 'sent' | 'viewed' | 'approved' | 'rejected' | 'expired'

export interface AiMeta {
  source: 'claude' | 'demo'
  model?: string
  confidence: 'low' | 'medium' | 'high'
  summary: string
  assumptions: string[]
  questions: string[]
  createdAt: ISO
}

export interface Signature {
  name: string
  dataUrl: string
  at: ISO
  ip?: string
}

export interface Quote {
  id: ID
  caseId: ID
  number: string
  version: number
  status: QuoteStatus
  lines: QuoteLine[]
  discountPct: number
  vatPct: number
  validUntil: string // YYYY-MM-DD
  notes?: string
  terms: string
  ai?: AiMeta
  signature?: Signature
  deposit?: { amount: number; paidAt?: ISO; method?: 'credit' | 'bit' | 'transfer' | 'check' }
  sentAt?: ISO
  viewedAt?: ISO
  decidedAt?: ISO
  createdBy?: ID
  createdAt: ISO
  sync: SyncState // ההזמנה ב-Priority
  cprof?: SyncState // [platform] ההצעה עצמה ב-Priority (CPROF)
  priorityOrder?: PriorityOrder // [platform]
  approvedVia?: 'portal' // [platform] אושרה באזור האישי מול השרת; מכשיר של המשרד משלים עמלה, פלואו ו-Priority
  approvedFromStage?: CaseStage // [platform] שלב התיק לפני האישור
  portalFollowupsAt?: ISO // [platform] מתי ההשלמות רצו (פעם אחת)
  followupsBy?: ID // [platform]
}

export type AppointmentType = 'survey' | 'installation' | 'service' | 'maintenance' | 'inspection' | 'meeting'
export type AppointmentStatus = 'planned' | 'confirmed' | 'on_the_way' | 'in_progress' | 'done' | 'cancelled'

export interface ChecklistItem {
  id: ID
  text: string
  done: boolean
}

export interface Appointment {
  id: ID
  type: AppointmentType
  title: string
  caseId?: ID
  serviceCallId?: ID
  contractId?: ID
  customerId?: ID
  addressId?: ID
  start: ISO
  end: ISO
  allDay?: boolean
  userIds: ID[]
  status: AppointmentStatus
  checklist: ChecklistItem[]
  photosBefore: Photo[]
  photosAfter: Photo[]
  customerSignature?: Signature
  notes?: string
  reminderSentAt?: ISO
  googleEventId?: string
  partsUsed?: { itemId: ID; qty: number; location?: string }[] // חלקים שנצרכו בשטח (ירדו מהמלאי ברכב)
  completedAt?: ISO
  reminderMin?: number // [collab] תזכורת לצוות X דקות לפני
  remindedAt?: ISO // [collab]
  location?: string // [collab] מיקום חופשי לפגישה שאינה אצל לקוח
  googleEventIds?: Record<ID, string> // [platform] מזהה אירוע ביומן של כל משתתף
}

export type ServiceStatus = 'new' | 'assigned' | 'scheduled' | 'in_progress' | 'waiting_parts' | 'done' | 'cancelled'

export interface ServiceCall {
  id: ID
  number: string
  customerId: ID
  addressId?: ID
  unitId?: ID
  contractId?: ID
  description: string
  symptom?: 'not_cooling' | 'leak' | 'noise' | 'error_code' | 'no_power' | 'smell' | 'remote' | 'other'
  errorCode?: string
  urgency: 'low' | 'normal' | 'high' | 'urgent'
  status: ServiceStatus
  assigneeId?: ID
  underWarranty?: boolean
  charge?: number
  resolution?: string
  partsUsed?: { itemId: ID; qty: number }[]
  source: LeadSource
  createdAt: ISO
  closedAt?: ISO
  sync?: SyncState // [platform]
}

export interface InstalledUnit {
  id: ID
  customerId: ID
  addressId?: ID
  caseId?: ID
  itemId?: ID
  model: string
  serial: string
  location?: string // חדר / קומה
  btu?: number
  installedAt: string // YYYY-MM-DD
  warrantyUntil: string
  lastServiceAt?: string
  nextServiceAt?: string
}

export type ContractType = 'maintenance' | 'smoke_annual' | 'heating' | 'vrf_service'

export interface Contract {
  id: ID
  number: string
  customerId: ID
  title: string
  type: ContractType
  unitIds: ID[]
  frequencyMonths: number
  pricePerYear: number
  startDate: string
  endDate: string
  nextVisit: string
  autoRenew: boolean
  status: 'proposed' | 'active' | 'expiring' | 'expired' | 'cancelled'
  notes?: string
}

export type ApartmentPlanStatus = 'base' | 'requested' | 'quoted' | 'approved' | 'installed'

export interface Apartment {
  id: ID
  building: string
  floor: number
  number: string
  rooms: number
  tenantName?: string
  tenantPhone?: string
  planStatus: ApartmentPlanStatus
  upgrades: QuoteLine[]
  caseId?: ID
  notes?: string
}

export interface BuildingProject {
  id: ID
  name: string
  developerId: ID
  city: string
  address: string
  totalApartments: number
  basePlan: string
  basePlanLines: QuoteLine[]
  changesDeadline: string
  stage: 'design' | 'tenant_changes' | 'execution' | 'delivery' | 'done'
  engineerId?: ID
  apartments: Apartment[]
  createdAt: ISO
}

export interface StockEntry {
  id: ID
  itemId: ID
  location: string // "מחסן ראשי" או "רכב — <שם>"
  qty: number
  min: number
}

export interface Task {
  id: ID
  title: string
  caseId?: ID
  assigneeId: ID
  createdBy: ID
  due?: string
  done: boolean
  priority: 'low' | 'normal' | 'high'
  createdAt: ISO
  sharedWith?: ID[] // [collab] משתמשים נוספים שרואים ומקבלים עדכונים
  status?: string // [collab] מפתח מ-config.taskStatuses (ברירת מחדל: new / done לפי done)
  remindAt?: ISO // [collab]
  remindedAt?: ISO // [collab]
  notes?: string
  flowStageId?: ID // [collab] נוצרה אוטומטית משלב בפלואו
  doneAt?: ISO
  doneBy?: ID
}

export type Channel = 'whatsapp' | 'sms' | 'email' | 'internal' | 'portal'

export interface Message {
  id: ID
  caseId?: ID
  serviceCallId?: ID
  customerId?: ID
  channel: Channel
  direction: 'out' | 'in'
  body: string
  at: ISO
  by?: ID
  status: 'draft' | 'opened' | 'sent' | 'delivered' | 'read' | 'failed'
  templateKey?: string
  readAt?: ISO // [collab] פנייה נכנסת שנפתחה בצוות (בלי זה היא "לא נקראה")
  readBy?: ID // [collab] מי פתח אותה ראשון
}

export interface Activity {
  id: ID
  at: ISO
  userId?: ID
  caseId?: ID
  serviceCallId?: ID
  customerId?: ID
  kind:
    | 'created'
    | 'stage'
    | 'quote'
    | 'message'
    | 'appointment'
    | 'document'
    | 'payment'
    | 'sync'
    | 'note'
    | 'portal'
    | 'service'
  text: string
}

export interface Doc {
  id: ID
  caseId?: ID
  customerId?: ID
  folder: DocFolder
  name: string
  mime: string
  dataUrl?: string
  url?: string
  size?: number
  uploadedBy?: ID
  uploadedAt: ISO
  supplierId?: ID // [admin]
  blobKey?: string // [platform] הקובץ עצמו ב-IndexedDB (כשאין שרת)
  fileId?: string // [platform] הקובץ בשרת
  driveFileId?: string // [platform]
  webViewLink?: string // [platform]
  customerVisible?: boolean // [platform] מוצג ללקוח באזור האישי (ברירת מחדל: תיקיית "לקוח")
  source?: 'portal' // [platform] הלקוח העלה מהאזור האישי
}

export interface MoneyLine {
  id: ID
  caseId: ID
  kind: 'budget' | 'expense' | 'commission' | 'payment' | 'invoice'
  category: string
  description: string
  amount: number
  at: string
  userId?: ID
  method?: string // [admin] אמצעי תשלום (config.paymentMethods)
  budgetType?: string // [admin] סוג סעיף תקציב (config.budgetItemTypes)
  supplierId?: ID // [admin]
  agentId?: ID // [admin] למי העמלה
  status?: 'planned' | 'pending' | 'paid' // [admin]
  purchaseOrderId?: ID // [admin] הוצאה שנוצרה מקבלת הזמנת רכש
  source?: 'priority' // [platform] הגיע מ-Priority: קריאה בלבד
  priorityId?: string // [platform] מספר החשבונית / הקבלה ב-Priority
  priorityForm?: string // [platform]
}

export interface Notification {
  id: ID
  at: ISO
  userId: ID // למי
  text: string
  link?: string
  read: boolean
}

export interface Settings {
  vatPct: number
  quoteValidityDays: number
  depositPct: number
  workDays: number[] // 0=ראשון
  workStart: string
  workEnd: string
  avoidHolidays: boolean
  serverUrl: string // שרת האינטגרציות; ריק = מצב הדגמה
  appToken: string
  anthropicKey: string // נשמר רק בדפדפן הזה, לשימוש הדגמה
  aiModel: 'claude-opus-5-5' | 'claude-sonnet-5-5'
  whatsappMode: 'link' | 'cloud_api'
  googleMode: 'link' | 'api'
  priorityMode: 'off' | 'server'
  reviewUrl: string
  commissionPct: number
}


export type DocFolder = 'office' | 'customer' | 'installer' | 'engineering' | 'suppliers' | 'archive' | (string & {})
export type UserFunction = 'department_manager' | 'project_manager'

// ===================== [collab] צ'אט, משימות, פלואו, חופשות =====================

export interface ChatMessage {
  id: ID
  threadId: string // 'case:<caseId>' לצ'אט צוות בתיק, 'dm:<userA>:<userB>' (ממוין) לשיחה אישית
  caseId?: ID
  fromId: ID
  body: string
  at: ISO
  readBy: ID[]
  mentions?: ID[]
  attachments?: { name: string; mime?: string; docId?: ID; dataUrl?: string }[]
  editedAt?: ISO
  deleted?: boolean
}

// מי מקבל את משימות השלב
export type FlowRole = 'agent' | 'engineer' | 'manager' | 'department_managers' | 'project_manager' | 'installers' | 'office' | 'admin'

export interface FlowStage {
  id: ID
  name: string
  color?: string
  tasks: { title: string; role: FlowRole; dueDays?: number }[]
  caseStage?: CaseStage // כשהתיק מגיע לשלב הזה בצנרת, שלב הפלואו מסתיים אוטומטית
}

export interface CaseTemplate {
  id: ID
  name: string
  projectTypes: string[] // ריק = כל הסוגים
  stageIds: ID[]
  defaultTags?: string[]
  active: boolean
}

export interface CaseFlow {
  templateId: ID
  stageIdx: number
  startedAt: ISO
  doneAt?: ISO
  log: { stageId: ID; startedAt: ISO; doneAt?: ISO; doneBy?: ID }[]
}

export interface LeaveRequest {
  id: ID
  userId: ID
  type: string // config.leaveTypes
  from: string // YYYY-MM-DD
  to: string // YYYY-MM-DD (כולל)
  hours?: { start: string; end: string } // חופשה חלקית ביום אחד
  reason?: string
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  decidedBy?: ID
  decidedAt?: ISO
  decisionNote?: string
  createdAt: ISO
}

// ===================== [admin] הגדרות, ספקים, רכש =====================

export interface ListOption {
  key: string
  label: string
  color?: string
  active: boolean
  system?: boolean // ערכי מערכת: אפשר לשנות שם וצבע, לא למחוק
}

export interface CommissionRule {
  id: ID
  name: string
  agentId?: ID // ריק = כל הסוכנים
  projectType?: string // ריק = כל הסוגים
  pct: number
  base: 'net' | 'profit' // מהמחיר לפני מע"מ או מהרווח
  active: boolean
}

export interface Config {
  projectTypes: (ListOption & { autoName: boolean })[]
  caseStages: ListOption[] // רק שם וצבע; המפתחות קבועים (CaseStage)
  tags: ListOption[]
  expenseCategories: ListOption[]
  budgetItemTypes: ListOption[]
  paymentMethods: ListOption[]
  contactMethods: ListOption[]
  driveFolders: ListOption[] // מפתחות = DocFolder
  taskStatuses: ListOption[]
  taskPriorities: ListOption[]
  leaveTypes: ListOption[]
  supplierCategories: ListOption[]
  commissionRules: CommissionRule[]
  caseTemplates: CaseTemplate[]
  flowStages: FlowStage[]
  caseNumbering: { mode: 'global' | 'agent'; prefix: string; pad: number }
  theme: 'genair' | 'navy' | 'green' | 'orange'
  installerDayCost?: number // [admin] עלות יום עבודה של מתקין (לדוח תפוקת מתקינים)
}

export interface Supplier {
  id: ID
  name: string
  category: string // config.supplierCategories
  contactName?: string
  phone?: string
  email?: string
  website?: string
  address?: string
  vatNum?: string
  paymentTerms?: string // שוטף + 30 וכו'
  notes?: string
  rating?: number // 1-5
  active: boolean
  priorityId?: string // מספר ספק ב-Priority (SUPPLIERS)
  createdAt: ISO
  sync?: SyncState // [platform]
}

export interface PurchaseOrder {
  id: ID
  number: string
  supplierId: ID
  caseId?: ID
  lines: { itemId?: ID; description: string; qty: number; unitCost: number; unit?: string }[]
  status: 'draft' | 'sent' | 'confirmed' | 'received' | 'cancelled'
  toLocation?: string // מחסן / רכב
  expectedAt?: string
  notes?: string
  createdAt: ISO
  sentAt?: ISO
  receivedAt?: ISO
  confirmedAt?: ISO
  cancelledAt?: ISO
  createdBy?: ID
  sentVia?: 'whatsapp' | 'email' | 'copy'
  moneyLineId?: ID // ההוצאה שנרשמה בתיק כשההזמנה התקבלה
  sync?: SyncState // [platform]
}

// [platform] מצב מנוע הסנכרון עם Priority, כפי שהשרת כותב אותו
export interface SyncRun { at: ISO; ms: number; ok: boolean; error?: string }
export interface SyncStream { at: ISO; ok: boolean; error?: string | null; pausedUntil?: ISO; [count: string]: unknown }
export interface IntegrationState {
  id: string
  engine?: { active: boolean; startedAt: ISO; mode: string; write: boolean; streams: string[] }
  runs?: Partial<Record<'hot' | 'warm' | 'full', SyncRun>>
  streams?: Record<string, SyncStream>
  cursors?: Record<string, ISO>
  lastError?: string | null
  customersSince?: ISO
}

export interface DB {
  users: User[]
  customers: Customer[]
  contacts: Contact[]
  cases: Case[]
  catalog: CatalogItem[]
  quotes: Quote[]
  appointments: Appointment[]
  serviceCalls: ServiceCall[]
  units: InstalledUnit[]
  contracts: Contract[]
  projects: BuildingProject[]
  stock: StockEntry[]
  tasks: Task[]
  messages: Message[]
  activities: Activity[]
  docs: Doc[]
  money: MoneyLine[]
  notifications: Notification[]
  chat: ChatMessage[] // [collab]
  leaves: LeaveRequest[] // [collab]
  suppliers: Supplier[] // [admin]
  purchaseOrders: PurchaseOrder[] // [admin]
  integrations?: IntegrationState[] // [platform] רק השרת כותב
  config: Config // [admin]
  counters: Record<string, number>
}

export type Collection = Exclude<keyof DB, 'counters' | 'config' | 'integrations'>
export type Entity<C extends Collection> = DB[C][number]
