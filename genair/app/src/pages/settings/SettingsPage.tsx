import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Building, CalendarDays, CheckCircle2, Cloud, Copy, Download, FileText, Hash, Mic, Navigation, Package, Palette, Plug, QrCode, RefreshCw, Share2, Sparkles, Star, Sun, Upload, UserCog, Users, WifiOff, MessageCircle, Database, ListTree, Workflow,
} from 'lucide-react'
import { brand } from '../../brand'
import { useApp, useSettings } from '../../lib/store'
import { Badge, Callout, Card, Confirm, Field, PageHead, Tabs, toast } from '../../components/ui'
import { QR } from '../../components/extras'
import { categoryLabel, roleLabel, syncLabel, syncTone } from '../../lib/labels'
import { uid } from '../../lib/format'
import { health, type Health } from '../../lib/integrations/server'
import { aiMode } from '../../lib/integrations/ai'
import { pullPrices, priorityEnabled } from '../../lib/integrations/priority'
import { download } from '../../lib/integrations/links'
import { templates } from '../../lib/messaging'
import { ListsSettings } from './ListsSettings'
import { FlowSettings } from '../../features/flow/FlowSettings'
import { SyncSettingsCard } from '../../features/auth/SyncSettingsCard'
import type { CatalogItem, ItemCategory, Role, Settings } from '../../lib/types'
import { applyTheme, setConfig, themes, useThemeSync } from '../../lib/config'
import { peekCaseNumber } from '../../lib/numbering'

type Tab = 'company' | 'lists' | 'flows' | 'users' | 'catalog' | 'integrations' | 'templates' | 'data'
const days = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳']

const tabIds: Tab[] = ['company', 'lists', 'flows', 'users', 'catalog', 'integrations', 'templates', 'data']

export default function SettingsPage() {
  useThemeSync()
  const [params, setParams] = useSearchParams()
  const fromUrl = params.get('tab') as Tab | null
  const [tab, setTabState] = useState<Tab>(fromUrl && tabIds.includes(fromUrl) ? fromUrl : 'integrations')
  const setTab = (t: Tab) => {
    setTabState(t)
    const p = new URLSearchParams(params)
    p.set('tab', t)
    setParams(p, { replace: true })
  }
  useEffect(() => {
    // קישור ישיר לאזור ברשימות (#ls-caseNumbering)
    const id = window.location.hash.split('#')[2]
    if (id) setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120)
  }, [])
  return (
    <div>
      <PageHead title="הגדרות וחיבורים" sub="כל ההגדרות נשמרות בדפדפן הזה במצב הדגמה; בייצור הן נשמרות בשרת" />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'integrations', label: 'חיבורים', icon: <Plug size={15} /> },
          { id: 'company', label: 'חברה ותהליכים', icon: <Building size={15} /> },
          { id: 'lists', label: 'רשימות', icon: <ListTree size={15} /> },
          { id: 'flows', label: 'תהליכי עבודה', icon: <Workflow size={15} /> },
          { id: 'users', label: 'משתמשים והרשאות', icon: <Users size={15} /> },
          { id: 'catalog', label: 'קטלוג ומחירון', icon: <Package size={15} /> },
          { id: 'templates', label: 'תבניות הודעות', icon: <MessageCircle size={15} /> },
          { id: 'data', label: 'נתונים', icon: <Database size={15} /> },
        ]}
      />
      <div className="mt16">
        {tab === 'company' && <CompanyTab />}
        {tab === 'lists' && <ListsSettings />}
        {tab === 'flows' && <FlowSettings />}
        {tab === 'users' && <UsersTab />}
        {tab === 'catalog' && <CatalogTab />}
        {tab === 'integrations' && <IntegrationsTab />}
        {tab === 'templates' && <TemplatesTab />}
        {tab === 'data' && <DataTab />}
      </div>
    </div>
  )
}

