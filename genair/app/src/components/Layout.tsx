import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Bell, Boxes, Building2, CalendarDays, ClipboardList, FileSignature, FolderKanban, HardHat, LayoutDashboard, Menu, RefreshCw, Search, Settings, Users, Wrench, BarChart3, Eye,
  ListChecks, Palmtree, Truck, UserCog, ChevronsLeft, ChevronsRight, PlayCircle,
} from 'lucide-react'
import { brand } from '../brand'
import { useApp, useMe } from '../lib/store'
import { roleLabel, stageLabel } from '../lib/labels'
import type { Role } from '../lib/types'
import { relative } from '../lib/format'
import { ChatWidget } from '../features/chat/ChatWidget'
import { UserMenu } from '../features/auth/UserMenu'
import { useReminders } from '../features/tasks/reminders'
import { useThemeSync } from '../lib/config'
import { startDemo } from '../features/demo/DemoPlayer'
import { forecast, weatherIcon, type DayForecast } from '../lib/integrations/weather'
import { useInboxPolling } from '../lib/integrations/inbox'
import { bridge } from '../lib/sync/bridge'
import { useNotificationAlerts } from '../lib/sync/notify'

interface NavItem { to: string; label: string; icon: ReactNode; roles?: Role[]; count?: (s: ReturnType<typeof useApp.getState>) => number }

const nav: { group: string; items: NavItem[] }[] = [
  {
    group: 'עבודה שוטפת',
    items: [
      { to: '/', label: 'דשבורד', icon: <LayoutDashboard size={18} /> },
      { to: '/cases', label: 'תיקים ופרויקטים', icon: <FolderKanban size={18} />, roles: ['admin', 'office', 'agent', 'engineer'] },
      { to: '/calendar', label: 'לוח זמנים', icon: <CalendarDays size={18} /> },
      { to: '/tasks', label: 'משימות', icon: <ListChecks size={18} />, count: (s) => s.db.tasks.filter((t) => !t.done && (t.assigneeId === s.currentUserId || t.sharedWith?.includes(s.currentUserId)) && !!t.due && t.due <= new Date().toISOString().slice(0, 10)).length },
      { to: '/field', label: 'אפליקציית שטח', icon: <HardHat size={18} /> },
      { to: '/leave', label: 'אישורי חופשה', icon: <Palmtree size={18} />, count: (s) => (['admin', 'office'].includes(s.db.users.find((u) => u.id === s.currentUserId)?.role ?? '') ? s.db.leaves.filter((l) => l.status === 'pending').length : 0) },
    ],
  },
  {
    group: 'לקוחות ושירות',
    items: [
      { to: '/customers', label: 'לקוחות', icon: <Users size={18} />, roles: ['admin', 'office', 'agent', 'engineer'] },
      { to: '/service', label: 'קריאות שירות', icon: <Wrench size={18} />, count: (s) => s.db.serviceCalls.filter((x) => x.status === 'new').length },
      { to: '/contracts', label: 'חוזים ותחזוקה', icon: <FileSignature size={18} />, roles: ['admin', 'office', 'agent'] },
      { to: '/projects', label: 'בנייה רוויה', icon: <Building2 size={18} />, roles: ['admin', 'office', 'agent', 'engineer'] },
    ],
  },
  {
    group: 'תפעול וניהול',
    items: [
      { to: '/inventory', label: 'מלאי', icon: <Boxes size={18} />, roles: ['admin', 'office', 'installer'] },
      { to: '/suppliers', label: 'ספקים', icon: <Truck size={18} />, roles: ['admin', 'office', 'engineer'] },
      { to: '/users', label: 'משתמשים', icon: <UserCog size={18} />, roles: ['admin', 'office'] },
      { to: '/reports', label: 'דוחות', icon: <BarChart3 size={18} />, roles: ['admin', 'office'] },
      { to: '/settings', label: 'הגדרות וחיבורים', icon: <Settings size={18} />, roles: ['admin', 'office'] },
      { to: '/settings/priority', label: 'סנכרון Priority', icon: <RefreshCw size={18} />, roles: ['admin', 'office'] },
    ],
  },
]

const titles: [RegExp, string][] = [
  [/^\/$/, 'דשבורד'],
  [/^\/cases\/new/, 'תיק חדש'],
  [/^\/cases/, 'תיקים ופרויקטים'],
  [/^\/quotes/, 'הצעת מחיר'],
  [/^\/calendar/, 'לוח זמנים'],
  [/^\/field/, 'אפליקציית שטח'],
  [/^\/customers/, 'לקוחות'],
  [/^\/service/, 'קריאות שירות'],
  [/^\/contracts/, 'חוזים ותחזוקה'],
  [/^\/projects/, 'בנייה רוויה'],
  [/^\/inventory/, 'מלאי'],
  [/^\/reports/, 'דוחות'],
  [/^\/tasks/, 'משימות'],
  [/^\/leave/, 'אישורי חופשה'],
  [/^\/suppliers/, 'ספקים'],
  [/^\/users/, 'משתמשים'],
  [/^\/settings\/priority/, 'סנכרון Priority'],
  [/^\/settings/, 'הגדרות וחיבורים'],
]

