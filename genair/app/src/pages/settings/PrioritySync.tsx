import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, AlertTriangle, ArrowLeftRight, CheckCircle2, Clock, PlugZap, RefreshCw, Server, Zap } from 'lucide-react'
import { useApp, useSettings } from '../../lib/store'
import { Badge, Callout, Card, Empty, PageHead, Stat, Tabs, toast } from '../../components/ui'
import { syncLabel, syncTone } from '../../lib/labels'
import { dateTime, relative } from '../../lib/format'
import { processQueue, pullPrices, priorityEnabled, pushCustomer, pushOrder, runServerSync, serverSync, testConnection } from '../../lib/integrations/priority'
import { bridge } from '../../lib/sync/bridge'
import { serverConfigured } from '../../lib/integrations/server'
import type { IntegrationState, SyncState } from '../../lib/types'

type RowKind = 'לקוח' | 'איש קשר' | 'הצעה ב-Priority' | 'הזמנה' | 'ספק' | 'הזמנת רכש' | 'קבלת סחורה' | 'קריאת שירות' | 'פריט' | 'מזגן מותקן' | 'קובץ' | 'תנועת מלאי' | 'סוכן' | 'הערה'
interface Row { kind: RowKind; id: string; name: string; sync: SyncState; link: string; retry?: () => Promise<unknown> }

// [במערכת, מסך ב-Priority, כיוון, שדות]
const mapping: [string, string, string, string][] = [
  ['לקוחות', 'CUSTOMERS', '⇄', 'CUSTNAME (מספר), CUSTDES (שם), PHONE, EMAIL, ADDRESS, STATE (עיר), VATNUM (ח״פ). לקוח שנפתח ב-Priority נכנס למערכת'],
  ['אנשי קשר', 'CUSTPERSONNEL_SUBFORM', '⇄', 'NAME, CELLPHONE, EMAIL, POSITIONDES. איש קשר שנוסף או נערך ב-Priority נכנס למערכת'],
  ['הצעות מחיר', 'CPROF + CPROFITEMS_SUBFORM', '→', 'CUSTNAME, REFERENCE (מספר ההצעה), DETAILS; שורות: PARTNAME, TQUANT, PRICE, PDES. עריכה מחליפה את השורות'],
  ['הזמנות', 'ORDERS + ORDERITEMS_SUBFORM', '⇄', 'נפתחת כשההצעה מאושרת (REFERENCE, CPROFNUM). חוזר: ORDSTATUSDES, BOOLCLOSED, TOTPRICE'],
  ['ספקים', 'SUPPLIERS', '→', 'SUPDES, PHONE, EMAIL, ADDRESS, VATNUM'],
  ['הזמנות רכש', 'PORDERS + PORDERITEMS_SUBFORM', '⇄', 'SUPNAME, DETAILS (מספר ההזמנה); שורות: PARTNAME, TQUANT, PRICE. סטטוס: מאושרת/מבוטלת, וחוזר STATDES'],
  ['קריאות שירות', 'DOCUMENTS_Q', '⇄', 'נפתחת: CUSTNAME, REFERENCE, SERNUM, PHONENUM, תיאור. נסגרת/מבוטלת בשני הכיוונים (CALLSTATUSCODE לפי CALLSTATUSES), מה נעשה ב-DETAILS'],
  ['סוכנים', 'AGENTS', '→', 'AGENTNAME, AGENTCODE. הסוכן של התיק נשלח עם ההצעה וההזמנה'],
  ['כתובות נוספות', 'CUSTDESTS_SUBFORM', '→', 'CODE, CODEDES, ADDRESS, STATE'],
  ['קבצים', 'CUSTEXTFILE_SUBFORM, SUPEXTFILE_SUBFORM', '→', 'EXTFILEDES (מספר התיק ושם הקובץ), הקובץ עצמו. עד PRIORITY_FILES_MAX_MB'],
  ['מזגנים מותקנים', 'SERNUMBERS', '⇄', 'SERNUM, PARTNAME, CUSTNAME, INSTDATE, LOCATION. חוזר: WARDATEFINAL, LASTMAINTDATE, NEXTMAINTDATE'],
  ['תנועות מלאי', 'DOCUMENTS_T, DOCUMENTS_D', '→', 'העברה בין מחסן לרכב (T), חלקים שנוצלו אצל לקוח (D). נסגרות כסופיות'],
  ['קבלת סחורה', 'DOCUMENTS_P', '→', 'הזמנת רכש שהתקבלה: מאושרת ב-PORDERS ונפתחת קבלה סופית מולה'],
  ['חשבוניות ספק', 'YINVOICES, PINVOICES', '←', 'סופיות, לפי ORDNAME של הזמנת הרכש → הוצאה בתיק'],
  ['הערות', 'CUSTNOTES_SUBFORM', '→', 'הערה בתיק → פעילות של הלקוח (SUBJECT)'],
  ['חשבוניות', 'AINVOICES, CINVOICES, EINVOICES', '←', 'רק סופיות (FINAL): IVNUM, IVDATE, TOTPRICE, ORDNAME → כספי התיק'],
  ['קבלות', 'TINVOICES', '←', 'רק סופיות: IVNUM, IVDATE, TOTPRICE → תשלומים בתיק. תשלום שהוקלד במערכת מקושר ולא נספר פעמיים'],
  ['פריטים ומחירים', 'LOGPART', '←', 'PARTNAME (מק״ט), BASEPLPRICE, COST, לפי UDATE'],
  ['יתרות לקוחות', 'OBLIGO', '←', 'OBLIGO, IV_DEBIT, ACC_DEBIT, ORD_DEBIT → כרטיס הלקוח'],
  ['מלאי', 'PARTBAL', '←', 'BALANCE לפי מחסן (PRIORITY_WAREHOUSES)'],
]

