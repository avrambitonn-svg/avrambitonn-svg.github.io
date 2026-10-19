// התראות דפדפן (בלי צליל) על התראות חדשות למשתמש המחובר, רק כשהלשונית ברקע; ומספר על סמל האפליקציה
import { useEffect, useRef } from 'react'
import type { Notification as AppNotification } from '../types'
import { brand } from '../../brand'

export const browserNotifySupported = () => typeof window !== 'undefined' && 'Notification' in window
export const browserNotifyPermission = (): NotificationPermission | 'unsupported' => (browserNotifySupported() ? Notification.permission : 'unsupported')

export async function requestBrowserNotify(): Promise<NotificationPermission | 'unsupported'> {
  if (!browserNotifySupported()) return 'unsupported'
  try {
    return await Notification.requestPermission()
  } catch {
    return Notification.permission
  }
}

type Nav = { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }

function setBadge(n: number) {
  const nav = navigator as unknown as Nav
  try {
    if (n > 0) void nav.setAppBadge?.(n)?.catch(() => {})
    else void nav.clearAppBadge?.()?.catch(() => {})
  } catch {
    /* לא נתמך */
  }
}

/** list = ההתראות של המשתמש המחובר. open(link) נקרא כשלוחצים על התראת הדפדפן. */
export function useNotificationAlerts(list: AppNotification[], open: (link?: string) => void) {
  const seen = useRef<Set<string> | null>(null)
  const openRef = useRef(open)
  openRef.current = open
  useEffect(() => {
    setBadge(list.filter((n) => !n.read).length)
    if (!seen.current) {
      seen.current = new Set(list.map((n) => n.id)) // מה שכבר היה כשהמסך נפתח לא קופץ
      return
    }
    const fresh = list.filter((n) => !seen.current!.has(n.id))
    fresh.forEach((n) => seen.current!.add(n.id))
    if (!fresh.length || !document.hidden || browserNotifyPermission() !== 'granted') return
    fresh
      .filter((n) => !n.read && Date.now() - Date.parse(n.at) < 15 * 60_000)
      .slice(0, 3)
      .forEach((n) => {
        try {
          const shown = new Notification(brand.name, { body: n.text, tag: n.id, silent: true, icon: './favicon.svg', lang: 'he', dir: 'rtl' })
          shown.onclick = () => {
            window.focus()
            openRef.current(n.link)
            shown.close()
          }
        } catch {
          /* דפדפנים בנייד דורשים service worker להתראות; שם מסתפקים במספר על הפעמון */
        }
      })
  }, [list])
}