export function Wordmark() {
  return (
    <div className="wordmark">
      <b><span>{brand.nameEn.slice(0, 1)}</span>{brand.nameEn.slice(1)}</b>
      <small>{brand.tagline}</small>
    </div>
  )
}

function GlobalSearch() {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const nav = useNavigate()
  const db = useApp((s) => s.db)
  const results = useMemo(() => {
    const t = q.trim()
    if (t.length < 2) return []
    const has = (s?: string) => !!s && s.toLowerCase().includes(t.toLowerCase())
    const digits = t.replace(/\D/g, '')
    const phoneHit = (p?: string) => digits.length >= 3 && !!p && p.replace(/\D/g, '').includes(digits)
    const out: { to: string; title: string; sub: string }[] = []
    db.cases.forEach((k) => {
      const c = db.customers.find((x) => x.id === k.customerId)
      if (has(k.title) || has(k.number) || has(c?.name) || phoneHit(c?.phone)) out.push({ to: `/cases/${k.id}`, title: k.title, sub: `${k.number} · ${stageLabel[k.stage]}` })
    })
    db.customers.forEach((c) => {
      if (has(c.name) || phoneHit(c.phone)) out.push({ to: `/customers/${c.id}`, title: c.name, sub: `לקוח · ${c.phone}` })
    })
    db.serviceCalls.forEach((s) => {
      const c = db.customers.find((x) => x.id === s.customerId)
      if (has(s.number) || has(s.description) || has(c?.name)) out.push({ to: `/service/${s.id}`, title: s.description, sub: `${s.number} · ${c?.name ?? ''}` })
    })
    return out.slice(0, 8)
  }, [q, db])

  return (
    <div style={{ position: 'relative' }} className="grow" onBlur={() => setTimeout(() => setOpen(false), 150)}>
      <div className="search">
        <Search size={16} />
        <input placeholder="חיפוש תיק, לקוח, טלפון או קריאה..." value={q} onChange={(e) => { setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)} />
      </div>
      {open && results.length > 0 && (
        <div className="card" style={{ position: 'absolute', top: 44, insetInline: 0, zIndex: 30, maxWidth: 480 }}>
          <div className="list">
            {results.map((r) => (
              <button key={r.to + r.title} className="list-item click" style={{ border: 0, background: 'none', textAlign: 'start', width: '100%' }} onMouseDown={() => { nav(r.to); setQ(''); setOpen(false) }}>
                <div className="grow">
                  <div className="strong truncate">{r.title}</div>
                  <div className="tiny muted">{r.sub}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Notifications() {
  const me = useMe()
  const all = useApp((s) => s.db.notifications)
  const list = useMemo(() => all.filter((n) => n.userId === me.id).sort((a, b) => b.at.localeCompare(a.at)), [all, me.id])
  const patch = useApp((s) => s.patch)
  const [open, setOpen] = useState(false)
  const nav = useNavigate()
  const unread = list.filter((n) => !n.read).length
  // התראה חדשה (גם ממשתמש אחר, דרך הסנכרון): התראת דפדפן כשהלשונית ברקע, ומספר על סמל האפליקציה
  useNotificationAlerts(list, (link) => link && nav(link))
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  return (
    <div style={{ position: 'relative' }}>
      <button className="icon-btn" onClick={() => setOpen((v) => !v)} aria-label="התראות">
        <Bell size={19} />
        {unread > 0 && <span className="dot">{unread}</span>}
      </button>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 25 }} onClick={() => setOpen(false)} />
          <div className="card" style={{ position: 'absolute', top: 46, insetInlineEnd: 0, width: 340, zIndex: 30, maxHeight: 420, overflowY: 'auto' }}>
            <div className="card-head">
              <h2>התראות</h2>
              {unread > 0 && <button className="btn sm ghost" onClick={() => list.forEach((n) => !n.read && patch('notifications', n.id, { read: true }))}>סימון הכל כנקרא</button>}
            </div>
            {list.length === 0 && <div className="empty small">אין התראות</div>}
            <div className="list">
              {list.slice(0, 20).map((n) => (
                <button key={n.id} className="list-item click" style={{ border: 0, background: n.read ? 'none' : '#f2fbff', textAlign: 'start', width: '100%' }}
                  onClick={() => { patch('notifications', n.id, { read: true }); setOpen(false); if (n.link) nav(n.link) }}>
                  <div className="grow">
                    <div className="small" style={{ fontWeight: n.read ? 400 : 700 }}>{n.text}</div>
                    <div className="tiny muted">{relative(n.at)}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function RoleSwitcher() {
  const users = useApp((s) => s.db.users)
  const me = useMe()
  const setUser = useApp((s) => s.setUser)
  const nav = useNavigate()
  // במסד המשותף התפקיד נקבע לפי המשתמש המחובר
  if (bridge.mode === 'server') return null
  return (
    <label className="row hide-mobile" title="תצוגה לפי משתמש ותפקיד (הדגמה)" style={{ gap: 6 }}>
      <Eye size={16} className="muted" />
      <select
        className="select sm"
        style={{ width: 'auto', borderRadius: 999 }}
        value={me.id}
        onChange={(e) => {
          setUser(e.target.value)
          const u = users.find((x) => x.id === e.target.value)
          nav(u?.role === 'installer' ? '/field' : '/')
        }}
      >
        {users.map((u) => (
          <option key={u.id} value={u.id}>{u.name} · {roleLabel[u.role]}</option>
        ))}
      </select>
    </label>
  )
}

function WeatherChip() {
  const [f, setF] = useState<DayForecast | null>(null)
  useEffect(() => { forecast().then((d) => setF(d[0] ?? null)) }, [])
  if (!f) return null
  return (
    <span className="chip hide-mobile" title={`ירושלים היום: ${f.tMin}°–${f.tMax}°, סיכוי לגשם ${f.rainProb}%`}>
      {weatherIcon(f.code)} {f.tMax}° {f.rainProb >= 40 ? `· גשם ${f.rainProb}%` : ''}
    </span>
  )
}

export function Layout() {
  const me = useMe()
  const loc = useLocation()
  const state = useApp()
  const [open, setOpen] = useState(false)
  useEffect(() => setOpen(false), [loc.pathname])
  useInboxPolling()
  useReminders()
  useThemeSync()
  // תפריט מכווץ במחשב: נשמר בדפדפן
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('genair-nav') === 'min' } catch { return false } })
  const toggleNav = () => setCollapsed((c) => { try { localStorage.setItem('genair-nav', c ? 'full' : 'min') } catch { /* פרטי */ } return !c })
  const title = titles.find(([re]) => re.test(loc.pathname))?.[1] ?? ''

  return (
    <div className={`shell ${collapsed ? 'collapsed' : ''}`}>
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="logo"><Wordmark /></div>
        <button className="collapse-btn" onClick={toggleNav} aria-label={collapsed ? 'הרחבת התפריט' : 'כיווץ התפריט'} title={collapsed ? 'הרחבת התפריט' : 'כיווץ התפריט'}>
          {collapsed ? <ChevronsLeft size={16} /> : <ChevronsRight size={16} />}
        </button>
        {nav.map((g) => {
          const items = g.items.filter((i) => !i.roles || i.roles.includes(me.role))
          if (!items.length) return null
          return (
            <div key={g.group}>
              <div className="nav-group">{g.group}</div>
              {items.map((i) => {
                const n = i.count?.(state) ?? 0
                return (
                  <NavLink key={i.to} to={i.to} end={i.to === '/' || i.to === '/settings'} title={collapsed ? i.label : undefined} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                    {i.icon}
                    <span>{i.label}</span>
                    {n > 0 && <span className="count">{n}</span>}
                  </NavLink>
                )
              })}
            </div>
          )
        })}
        <div className="sidebar-foot">
          <UserMenu />
        </div>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}

      <div className="main">
        <header className="topbar no-print">
          <button className="icon-btn show-mobile" onClick={() => setOpen(true)} aria-label="תפריט"><Menu size={20} /></button>
          <div className="title">{title}</div>
          <GlobalSearch />
          <button className="btn sm ghost hide-mobile demo-launch" onClick={() => startDemo()} title="הדגמה מודרכת של כל המערכת"><PlayCircle size={16} /> הדגמה</button>
          <WeatherChip />
          <RoleSwitcher />
          <Notifications />
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>

      <ChatWidget />

      <nav className="mobile-nav no-print">
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}><LayoutDashboard size={20} />ראשי</NavLink>
        {me.role === 'installer' ? (
          <NavLink to="/field" className={({ isActive }) => (isActive ? 'active' : '')}><HardHat size={20} />היום שלי</NavLink>
        ) : (
          <NavLink to="/cases" className={({ isActive }) => (isActive ? 'active' : '')}><FolderKanban size={20} />תיקים</NavLink>
        )}
        <NavLink to="/calendar" className={({ isActive }) => (isActive ? 'active' : '')}><CalendarDays size={20} />לו״ז</NavLink>
        <NavLink to="/service" className={({ isActive }) => (isActive ? 'active' : '')}><Wrench size={20} />שירות</NavLink>
        {me.role === 'installer' ? (
          <NavLink to="/inventory" className={({ isActive }) => (isActive ? 'active' : '')}><Boxes size={20} />מלאי</NavLink>
        ) : (
          <NavLink to="/customers" className={({ isActive }) => (isActive ? 'active' : '')}><ClipboardList size={20} />לקוחות</NavLink>
        )}
      </nav>
    </div>
  )
}