function CompanyTab() {
  const s = useSettings()
  const set = useApp((x) => x.setSettings)
  return (
    <div className="grid g2">
      <Card title="פרטי החברה" pad>
        <div className="col small" style={{ gap: 8 }}>
          <div><span className="muted">שם: </span><b>{brand.name}</b> · {brand.nameEn}</div>
          <div><span className="muted">סלוגן: </span>{brand.slogan}</div>
          <div><span className="muted">טלפון: </span><span className="ltr">{brand.phone}</span> · <span className="muted">וואטסאפ: </span><span className="ltr">+{brand.whatsapp}</span></div>
          <div><span className="muted">אימייל: </span>{brand.email}</div>
          <div><span className="muted">כתובת: </span>{brand.address} · {brand.hours}</div>
        </div>
        <div className="tiny muted mt12">פרטי המותג מוגדרים בקובץ brand.ts, כך שאותה מערכת מתאימה גם לחברה אחרת.</div>
      </Card>
      <Card title="הצעות מחיר ותשלומים" pad>
        <div className="grid g2">
          <Field label="מע״מ (%)"><input className="input" type="number" value={s.vatPct} onChange={(e) => set({ vatPct: Number(e.target.value) })} /></Field>
          <Field label="תוקף הצעה (ימים)"><input className="input" type="number" value={s.quoteValidityDays} onChange={(e) => set({ quoteValidityDays: Number(e.target.value) })} /></Field>
          <Field label="מקדמה באישור (%)"><input className="input" type="number" value={s.depositPct} onChange={(e) => set({ depositPct: Number(e.target.value) })} /></Field>
        </div>
        <div className="small mt12">עמלות סוכנים מחושבות לפי <Link to="/settings?tab=lists#ls-commissionRules">כללי העמלות</Link> (לפי סוכן, סוג פרויקט, אחוז ובסיס החישוב).</div>
      </Card>
      <Card title="ימי ושעות עבודה" pad>
        <div className="row wrap">
          {days.map((d, i) => (
            <button key={d} className={`chip ${s.workDays.includes(i) ? 'on' : ''}`} onClick={() => set({ workDays: s.workDays.includes(i) ? s.workDays.filter((x) => x !== i) : [...s.workDays, i].sort() })}>{d}</button>
          ))}
          <span className="chip" style={{ opacity: 0.5, cursor: 'default' }}>שבת: סגור</span>
        </div>
        <div className="grid g2 mt12">
          <Field label="תחילת יום"><input className="input" type="time" value={s.workStart} onChange={(e) => set({ workStart: e.target.value })} /></Field>
          <Field label="סוף יום"><input className="input" type="time" value={s.workEnd} onChange={(e) => set({ workEnd: e.target.value })} /></Field>
        </div>
        <label className="check mt12"><input type="checkbox" checked={s.avoidHolidays} onChange={(e) => set({ avoidHolidays: e.target.checked })} /> לא לשבץ בחגים, ולסיים בשישי ובערב חג לפני כניסת השבת</label>
      </Card>
      <Card title="חוות דעת מלקוחות" pad>
        <Field label="קישור לכתיבת ביקורת בגוגל" hint="נשלח ללקוח אוטומטית בסיום התקנה. נמצא בפרופיל העסק בגוגל ← 'בקשת ביקורות'.">
          <input className="input ltr" placeholder="https://g.page/r/..." value={s.reviewUrl} onChange={(e) => set({ reviewUrl: e.target.value })} />
        </Field>
      </Card>
      <SystemCard />
    </div>
  )
}

