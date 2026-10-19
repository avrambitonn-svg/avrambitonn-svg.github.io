import { useEffect, useRef, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import { AlertTriangle, CheckCircle2, Info, X, XCircle, Inbox } from 'lucide-react'
import type { Tone } from '../lib/labels'
import { initials } from '../lib/format'
import type { User } from '../lib/types'

export function Card({ title, actions, children, className = '', pad = false, onClick }: { title?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string; pad?: boolean; onClick?: () => void }) {
  return (
    <section className={`card ${onClick ? 'link' : ''} ${className}`} onClick={onClick}>
      {(title || actions) && (
        <div className="card-head">
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {pad ? <div className="card-body">{children}</div> : children}
    </section>
  )
}

export function Badge({ tone = 'neutral', children, dot }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  return <span className={`badge ${tone} ${dot ? 'dot' : ''}`}>{children}</span>
}

export function Stat({ icon, label, value, delta, tone = 'brand', onClick }: { icon: ReactNode; label: string; value: ReactNode; delta?: ReactNode; tone?: 'brand' | 'success' | 'warning' | 'danger' | 'violet'; onClick?: () => void }) {
  const bg: Record<string, [string, string]> = {
    brand: ['var(--brand-50)', 'var(--brand-700)'],
    success: ['var(--success-50)', 'var(--success)'],
    warning: ['var(--warning-50)', 'var(--warning)'],
    danger: ['var(--danger-50)', 'var(--danger)'],
    violet: ['var(--violet-50)', 'var(--violet)'],
  }
  return (
    <div className={`card stat ${onClick ? 'link' : ''}`} onClick={onClick}>
      <div className="ico" style={{ background: bg[tone][0], color: bg[tone][1] }}>{icon}</div>
      <div className="grow">
        <div className="lbl">{label}</div>
        <div className="val">{value}</div>
        {delta && <div className="delta">{delta}</div>}
      </div>
    </div>
  )
}

export function PageHead({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {actions && <div className="row wrap">{actions}</div>}
    </div>
  )
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon ?? <Inbox size={36} />}
      <div className="strong" style={{ color: 'var(--text-2)' }}>{title}</div>
      {children && <div className="small mt8">{children}</div>}
    </div>
  )
}

export function Avatar({ user, size }: { user?: Pick<User, 'name' | 'color'>; size?: 'lg' }) {
  if (!user) return null
  return (
    <span className={`avatar ${size ?? ''}`} style={{ background: user.color }} title={user.name}>
      {initials(user.name)}
    </span>
  )
}

export function Avatars({ users }: { users: (Pick<User, 'name' | 'color'> | undefined)[] }) {
  return <span className="avatars">{users.filter(Boolean).map((u, i) => <Avatar key={i} user={u} />)}</span>
}

export function Field({ label, hint, children, className = '' }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`field ${className}`}>
      <span>{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  )
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: ReactNode; count?: number; icon?: ReactNode }[] }) {
  return (
    <div className="tabs" role="tablist">
      {items.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={`tab ${value === t.id ? 'active' : ''}`} onClick={() => onChange(t.id)}>
          {t.icon}
          {t.label}
          {t.count !== undefined && t.count > 0 && <span className="n">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function Modal({ title, onClose, children, footer, size }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: 'wide' | 'narrow' }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${size ?? ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="סגירה"><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

export function Callout({ tone, icon, children }: { tone?: 'warning' | 'danger' | 'success'; icon?: ReactNode; children: ReactNode }) {
  const Ico = tone === 'danger' ? XCircle : tone === 'warning' ? AlertTriangle : tone === 'success' ? CheckCircle2 : Info
  return (
    <div className={`callout ${tone ?? ''}`}>
      {icon ?? <Ico size={18} />}
      <div className="grow small">{children}</div>
    </div>
  )
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="progress">
      <div style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}

// ---------- הודעות קופצות ----------
interface Toast { id: number; text: string; kind: 'success' | 'error' | 'info' }
const useToasts = create<{ list: Toast[]; push: (t: Omit<Toast, 'id'>) => void; drop: (id: number) => void }>((set) => ({
  list: [],
  push: (t) => {
    const id = Date.now() + Math.random()
    set((s) => ({ list: [...s.list, { ...t, id }] }))
    setTimeout(() => set((s) => ({ list: s.list.filter((x) => x.id !== id) })), 3800)
  },
  drop: (id) => set((s) => ({ list: s.list.filter((x) => x.id !== id) })),
}))

export const toast = {
  success: (text: string) => useToasts.getState().push({ text, kind: 'success' }),
  error: (text: string) => useToasts.getState().push({ text, kind: 'error' }),
  info: (text: string) => useToasts.getState().push({ text, kind: 'info' }),
}

export function Toaster() {
  const { list, drop } = useToasts()
  return (
    <div className="toasts" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => drop(t.id)}>
          {t.kind === 'success' ? <CheckCircle2 size={18} /> : t.kind === 'error' ? <XCircle size={18} /> : <Info size={18} />}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  )
}

// ---------- חתימה דיגיטלית ----------
export function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const dirty = useRef(false)

  useEffect(() => {
    const c = ref.current!
    const ratio = window.devicePixelRatio || 1
    c.width = c.offsetWidth * ratio
    c.height = c.offsetHeight * ratio
    const ctx = c.getContext('2d')!
    ctx.scale(ratio, ratio)
    ctx.lineWidth = 2.4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#1c2127'
  }, [])

  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top] as const
  }

  return (
    <div className="col">
      <canvas
        ref={ref}
        className="sig"
        onPointerDown={(e) => {
          drawing.current = true
          ref.current!.setPointerCapture(e.pointerId)
          const ctx = ref.current!.getContext('2d')!
          const [x, y] = pos(e)
          ctx.beginPath()
          ctx.moveTo(x, y)
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return
          const ctx = ref.current!.getContext('2d')!
          const [x, y] = pos(e)
          ctx.lineTo(x, y)
          ctx.stroke()
          dirty.current = true
        }}
        onPointerUp={() => {
          drawing.current = false
          if (dirty.current) onChange(ref.current!.toDataURL('image/png'))
        }}
      />
      <div className="row between">
        <span className="tiny muted">חתמו באצבע או בעכבר בתוך המסגרת</span>
        <button
          type="button"
          className="btn sm ghost"
          onClick={() => {
            const c = ref.current!
            c.getContext('2d')!.clearRect(0, 0, c.width, c.height)
            dirty.current = false
            onChange(null)
          }}
        >
          ניקוי
        </button>
      </div>
    </div>
  )
}

// ---------- צילום/העלאת תמונות (עם הקטנה, כדי לא למלא את האחסון) ----------
export async function compressImage(file: File, max = 1600, quality = 0.82): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
    const c = document.createElement('canvas')
    c.width = Math.round(img.naturalWidth * scale)
    c.height = Math.round(img.naturalHeight * scale)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', quality)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function PhotoInput({ onAdd, label = 'צילום / העלאה', multiple = true }: { onAdd: (dataUrls: string[]) => void; label?: string; multiple?: boolean }) {
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  return (
    <>
      <button type="button" className="photo-add" onClick={() => ref.current?.click()} disabled={busy}>
        <span>{busy ? 'מעבד...' : `+ ${label}`}</span>
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        multiple={multiple}
        hidden
        onChange={async (e) => {
          const files = Array.from(e.target.files ?? [])
          if (!files.length) return
          setBusy(true)
          try {
            onAdd(await Promise.all(files.map((f) => compressImage(f))))
          } catch {
            toast.error('לא הצלחנו לקרוא את התמונה')
          } finally {
            setBusy(false)
            e.target.value = ''
          }
        }}
      />
    </>
  )
}

export function Confirm({ title, text, confirmLabel = 'אישור', danger, onConfirm, onClose }: { title: string; text: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal
      title={title}
      size="narrow"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>ביטול</button>
          <button className={`btn ${danger ? 'danger' : 'primary'}`} onClick={() => { onConfirm(); onClose() }}>{confirmLabel}</button>
        </>
      }
    >
      <p>{text}</p>
    </Modal>
  )
}
