// השלמות שרק מכשיר של צוות יכול לעשות, אחרי פעולות שנעשו בשרת בלי משתמש מחובר:
// אישור הצעה באזור האישי (עמלה, פלואו, הזמנה ב-Priority) וליד מהטופס הציבורי (פלואו, תיקיית Drive, לקוח ב-Priority).
// כל השלמה רצה פעם אחת בלבד: המכשיר "תופס" אותה בשרת (ifUnset), ורק מי שהצליח מריץ.
import { app } from '../store'
import type { Case, Quote } from '../types'
import { nowIso, uid, ymd } from '../format'
import { totals } from '../quote'
import { commissionFor } from '../commission'
import { pushCustomer, pushOrder, serverSync } from '../integrations/priority'
import { createDriveFolder } from '../integrations/google'
import { onCaseCreated, onStageChanged } from '../../features/flow/engine'
import { bridge } from './bridge'
import { rpc } from './session'
import { onRemoteApplied } from './engine'

const tried = new Set<string>()
let timer: ReturnType<typeof setTimeout> | undefined
let started = false

async function claim(collection: 'quotes' | 'cases', id: string, field: 'portalFollowupsAt' | 'leadFollowupsAt' | 'commissionFollowupsAt'): Promise<boolean> {
  const at = nowIso()
  const r = await rpc<{ results: { status: string }[] }>('db_ops', {
    ops: [{ op: 'patch', collection, id, data: { [field]: at, followupsBy: app().currentUserId }, at: bridge.clock(), ifUnset: field }],
    client_id: null,
  })
  return r.results[0]?.status === 'ok'
}

function addCommission(q: Quote) {
  const s = app()
  const k = s.db.cases.find((x) => x.id === q.caseId)
  if (!k) return
  const t = totals(q, s.db.catalog)
  const com = commissionFor(k, t)
  if (k.agentId && com && !s.db.money.some((m) => m.caseId === k.id && m.kind === 'commission' && m.description.includes(q.number))) {
    s.upsert('money', {
      id: uid('mn'), caseId: k.id, kind: 'commission', category: 'עמלת סוכן',
      description: `${s.db.users.find((u) => u.id === k.agentId)?.name ?? ''} — ${com.label} (${q.number})`, amount: com.amount, at: ymd(), userId: k.agentId, agentId: k.agentId, status: 'pending',
    })
  }
}

function quoteFollowups(q: Quote) {
  const s = app()
  const k = s.db.cases.find((x) => x.id === q.caseId)
  if (!k) return
  addCommission(q)
  onStageChanged(k, (q.approvedFromStage ?? 'quote') as Case['stage'], 'approved')
  const cust = s.db.customers.find((c) => c.id === k.customerId)
  if (serverSync()) return
  if (cust?.sync.priorityId) void pushOrder(q, cust.sync.priorityId)
  else s.patch('quotes', q.id, { sync: { status: 'pending' } })
}

function leadFollowups(k: Case) {
  onCaseCreated(k)
  void createDriveFolder(k)
  const cust = app().db.customers.find((c) => c.id === k.customerId)
  if (cust) void pushCustomer(cust)
}

async function run() {
  const s = app()
  const me = s.db.users.find((u) => u.id === s.currentUserId)
  if (!me || (me.role !== 'admin' && me.role !== 'office')) return
  const quotes = s.db.quotes.filter((q) => q.approvedVia === 'portal' && !q.portalFollowupsAt && !tried.has(q.id))
  const leads = s.db.cases.filter((k) => k.createdVia === 'lead' && !k.leadFollowupsAt && !tried.has(k.id))
  // אושרו במכשיר של סוכן, שלא רואה עלויות: רק העמלה חסרה
  const commissions = s.db.quotes.filter((q) => q.commissionPending && q.approvedVia !== 'portal' && !q.commissionFollowupsAt && !tried.has(`c:${q.id}`))
  for (const q of commissions) {
    tried.add(`c:${q.id}`)
    try {
      if (await claim('quotes', q.id, 'commissionFollowupsAt')) addCommission(app().db.quotes.find((x) => x.id === q.id) ?? q)
    } catch {
      tried.delete(`c:${q.id}`)
    }
  }
  for (const q of quotes) {
    tried.add(q.id)
    try {
      if (await claim('quotes', q.id, 'portalFollowupsAt')) quoteFollowups(app().db.quotes.find((x) => x.id === q.id) ?? q)
    } catch {
      tried.delete(q.id)
    }
  }
  for (const k of leads) {
    tried.add(k.id)
    try {
      if (await claim('cases', k.id, 'leadFollowupsAt')) leadFollowups(app().db.cases.find((x) => x.id === k.id) ?? k)
    } catch {
      tried.delete(k.id)
    }
  }
}

export function startReconciler() {
  if (started) return
  started = true
  onRemoteApplied(() => {
    clearTimeout(timer)
    timer = setTimeout(() => void run(), 800)
  })
}
