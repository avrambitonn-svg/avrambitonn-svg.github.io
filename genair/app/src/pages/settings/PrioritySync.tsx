import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, AlertTriangle, CheckCircle2, Clock, PlugZap, RefreshCw, Server } from 'lucide-react'
import { useApp, useSettings } from '../../lib/store'
import { Badge, Callout, Card, Empty, PageHead, Stat, Tabs, toast } from '../../components/ui'
import { syncLabel, syncTone } from '../../lib/labels'
import { dateTime, relative } from '../../lib/format'
import { processQueue, pullPrices, priorityEnabled, pushCustomer, pushOrder, testConnection } from '../../lib/integrations/priority'
import { serverConfigured } from '../../lib/integrations/server'
import type { SyncState } from '../../lib/types'

interface Row { kind: 'לקוח' | 'הצעה / הזמנה' | 'פריט'; id: string; name: string; sync: SyncState; link: string; retry: () => Promise<unknown> }

const mapping: [string, string, string][] = [
  ['לקוחות', 'CUSTOMERS', 'CUSTNAME (מספר), CUSTDES (שם), PHONE, EMAIL, ADDRESS, STATE (עיר), VATNUM (ח״פ)'],
  ['פריטים ומחירים', 'LOGPART', 'PARTNAME (מק״ט), PARTDES (תיאור), BASEPLPRICE (מחיר בסיס)'],
  ['מחירונים', 'PRICELIST', 'PLNAME, PLDES, CODE (מטבע)'],
  ['הצעות מחיר', 'CPROF + CPROFITEMS_SUBFORM', 'CUSTNAME, DETAILS; שורות: PARTNAME, TQUANT, PRICE'],
  ['הזמנות', 'ORDERS + ORDERITEMS_SUBFORM', 'CUSTNAME, REFERENCE (מספר ההצעה), DETAILS; שורות כמו בהצעה'],
]

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
    for (const q of db.quotes.filter((x) => x.status === 'approved')) {
      const k = db.cases.find((x) => x.id === q.caseId)
      const cust = db.customers.find((x) => x.id === k?.customerId)
      out.push({
        kind: 'הצעה / הזמנה', id: q.id, name: `${q.number} · ${k?.title ?? ''}`, sync: q.sync, link: `/quotes/${q.id}`,
        retry: async () => { if (!cust?.sync.priorityId) throw new Error('הלקוח עוד לא נפתח ב-Priority'); return pushOrder(q, cust.sync.priorityId) },
      })
    }
    for (const i of db.catalog) out.push({ kind: 'פריט', id: i.id, name: `${i.sku} · ${i.name}`, sync: i.sync, link: '/settings', retry: async () => {} })
    return out
  }, [db.customers, db.quotes, db.cases, db.catalog])

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
                <td>{r.kind !== 'פריט' && <button className="btn sm" disabled={!enabled || !!busy} onClick={() => run(r.id, r.retry)}>{busy === r.id ? '...' : 'ניסיון חוזר'}</button>}</td>
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
            <button className="btn" disabled={!enabled || !!busy} onClick={() => run('prices', async () => { const r = await pullPrices(); toast.success(`נסרקו ${r.scanned} פריטים ב-Priority · ${r.matched} תואמים לקטלוג · עודכנו ${r.updated} מחירים`) })}><RefreshCw size={16} /> משיכת מחירים</button>
            <button className="btn primary" disabled={!enabled || !!busy} onClick={() => run('queue', async () => { const r = await processQueue(); if (r.writeBlocked) toast.info('הכתיבה ל-Priority חסומה בשרת (PRIORITY_ALLOW_WRITE). הרשומות נשארו בתור.'); else toast[r.failed ? 'error' : 'success'](`נשלחו ${r.done}, נכשלו ${r.failed}`) })}><Activity size={16} /> {busy === 'queue' ? 'שולח...' : 'שליחת כל הממתינים'}</button>
          </>
        }
      />

      {!enabled && (
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
        <Stat icon={<Server size={20} />} label="מצב" value={<span style={{ fontSize: 18 }}>{enabled ? (test ? (test.mode === 'demo' ? 'סביבת דמו' : 'חי') : 'מחובר') : 'כבוי'}</span>} delta={test ? `${test.latencyMs}ms · ${test.sample.customers} לקוחות לדוגמה` : settings.serverUrl || 'אין שרת'} />
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
                <thead><tr><th>במערכת</th><th>מסך ב-Priority</th><th>שדות</th></tr></thead>
                <tbody>{mapping.map(([a, b, c]) => <tr key={b}><td className="small strong">{a}</td><td className="small num"><span className="ltr">{b}</span></td><td className="small">{c}</td></tr>)}</tbody>
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