const streamLabel: Record<string, string> = {
  customers: 'לקוחות', contacts: 'אנשי קשר', quotes: 'הצעות מחיר', orders: 'הזמנות', suppliers: 'ספקים', purchasing: 'הזמנות רכש',
  service: 'קריאות שירות', invoices: 'חשבוניות', receipts: 'קבלות', items: 'מחירים ופריטים', balances: 'יתרות לקוחות', stock: 'מלאי',
  agents: 'סוכנים', addresses: 'כתובות', units: 'מזגנים מותקנים', files: 'קבצים', stockmoves: 'תנועות מלאי', notes: 'הערות', supplierinvoices: 'חשבוניות ספק',
}
const countLabel: Record<string, string> = { updated: 'עודכנו', added: 'נוספו', linked: 'קושרו', unmatched: 'בלי תיק', conflicts: 'התנגשויות', imported: 'יובאו' }
const runLabel = { hot: 'כל דקה: הזמנות, חשבוניות, קבלות וקריאות שירות', warm: 'כל 10 דקות: לקוחות, אנשי קשר, מחירים, יתרות, מלאי ומזגנים', full: 'סבב מלא' }

export default function PrioritySync() {
  const db = useApp((s) => s.db)
  const settings = useSettings()
  const setSettings = useApp((s) => s.setSettings)
  const [tab, setTab] = useState<'errors' | 'pending' | 'log' | 'map'>('errors')
  const [busy, setBusy] = useState('')
  const [test, setTest] = useState<{ ok: boolean; latencyMs: number; mode: string; serviceRoot: string; sample: { customers: number } } | null>(null)
  const enabled = priorityEnabled()

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    for (const c of db.customers) out.push({ kind: 'לקוח', id: c.id, name: c.name + (c.temp ? ' (זמני)' : ''), sync: c.sync, link: `/customers/${c.id}`, retry: () => pushCustomer(c) })
    for (const ct of db.contacts) if (ct.sync) out.push({ kind: 'איש קשר', id: ct.id, name: ct.name, sync: ct.sync, link: `/customers/${ct.customerId}` })
    for (const q of db.quotes) if (q.cprof) out.push({ kind: 'הצעה ב-Priority', id: q.id, name: q.number, sync: q.cprof, link: `/quotes/${q.id}` })
    for (const sp of db.suppliers) if (sp.sync) out.push({ kind: 'ספק', id: sp.id, name: sp.name, sync: sp.sync, link: `/suppliers/${sp.id}` })
    for (const po of db.purchaseOrders) if (po.sync) out.push({ kind: 'הזמנת רכש', id: po.id, name: po.number, sync: po.sync, link: `/suppliers?po=${po.id}` })
    for (const sc of db.serviceCalls) if (sc.sync) out.push({ kind: 'קריאת שירות', id: sc.id, name: sc.number, sync: sc.sync, link: `/service/${sc.id}` })
    for (const po of db.purchaseOrders) if (po.receipt) out.push({ kind: 'קבלת סחורה', id: `${po.id}-r`, name: po.number, sync: po.receipt, link: `/suppliers?po=${po.id}` })
    for (const u of db.units) if (u.sync) out.push({ kind: 'מזגן מותקן', id: u.id, name: `${u.model} · ${u.serial}`, sync: u.sync, link: `/customers/${u.customerId}` })
    for (const d of db.docs) if (d.sync) out.push({ kind: 'קובץ', id: d.id, name: d.name, sync: d.sync, link: d.caseId ? `/cases/${d.caseId}` : '/settings' })
    for (const m of db.stockMoves ?? []) if (m.sync && m.sync.status !== 'disabled') out.push({ kind: 'תנועת מלאי', id: m.id, name: `${db.catalog.find((c) => c.id === m.itemId)?.name ?? ''} × ${m.qty}${m.from ? ` · מ${m.from}` : ''}${m.to ? ` · ל${m.to}` : ''}`, sync: m.sync, link: '/inventory' })
    for (const u of db.users) if (u.agentSync) out.push({ kind: 'סוכן', id: u.id, name: u.name, sync: u.agentSync, link: '/users' })
    for (const a of db.activities) if (a.sync && a.sync.status !== 'synced') out.push({ kind: 'הערה', id: a.id, name: a.text.slice(0, 60), sync: a.sync, link: a.caseId ? `/cases/${a.caseId}` : '/' })
    for (const q of db.quotes.filter((x) => x.status === 'approved')) {
      const k = db.cases.find((x) => x.id === q.caseId)
      const cust = db.customers.find((x) => x.id === k?.customerId)
      out.push({
        kind: 'הזמנה', id: q.id, name: `${q.number} · ${k?.title ?? ''}`, sync: q.sync, link: `/quotes/${q.id}`,
        retry: async () => { if (!cust?.sync.priorityId) throw new Error('הלקוח עוד לא נפתח ב-Priority'); return pushOrder(q, cust.sync.priorityId) },
      })
    }
    for (const i of db.catalog) out.push({ kind: 'פריט', id: i.id, name: `${i.sku} · ${i.name}`, sync: i.sync, link: '/settings', retry: async () => {} })
    return out
  }, [db.customers, db.contacts, db.quotes, db.cases, db.catalog, db.suppliers, db.purchaseOrders, db.serviceCalls, db.units, db.docs, db.stockMoves, db.users, db.activities])
  const engine = serverSync()
  const engineState = db.integrations?.find((x) => x.id === 'priority')

  const count = (st: SyncState['status']) => rows.filter((r) => r.sync.status === st).length
  const errors = rows.filter((r) => r.sync.status === 'error')
  const pending = rows.filter((r) => r.sync.status === 'pending' || (r.sync.status === 'not_synced' && r.kind !== 'פריט'))
  const log = useMemo(() => db.activities.filter((a) => a.kind === 'sync').slice(0, 40), [db.activities])

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label)
    try {
      await fn()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  const table = (list: Row[]) =>
    list.length === 0 ? (
      <Empty icon={<CheckCircle2 size={34} />} title="אין רשומות כאן" />
    ) : (
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>סוג</th><th>רשומה</th><th>סטטוס</th><th className="hide-mobile">שגיאה</th><th className="hide-mobile">ניסיונות</th><th className="hide-mobile">ניסיון אחרון</th><th /></tr></thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.kind + r.id}>
                <td className="small">{r.kind}</td>
                <td className="small strong"><Link to={r.link}>{r.name}</Link></td>
                <td><Badge tone={syncTone[r.sync.status]}>{syncLabel[r.sync.status]}</Badge></td>
                <td className="small hide-mobile" style={{ color: 'var(--danger)' }}>{r.sync.error ?? ''}</td>
                <td className="small num hide-mobile">{r.sync.attempts ?? (r.sync.status === 'error' ? 1 : '—')}</td>
                <td className="tiny muted hide-mobile">{r.sync.lastSync ? relative(r.sync.lastSync) : '—'}</td>
                <td>{(r.retry || engine) && r.kind !== 'פריט' && <button className="btn sm" disabled={(!enabled && !engine) || !!busy} onClick={() => run(r.id, engine ? () => runServerSync('hot') : r.retry!)}>{busy === r.id ? '...' : 'ניסיון חוזר'}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )

  return (
    <div className="col" style={{ gap: 16 }}>
      <PageHead
        title="סנכרון Priority"
        sub="המערכת היא שכבת העבודה; Priority נשארת הנהלת החשבונות. כל לקוח, הזמנה ומחיר עוברים בלי הקלדה כפולה."
        actions={
          <>
            <button className="btn" disabled={!serverConfigured() || !!busy} onClick={() => run('test', async () => { const r = await testConnection(); setTest(r); toast.success(`מחובר (${r.latencyMs}ms)`) })}><PlugZap size={16} /> בדיקת חיבור</button>
            {engine ? (
              <button className="btn primary" disabled={!!busy} onClick={() => run('full', async () => { await runServerSync('full'); toast.success('סבב סנכרון מלא הסתיים') })}><RefreshCw size={16} /> {busy === 'full' ? 'מסנכרן...' : 'סנכרון מלא עכשיו'}</button>
            ) : (
              <>
                <button className="btn" disabled={!enabled || !!busy} onClick={() => run('prices', async () => { const r = await pullPrices(); toast.success(`נסרקו ${r.scanned} פריטים ב-Priority · ${r.matched} תואמים לקטלוג · עודכנו ${r.updated} מחירים`) })}><RefreshCw size={16} /> משיכת מחירים</button>
                <button className="btn primary" disabled={!enabled || !!busy} onClick={() => run('queue', async () => { const r = await processQueue(); if (r.writeBlocked) toast.info('הכתיבה ל-Priority חסומה בשרת (PRIORITY_ALLOW_WRITE). הרשומות נשארו בתור.'); else toast[r.failed ? 'error' : 'success'](`נשלחו ${r.done}, נכשלו ${r.failed}`) })}><Activity size={16} /> {busy === 'queue' ? 'שולח...' : 'שליחת כל הממתינים'}</button>
              </>
            )}
          </>
        }
      />

      <EngineCard state={engineState} active={!!engine} />

      {!enabled && !engine && (
        <Callout tone="warning">
          <div className="row between wrap">
            <span>
              החיבור ל-Priority כבוי{!serverConfigured() ? ' ושרת האינטגרציות לא הוגדר' : ''}. שינויים נשמרים בתור "ממתין" ויישלחו כשתחברו.
              {' '}השרת מגיע מוכן לעבודה מול סביבת הדמו הציבורית של Priority, וכתיבה אליה חסומה כברירת מחדל.
            </span>
            {serverConfigured() ? (
              <button className="btn sm" onClick={() => setSettings({ priorityMode: 'server' })}>הפעלת החיבור</button>
            ) : (
              <Link className="btn sm" to="/settings">הגדרת שרת</Link>
            )}
          </div>
        </Callout>
      )}

      <div className="grid g4">
        <Stat icon={<CheckCircle2 size={20} />} tone="success" label="מסונכרנים" value={count('synced')} />
        <Stat icon={<Clock size={20} />} tone="warning" label="ממתינים" value={pending.length} />
        <Stat icon={<AlertTriangle size={20} />} tone="danger" label="שגיאות" value={errors.length} />
        <Stat icon={<Server size={20} />} label="מצב" value={<span style={{ fontSize: 18 }}>{engine ? 'אוטומטי' : enabled ? (test ? (test.mode === 'demo' ? 'סביבת דמו' : 'חי') : 'מחובר') : 'כבוי'}</span>} delta={test ? `${test.latencyMs}ms · ${test.sample.customers} לקוחות לדוגמה` : settings.serverUrl || 'אין שרת'} />
      </div>

      <Card>
        <div style={{ padding: '0 12px' }}>
          <Tabs value={tab} onChange={setTab} items={[
            { id: 'errors', label: 'שגיאות', count: errors.length },
            { id: 'pending', label: 'ממתינים', count: pending.length },
            { id: 'log', label: 'יומן' },
            { id: 'map', label: 'מיפוי שדות' },
          ]} />
        </div>
        {tab === 'errors' && table(errors)}
        {tab === 'pending' && table(pending)}
        {tab === 'log' && (log.length === 0 ? <Empty title="אין עדיין פעולות סנכרון" /> : (
          <div className="list">
            {log.map((a) => (
              <div key={a.id} className="list-item">
                <RefreshCw size={15} className="muted" />
                <div className="grow small">{a.text}</div>
                <span className="tiny muted nowrap">{dateTime(a.at)}</span>
              </div>
            ))}
          </div>
        ))}
        {tab === 'map' && (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>במערכת</th><th>מסך ב-Priority</th><th title="→ מהמערכת ל-Priority · ← מ-Priority למערכת · ⇄ בשני הכיוונים">כיוון</th><th>שדות</th></tr></thead>
                <tbody>{mapping.map(([a, b, d, c]) => <tr key={b}><td className="small strong">{a}</td><td className="small num"><span className="ltr">{b}</span></td><td className="strong" style={{ textAlign: 'center' }}>{d}</td><td className="small">{c}</td></tr>)}</tbody>
              </table>
            </div>
            <div className="card-body tiny muted">
              המיפוי נבדק מול סביבת הדמו של Priority. אצל כל חברה יש התאמות משלה, ולכן בהטמעה עוברים עליו יחד עם מנהל המערכת של הלקוח.
              דרישות: מודול API ורישיון API למשתמש הממשק, וחבילות טרנזקציות (נקנות בחבילות של 10,000 בחודש). קצב מקסימלי: 100 קריאות בדקה למשתמש.
            </div>
          </>
        )}
      </Card>
    </div>
  )
}