function SystemCard() {
  const theme = useApp((x) => x.db.config.theme)
  const numbering = useApp((x) => x.db.config.caseNumbering)
  useApp((x) => x.db.counters)
  return (
    <Card title={<div className="row"><Palette size={17} /><h2>מערכת</h2></div>} pad>
      <div className="col" style={{ gap: 12 }}>
        <div>
          <div className="label mb8">ערכת צבע</div>
          <div className="row wrap" style={{ gap: 6 }}>
            {themes.map((t) => (
              <button key={t.key} className={`chip ${theme === t.key ? 'on' : ''}`} onClick={() => { setConfig({ theme: t.key }); applyTheme(t.key) }}>
                <span style={{ width: 12, height: 12, borderRadius: '50%', background: t.swatch[0], display: 'inline-block' }} /> {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="small">
          <span className="muted">מספור תיקים: </span>{numbering.mode === 'agent' ? 'לפי ראשי התיבות של הסוכן' : 'מספור רץ'} · <span className="muted">הבא בתור: </span><b className="ltr num">{peekCaseNumber()}</b>
        </div>
        <div className="small"><span className="muted">שפה ואזור זמן: </span>עברית · ירושלים (<span className="ltr">Asia/Jerusalem</span>) · ש״ח</div>
        <div className="row wrap" style={{ gap: 6 }}>
          <Link className="btn sm" to="/settings?tab=lists"><ListTree size={15} /> רשימות ומספור</Link>
          <Link className="btn sm" to="/users"><UserCog size={15} /> משתמשים</Link>
        </div>
      </div>
    </Card>
  )
}

// המשתמשים, התפקידים וההרשאות עברו למסך משתמשים (/users)
function UsersTab() {
  const users = useApp((s) => s.db.users)
  const active = users.filter((u) => u.active)
  return (
    <div className="grid g2">
      <Card title={<div className="row"><Users size={17} /><h2>משתמשים והרשאות</h2></div>} pad>
        <p className="small muted">הוספת עובדים, תפקידים, מנהלי מחלקה ומנהלי פרויקטים, הרשאות, הסמכות ויומנים אישיים מנוהלים עכשיו במסך המשתמשים.</p>
        <div className="row wrap mt12" style={{ gap: 6 }}>
          {(Object.keys(roleLabel) as Role[]).map((r) => {
            const n = active.filter((u) => u.role === r).length
            return n ? <Badge key={r} tone="muted">{roleLabel[r]} · <span className="ltr">{n}</span></Badge> : null
          })}
        </div>
        <Link className="btn primary mt16" to="/users"><UserCog size={16} /> למסך המשתמשים</Link>
      </Card>
      <Card title={<div className="row"><Hash size={17} /><h2>ראשי תיבות למספור תיקים</h2></div>} pad>
        <p className="small muted">כשהמספור הוא לפי סוכן, כל תיק מקבל את ראשי התיבות של הסוכן (למשל <span className="ltr">DM-0012</span>). משנים בהגדרות ← רשימות ← מספור תיקים.</p>
        <Link className="btn sm mt12" to="/settings?tab=lists#ls-caseNumbering">למספור תיקים</Link>
      </Card>
    </div>
  )
}

function CatalogTab() {
  const catalog = useApp((s) => s.db.catalog)
  const patch = useApp((s) => s.patch)
  const upsert = useApp((s) => s.upsert)
  const [cat, setCat] = useState<ItemCategory | ''>('')
  const [busy, setBusy] = useState(false)
  const list = useMemo(() => catalog.filter((c) => !cat || c.category === cat), [catalog, cat])
  return (
    <Card
      title="קטלוג ומחירון"
      actions={
        <>
          <button className="btn sm" disabled={busy} onClick={async () => {
            if (!priorityEnabled()) { toast.info('כדי למשוך מחירים צריך להפעיל את החיבור ל-Priority (חיבורים)'); return }
            setBusy(true)
            try { const r = await pullPrices(); toast.success(`עודכנו ${r.updated} מחירים מ-Priority`) } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
          }}><RefreshCw size={15} /> משיכת מחירים מ-Priority</button>
          <button className="btn sm primary" onClick={() => upsert('catalog', { id: uid('i'), sku: 'NEW-' + Math.floor(Math.random() * 900 + 100), name: 'פריט חדש', category: cat || 'accessory', unit: 'יח׳', price: 0, cost: 0, sync: { status: 'not_synced' }, active: true } as CatalogItem)}>+ פריט</button>
        </>
      }
    >
      <div className="row wrap" style={{ padding: '12px 18px' }}>
        <button className={`chip ${cat === '' ? 'on' : ''}`} onClick={() => setCat('')}>הכל</button>
        {(Object.keys(categoryLabel) as ItemCategory[]).map((c) => <button key={c} className={`chip ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>{categoryLabel[c]}</button>)}
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>מק״ט</th><th>שם</th><th className="hide-mobile">יחידה</th><th>מחיר</th><th>עלות</th><th className="hide-mobile">רווח</th><th className="hide-mobile">Priority</th><th>פעיל</th></tr></thead>
          <tbody>
            {list.map((i) => (
              <tr key={i.id}>
                <td><input className="input sm num ltr" style={{ width: 110 }} value={i.sku} onChange={(e) => patch('catalog', i.id, { sku: e.target.value })} /></td>
                <td><input className="input sm" style={{ minWidth: 220 }} value={i.name} onChange={(e) => patch('catalog', i.id, { name: e.target.value })} /></td>
                <td className="hide-mobile"><input className="input sm" style={{ width: 64 }} value={i.unit} onChange={(e) => patch('catalog', i.id, { unit: e.target.value })} /></td>
                <td><input className="input sm num" style={{ width: 96 }} type="number" value={i.price} onChange={(e) => patch('catalog', i.id, { price: Number(e.target.value) })} /></td>
                <td><input className="input sm num" style={{ width: 96 }} type="number" value={i.cost} onChange={(e) => patch('catalog', i.id, { cost: Number(e.target.value) })} /></td>
                <td className="small num hide-mobile">{i.price ? `${Math.round(((i.price - i.cost) / i.price) * 100)}%` : '—'}</td>
                <td className="hide-mobile"><Badge tone={syncTone[i.sync.status]}>{syncLabel[i.sync.status]}</Badge></td>
                <td><input type="checkbox" checked={i.active} onChange={(e) => patch('catalog', i.id, { active: e.target.checked })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card-body tiny muted">המחירים לפני מע״מ. ה-AI בוחר רק פריטים מהרשימה הזו, והמחיר בהצעה תמיד נלקח מכאן.</div>
    </Card>
  )
}

function Status({ on, label }: { on: boolean; label?: string }) {
  return <Badge tone={on ? 'success' : 'muted'} dot>{label ?? (on ? 'פעיל' : 'כבוי')}</Badge>
}

function IntegrationsTab() {
  const s = useSettings()
  const set = useApp((x) => x.setSettings)
  const [h, setH] = useState<Health | null>(null)
  const [checking, setChecking] = useState(false)
  const mode = aiMode()
  const requestUrl = `${window.location.href.split('#')[0]}#/request`
  const embed = `<a href="${requestUrl}" target="_blank">לקבלת הצעת מחיר</a>`

  const zero: { icon: React.ReactNode; name: string; what: string }[] = [
    { icon: <MessageCircle size={18} />, name: 'וואטסאפ בלחיצה', what: 'הודעה מוכנה ללקוח (הצעה, תיאום, "בדרך אליך", סיום) נפתחת בוואטסאפ ונרשמת בתיק' },
    { icon: <Navigation size={18} />, name: 'Waze ו-Google Maps', what: 'ניווט לכתובת בלחיצה ומפה בתוך התיק' },
    { icon: <CalendarDays size={18} />, name: 'יומן גוגל / אאוטלוק / אייפון', what: 'כל מועד נכנס ליומן בקישור או בקובץ ICS, כולל תזכורת שעה לפני' },
    { icon: <Star size={18} />, name: 'לוח שנה עברי (Hebcal)', what: 'חוסם שיבוץ בשבת ובחג, ומסיים בשישי ובערב חג לפני כניסת השבת' },
    { icon: <Sun size={18} />, name: 'תחזית מזג אוויר (Open-Meteo)', what: 'אזהרת גשם, רוח וחום ביום של התקנה חיצונית או עבודה בגובה' },
    { icon: <Mic size={18} />, name: 'הכתבה קולית בעברית', what: 'הסוכן מדבר בשטח והטקסט נכנס לסקר' },
    { icon: <QrCode size={18} />, name: 'קודי QR', what: 'לאזור האישי של הלקוח, על ההצעה ועל טופס המסירה' },
    { icon: <Share2 size={18} />, name: 'שיתוף מהנייד', what: 'שליחת קישורים ומסמכים מכל אפליקציה שמותקנת בטלפון' },
    { icon: <WifiOff size={18} />, name: 'עבודה בלי קליטה', what: 'האפליקציה נשמרת בטלפון ועובדת גם במרתף או על הגג' },
  ]

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card title={<div className="row"><CheckCircle2 size={17} color="var(--success)" /><h2>חיבורים שפועלים כבר עכשיו, בלי הגדרה</h2></div>}>
        <div className="grid g3" style={{ padding: 16 }}>
          {zero.map((z) => (
            <div key={z.name} className="row" style={{ alignItems: 'flex-start' }}>
              <span style={{ color: 'var(--brand-700)', marginTop: 2 }}>{z.icon}</span>
              <div>
                <div className="small strong">{z.name}</div>
                <div className="tiny muted">{z.what}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="טופס פניות לאתר ולרשתות" pad>
        <div className="row wrap" style={{ alignItems: 'flex-start', gap: 20 }}>
          <QR text={requestUrl} size={120} />
          <div className="grow col">
            <div className="small">קישור קבוע לטופס "השאירו פרטים". כל פנייה נפתחת כתיק חדש עם התמונות שהלקוח צירף. אפשר לשים אותו באתר, באינסטגרם, בחתימה במייל ובתשובה האוטומטית בוואטסאפ.</div>
            <div className="input ltr small" style={{ display: 'flex', alignItems: 'center', overflow: 'hidden', whiteSpace: 'nowrap' }}>{requestUrl}</div>
            <div className="row wrap">
              <button className="btn sm" onClick={() => { void navigator.clipboard.writeText(requestUrl); toast.success('הקישור הועתק') }}><Copy size={15} /> העתקת קישור</button>
              <button className="btn sm" onClick={() => { void navigator.clipboard.writeText(embed); toast.success('קוד ההטמעה הועתק') }}><FileText size={15} /> קוד לאתר</button>
              <Link className="btn sm" to="/request" target="_blank">תצוגה</Link>
            </div>
          </div>
        </div>
      </Card>

      <SyncSettingsCard />
      <Card title={<div className="row"><Cloud size={17} /><h2>שרת האינטגרציות</h2></div>} actions={<Status on={!!h?.ok} label={h?.ok ? 'מחובר' : s.serverUrl ? 'לא נבדק' : 'לא הוגדר'} />} pad>
        <p className="small muted">חיבורים שדורשים מפתח (Priority, AI, וואטסאפ עסקי, Google) עוברים דרך שרת קטן שמחזיק את המפתחות בצורה מאובטחת. הקוד שלו נמצא בתיקיית server. בלי שרת, המערכת עובדת במצב הדגמה.</p>
        <div className="grid g2 mt12">
          <Field label="כתובת השרת"><input className="input ltr" placeholder={`https://api.${brand.domain}`} value={s.serverUrl} onChange={(e) => set({ serverUrl: e.target.value.trim() })} /></Field>
          <Field label="אסימון גישה (APP_TOKEN)"><input className="input ltr" type="password" value={s.appToken} onChange={(e) => set({ appToken: e.target.value })} /></Field>
        </div>
        <div className="row wrap mt12">
          <button className="btn sm" disabled={!s.serverUrl || checking} onClick={async () => {
            setChecking(true)
            try { setH(await health()); toast.success('השרת עונה') } catch (e) { setH(null); toast.error((e as Error).message) } finally { setChecking(false) }
          }}><RefreshCw size={15} /> {checking ? 'בודק...' : 'בדיקת חיבור'}</button>
          {h && (
            <div className="row wrap small" style={{ gap: 6 }}>
              <Badge tone={h.features.priority !== 'off' ? 'success' : 'muted'}>Priority: {h.features.priority === 'demo' ? 'סביבת דמו' : h.features.priority === 'live' ? 'חי' : 'כבוי'}</Badge>
              <Badge tone={h.features.ai ? 'success' : 'muted'}>AI {h.features.ai ? 'פעיל' : 'כבוי'}</Badge>
              <Badge tone={h.features.whatsapp ? 'success' : 'muted'}>WhatsApp API {h.features.whatsapp ? 'פעיל' : 'כבוי'}</Badge>
              <Badge tone={h.features.google.calendar ? 'success' : 'muted'}>Calendar {h.features.google.calendar ? 'פעיל' : 'כבוי'}</Badge>
              <Badge tone={h.features.google.drive ? 'success' : 'muted'}>Drive {h.features.google.drive ? 'פעיל' : 'כבוי'}</Badge>
            </div>
          )}
        </div>
      </Card>

      <div className="grid g2">
        <Card title={<div className="row"><Sparkles size={17} color="var(--brand)" /><h2>AI להצעות מחיר</h2></div>} actions={<Status on={mode !== 'demo'} label={mode === 'server' ? 'דרך השרת' : mode === 'browser' ? 'מפתח בדפדפן' : 'מנוע מקומי'} />} pad>
          <Field label="מודל">
            <select className="select" value={s.aiModel} onChange={(e) => set({ aiModel: e.target.value as Settings['aiModel'] })}>
              <option value="claude-opus-5-5">Claude Opus 5.5 — הכי מדויק</option>
              <option value="claude-sonnet-5-5">Claude Sonnet 5.5 — זול יותר בחצי</option>
            </select>
          </Field>
          <Field label="מפתח API לבדיקה (רק בדפדפן הזה)" hint="לשימוש בהדגמה בלבד. בייצור המפתח נשמר בשרת ולא בדפדפן." className="mt12">
            <input className="input ltr" type="password" placeholder="sk-ant-..." value={s.anthropicKey} onChange={(e) => set({ anthropicKey: e.target.value.trim() })} />
          </Field>
          <div className="tiny muted mt12">בלי מפתח, הטיוטה נבנית במנוע חישוב מקומי לפי שטח, גובה תקרה וחשיפה לשמש. עם מפתח, ה-AI גם מנתח את תמונות הסקר. עלות משוערת: כ-7 עד 13 סנט להצעה.</div>
        </Card>
        <Card title={<div className="row"><MessageCircle size={17} color="#25d366" /><h2>וואטסאפ</h2></div>} actions={<Status on label={s.whatsappMode === 'link' ? 'בלחיצה' : 'WhatsApp Business API'} />} pad>
          <div className="col">
            <label className="check"><input type="radio" checked={s.whatsappMode === 'link'} onChange={() => set({ whatsappMode: 'link' })} /> <span><b>בלחיצה (מומלץ להתחלה)</b><div className="tiny muted">נפתח וואטסאפ עם הודעה מוכנה. בלי עלות ובלי אישור של Meta.</div></span></label>
            <label className="check"><input type="radio" checked={s.whatsappMode === 'cloud_api'} onChange={() => set({ whatsappMode: 'cloud_api' })} /> <span><b>שליחה אוטומטית מהמספר העסקי</b><div className="tiny muted">דורש שרת, אימות עסק ב-Meta ותבניות מאושרות. תשלום לפי הודעה.</div></span></label>
          </div>
          {s.whatsappMode === 'cloud_api' && !s.serverUrl && <div className="mt12"><Callout tone="warning">צריך להגדיר שרת אינטגרציות כדי לשלוח אוטומטית.</Callout></div>}
        </Card>
        <Card title={<div className="row"><CalendarDays size={17} /><h2>יומן גוגל ו-Drive</h2></div>} actions={<Status on label={s.googleMode === 'link' ? 'קישורים' : 'סנכרון מלא'} />} pad>
          <div className="col">
            <label className="check"><input type="radio" checked={s.googleMode === 'link'} onChange={() => set({ googleMode: 'link' })} /> <span><b>קישורים וקבצי יומן</b><div className="tiny muted">כל מועד אפשר להוסיף ליומן בלחיצה. לא צריך הרשאות.</div></span></label>
            <label className="check"><input type="radio" checked={s.googleMode === 'api'} onChange={() => set({ googleMode: 'api' })} /> <span><b>סנכרון מלא דרך השרת</b><div className="tiny muted">אירועים נכנסים ליומן המתקין לבד, ולכל תיק נפתחת תיקייה ב-Drive. דורש חשבון שירות של Google Workspace.</div></span></label>
          </div>
        </Card>
        <Card title={<div className="row"><RefreshCw size={17} /><h2>Priority</h2></div>} actions={<Status on={s.priorityMode === 'server'} label={s.priorityMode === 'server' ? 'מחובר דרך השרת' : 'כבוי'} />} pad>
          <label className="check"><input type="checkbox" checked={s.priorityMode === 'server'} onChange={(e) => set({ priorityMode: e.target.checked ? 'server' : 'off' })} /> סנכרון לקוחות, מחירים והזמנות דרך השרת</label>
          <div className="tiny muted mt12">כשהחיבור כבוי, כל שינוי נשמר בתור "ממתין" ונשלח כשמחברים. לחיבור לחברה אמיתית צריך רישיון API מ-Priority, שהלקוח רוכש.</div>
          <Link className="btn sm mt12" to="/settings/priority">מסך סנכרון ואבחון</Link>
        </Card>
      </div>
    </div>
  )
}

function TemplatesTab() {
  return (
    <Card title="תבניות הודעות">
      <div className="list">
        {Object.entries(templates).filter(([k]) => k !== 'free').map(([k, t]) => (
          <div key={k} className="list-item" style={{ alignItems: 'flex-start' }}>
            <MessageCircle size={16} color="#25d366" style={{ marginTop: 3 }} />
            <div className="grow">
              <div className="small strong">{t.label}</div>
              <div className="small muted">{t.text}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="card-body tiny muted">המשתנים בסוגריים מתמלאים לבד. בשליחה אוטומטית דרך WhatsApp Business, כל תבנית צריכה אישור של Meta פעם אחת.</div>
    </Card>
  )
}

function DataTab() {
  const db = useApp((s) => s.db)
  const reset = useApp((s) => s.resetDemo)
  const [confirm, setConfirm] = useState(false)
  const counts: [string, number][] = [
    ['לקוחות', db.customers.length], ['תיקים', db.cases.length], ['הצעות', db.quotes.length], ['מועדים', db.appointments.length], ['קריאות שירות', db.serviceCalls.length], ['יחידות', db.units.length], ['חוזים', db.contracts.length],
  ]
  return (
    <div className="grid g2">
      <Card title="מה שמור במערכת" pad>
        <div className="grid g2 small">{counts.map(([l, n]) => <div key={l}><span className="muted">{l}: </span><b>{n}</b></div>)}</div>
        <div className="tiny muted mt12">במצב הדגמה הנתונים נשמרים בדפדפן הזה בלבד. בייצור הם נשמרים בשרת, עם גיבוי יומי.</div>
      </Card>
      <Card title="גיבוי ושחזור" pad>
        <div className="row wrap">
          <button className="btn sm" onClick={() => download(new Blob([JSON.stringify(db, null, 1)], { type: 'application/json' }), `genair-backup-${new Date().toISOString().slice(0, 10)}.json`)}><Download size={15} /> ייצוא גיבוי</button>
          <label className="btn sm"><Upload size={15} /> שחזור מגיבוי<input type="file" accept="application/json" hidden onChange={async (e) => {
            const f = e.target.files?.[0]
            if (!f) return
            try {
              const data = JSON.parse(await f.text())
              if (!Array.isArray(data.cases) || !Array.isArray(data.customers)) throw new Error()
              useApp.setState({ db: data })
              toast.success('הנתונים שוחזרו')
            } catch { toast.error('הקובץ לא תקין') }
          }} /></label>
          <button className="btn sm danger" onClick={() => setConfirm(true)}>איפוס נתוני ההדגמה</button>
        </div>
        <div className="tiny muted mt12">הגיבוי הוא קובץ JSON אחד עם כל הנתונים, כולל תמונות.</div>
      </Card>
      {confirm && <Confirm title="איפוס נתוני ההדגמה" text="כל השינויים שעשיתם יימחקו והנתונים יחזרו למצב ההתחלתי." confirmLabel="איפוס" danger onConfirm={() => { reset(); toast.success('הנתונים אופסו') }} onClose={() => setConfirm(false)} />}
    </div>
  )
}
