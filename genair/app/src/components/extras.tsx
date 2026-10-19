import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { Mic, MicOff, MessageCircle, Navigation, Phone } from 'lucide-react'
import { speechSupported, startDictation } from '../lib/integrations/speech'
import { telLink, wazeLink } from '../lib/integrations/links'
import type { Address } from '../lib/types'
import { toast } from './ui'

export function QR({ text, size = 140 }: { text: string; size?: number }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    QRCode.toDataURL(text, { margin: 1, width: size * 2, color: { dark: '#1c2127', light: '#ffffff' } }).then(setSrc).catch(() => setSrc(''))
  }, [text, size])
  return src ? <img src={src} width={size} height={size} alt="קוד QR" style={{ borderRadius: 8 }} /> : null
}

// כפתור הכתבה קולית: מוסיף את הטקסט לשדה
export function Dictate({ onText, label = 'הכתבה' }: { onText: (t: string) => void; label?: string }) {
  const [on, setOn] = useState(false)
  const stop = useRef<() => void>(() => {})
  if (!speechSupported()) return null
  return (
    <button
      type="button"
      className={`btn sm ${on ? 'primary' : ''}`}
      onClick={() => {
        if (on) {
          stop.current()
          setOn(false)
          return
        }
        setOn(true)
        stop.current = startDictation(
          (finalText) => finalText && onText(finalText),
          (err) => {
            setOn(false)
            if (err) toast.error(err)
          },
        )
      }}
    >
      {on ? <MicOff size={15} /> : <Mic size={15} />}
      {on ? 'עצירה' : label}
    </button>
  )
}

export function QuickContact({ phone, address, whatsapp }: { phone?: string; address?: Address; whatsapp?: () => void }) {
  return (
    <div className="row wrap">
      {phone && (
        <a className="btn sm" href={telLink(phone)}>
          <Phone size={15} /> חיוג
        </a>
      )}
      {whatsapp && (
        <button className="btn sm wa" onClick={whatsapp}>
          <MessageCircle size={15} /> וואטסאפ
        </button>
      )}
      {address && (
        <a className="btn sm" href={wazeLink(address)} target="_blank" rel="noreferrer">
          <Navigation size={15} /> ניווט
        </a>
      )}
    </div>
  )
}
