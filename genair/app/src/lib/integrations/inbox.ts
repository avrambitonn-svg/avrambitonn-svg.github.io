// הודעות וואטסאפ נכנסות (רק במצב WhatsApp Business API): נמשכות מהשרת ומשויכות ללקוח ולתיק הפתוח שלו
import { useEffect } from 'react'
import { app, useApp } from '../store'
import { api, serverConfigured } from './server'
import { intlPhone } from '../format'
import type { Message } from '../types'

interface InboxItem { id: string; from: string; name?: string; text?: string; at: string; type: string }

const CURSOR = 'genair-wa-cursor'

async function poll() {
  const s = app()
  if (s.settings.whatsappMode !== 'cloud_api' || !serverConfigured()) return
  const since = localStorage.getItem(CURSOR) ?? new Date(Date.now() - 3600_000).toISOString()
  try {
    const res = await api<{ items: InboxItem[]; cursor?: string }>(`/api/whatsapp/inbox?since=${encodeURIComponent(since)}`)
    for (const m of res.items) {
      if (!m.text || s.db.messages.some((x) => x.id === `wa-${m.id}`)) continue
      const cust = s.db.customers.find((c) => intlPhone(c.phone) === intlPhone(m.from))
      const kase = cust && s.db.cases.filter((k) => k.customerId === cust.id && !['closed', 'lost'].includes(k.stage)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
      const msg: Message = { id: `wa-${m.id}`, customerId: cust?.id, caseId: kase?.id, channel: 'whatsapp', direction: 'in', body: m.text, at: m.at, status: 'read' }
      s.upsert('messages', msg)
      const to = kase?.agentId ?? s.db.users.find((u) => u.role === 'office')?.id
      if (to) s.notify(to, `וואטסאפ מ${cust?.name ?? m.name ?? m.from}: ${m.text.slice(0, 60)}`, kase ? `/cases/${kase.id}` : '/customers')
      if (!cust) s.log({ kind: 'message', text: `הודעה ממספר לא מוכר (${m.from}): ${m.text.slice(0, 60)}` })
    }
    localStorage.setItem(CURSOR, res.cursor ?? new Date().toISOString())
  } catch {
    /* ננסה שוב בסבב הבא */
  }
}

export function useInboxPolling() {
  const mode = useApp((s) => s.settings.whatsappMode)
  const server = useApp((s) => s.settings.serverUrl)
  useEffect(() => {
    if (mode !== 'cloud_api' || !server) return
    void poll()
    const t = setInterval(poll, 45_000)
    return () => clearInterval(t)
  }, [mode, server])
}
