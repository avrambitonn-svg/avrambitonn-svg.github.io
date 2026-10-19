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
}

export type SyncStatus = 'synced' | 'pending' | 'error' | 'not_synced' | 'disabled'

export interface SyncState {
  status: SyncStatus
  priorityId?: string
  lastSync?: ISO
  error?: string
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

export type LeadSource = 'phone' | 'whatsapp' | 'website' | 'referral' | 'facebook' | 'returning' | 'other'

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
  sync: SyncState
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
  status: 'active' | 'expiring' | 'expired' | 'cancelled'
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
  folder: 'office' | 'customer' | 'installer' | 'engineering' | 'suppliers' | 'archive'
  name: string
  mime: string
  dataUrl?: string
  url?: string
  size?: number
  uploadedBy?: ID
  uploadedAt: ISO
}

export interface MoneyLine {
  id: ID
  caseId: ID
  kind: 'budget' | 'expense' | 'commission' | 'payment'
  category: string
  description: string
  amount: number
  at: string
  userId?: ID
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
  counters: Record<string, number>
}

export type Collection = Exclude<keyof DB, 'counters'>
export type Entity<C extends Collection> = DB[C][number]