// מנוע הסנכרון בשרת: מה רץ, מתי, ומה קרה בכל זרם
function EngineCard({ state, active }: { state?: IntegrationState; active: boolean }) {
  if (!active) {
    return (
      <Callout>
        <div className="col" style={{ gap: 4 }}>
          <b><Zap size={15} style={{ verticalAlign: -2 }} /> סנכרון אוטומטי בשני הכיוונים</b>
          <span className="small">
            {bridge.mode !== 'server'
              ? 'הסנכרון האוטומטי רץ בשרת, על המסד המשותף. במצב הדגמה (הנתונים בדפדפן) שולחים מכאן ידנית.'
              : 'המנוע לא פועל בשרת. כדי להפעיל, בסודות של פונקציית ה-Edge ב-Supabase: PRIORITY_SYNC=on, PRIORITY_MODE=live עם פרטי ההתחברות, ו-PRIORITY_ALLOW_WRITE=true כדי לכתוב ל-Priority.'}
            {' '}כשהוא פועל, כל שינוי במערכת נשלח ל-Priority תוך שניות, והזמנות, חשבוניות, קבלות, מחירים, יתרות ומלאי חוזרים מ-Priority לבד.
          </span>
        </div>
      </Callout>
    )
  }
  const e = state?.engine
  const streams = Object.entries(state?.streams ?? {})
  const counts = (v: Record<string, unknown>) => Object.entries(countLabel).filter(([k]) => Number(v[k]) > 0).map(([k, l]) => `${l} ${v[k]}`).join(' · ')
  return (
    <Card title={<div className="row" style={{ gap: 8 }}><ArrowLeftRight size={17} className="muted" /><h2>סנכרון אוטומטי</h2><Badge tone="success" dot>פועל</Badge></div>}
      actions={<span className="tiny muted">{e?.mode === 'live' ? 'Priority חי' : 'סביבת דמו'} · {e?.write ? 'קריאה וכתיבה' : 'קריאה בלבד'}</span>}>
      {!e?.write && <div className="card-body" style={{ paddingBottom: 0 }}><Callout tone="warning">הכתיבה ל-Priority כבויה בשרת, ולכן שום דבר לא נשלח לשם. הנתונים מ-Priority ממשיכים להגיע. להפעלה: PRIORITY_ALLOW_WRITE=true.</Callout></div>}
      {state?.lastError && <div className="card-body" style={{ paddingBottom: 0 }}><Callout tone="danger">הסבב האחרון נעצר: {state.lastError}</Callout></div>}
      <div className="card-body row wrap" style={{ gap: 18 }}>
        {(['hot', 'warm'] as const).map((k) => {
          // סבב מלא מריץ גם את זה: מציגים את האחרון מביניהם
          const own = state?.runs?.[k]
          const full = state?.runs?.full
          const r = own && (!full || own.at >= full.at) ? own : full
          return (
            <div key={k} className="small">
              <div className="muted tiny">{runLabel[k]}</div>
              {r ? <span>{r.ok ? <CheckCircle2 size={13} className="txt-success" style={{ verticalAlign: -2 }} /> : <AlertTriangle size={13} className="txt-danger" style={{ verticalAlign: -2 }} />} {relative(r.at)} · {(r.ms / 1000).toFixed(1)} שנ׳</span> : <span className="muted">עוד לא רץ</span>}
            </div>
          )
        })}
        <div className="small"><div className="muted tiny">שינוי שנשמר במערכת</div>נשלח ל-Priority תוך שניות</div>
      </div>
      {streams.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>זרם</th><th>סטטוס</th><th className="hide-mobile">בסבב האחרון</th><th>מתי</th></tr></thead>
            <tbody>
              {streams.map(([k, v]) => (
                <tr key={k}>
                  <td className="small strong">{streamLabel[k] ?? k}</td>
                  <td>{v.ok ? <Badge tone="success">תקין</Badge> : <Badge tone="danger" >{v.pausedUntil ? 'מושהה' : 'שגיאה'}</Badge>}{v.error && <div className="tiny txt-danger">{v.error}</div>}</td>
                  <td className="small hide-mobile">{counts(v) || <span className="muted">אין שינויים</span>}</td>
                  <td className="tiny muted nowrap">{relative(v.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="card-body tiny muted">
        עדכון מיידי מ-Priority: חוק עסקי ב-Priority ששולח בקשה ל-<span className="ltr">/api/priority/webhook?key=…</span> (המפתח: PRIORITY_WEBHOOK_SECRET). בלי זה, הנתונים מ-Priority מגיעים לכל המאוחר תוך דקה (כספים והזמנות) או עשר דקות (לקוחות, מחירים ומלאי).
      </div>
    </Card>
  )
}
