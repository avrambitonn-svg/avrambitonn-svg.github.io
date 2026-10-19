// שדות קטנים למסכי הניהול: מתג, בחירת צבע, שדה טקסט שנשמר ביציאה, דירוג כוכבים
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Star } from 'lucide-react'
import './controls.css'

export function Switch({ checked, onChange, label, title, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; title?: string; disabled?: boolean }) {
  return (
    <label className={`sw ${disabled ? 'dis' : ''}`} title={title}>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="sw-track" aria-hidden><span className="sw-knob" /></span>
      {label && <span className="sw-label">{label}</span>}
    </label>
  )
}

export const palette = ['#00aeef', '#2563eb', '#1e3a8a', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#0f766e', '#64748b', '#334155']

export function ColorPick({ value, onChange, label = 'צבע' }: { value?: string; onChange: (c: string) => void; label?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', off)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', off)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  return (
    <div className="cp" ref={ref}>
      <button type="button" className="cp-dot" style={{ background: value || '#e4e8ec' }} onClick={() => setOpen((o) => !o)} aria-label={label} title={label} />
      {open && (
        <div className="cp-pop" role="dialog" aria-label={label}>
          {palette.map((c) => (
            <button key={c} type="button" className={`cp-sw ${c === value ? 'on' : ''}`} style={{ background: c }} onClick={() => { onChange(c); setOpen(false) }} aria-label={c} />
          ))}
          <label className="cp-custom" title="צבע אחר">
            <input type="color" defaultValue={value || '#00aeef'} onBlur={(e) => e.target.value !== value && onChange(e.target.value)} />
            <span>אחר</span>
          </label>
        </div>
      )}
    </div>
  )
}

// שדה טקסט שנשמר כשיוצאים ממנו או לוחצים Enter (בלי כתיבה למסד בכל הקשה)
export function CommitInput({ value, onCommit, className = 'input sm', placeholder, ariaLabel, type = 'text', style }: { value: string; onCommit: (v: string) => void; className?: string; placeholder?: string; ariaLabel?: string; type?: string; style?: React.CSSProperties }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  const commit = () => {
    if (v !== value) onCommit(v)
  }
  return (
    <input className={className} style={style} type={type} value={v} placeholder={placeholder} aria-label={ariaLabel} onChange={(e) => setV(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setV(value) }} />
  )
}

export function Stars({ value = 0, onChange, size = 16 }: { value?: number; onChange?: (v: number) => void; size?: number }) {
  return (
    <span className="stars" aria-label={`דירוג ${value} מתוך 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" disabled={!onChange} className={n <= value ? 'on' : ''} onClick={() => onChange?.(n === value ? 0 : n)} aria-label={`${n} כוכבים`}>
          <Star size={size} fill={n <= value ? 'currentColor' : 'none'} />
        </button>
      ))}
    </span>
  )
}

export function Dot({ color, size = 9 }: { color?: string; size?: number }) {
  return <span className="cdot" style={{ background: color || '#94a3b8', width: size, height: size }} />
}
