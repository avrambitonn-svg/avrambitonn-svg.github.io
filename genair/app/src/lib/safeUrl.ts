// Links that come from data (a supplier's website, a document's address, a Drive folder, a notification) are only ever
// clicked if their scheme is a safe one. "javascript:", "data:text/html" and the like would run code with the user's
// session. The server drops them when they are saved (server/src/http.js safeUrl); this is the same rule on the screen,
// for what was saved before and for data that comes from another source.

/** A link that is safe to put in an href / window.open, or undefined. */
export function safeHref(value?: string | null): string | undefined {
  if (typeof value !== 'string') return undefined
  const s = value.trim()
  // eslint-disable-next-line no-control-regex
  if (!s || s.length > 2048 || /[\u0000-\u001f\u007f\s]/.test(s)) return undefined
  if (/^(https?:\/\/|mailto:|tel:)/i.test(s)) return s
  if (/^[/#]/.test(s) && !s.startsWith('//')) return s
  if (/^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?$/i.test(s)) return `https://${s}`
  return undefined
}

/** An image / file source made by the app itself (a blob or a data URL of an image or PDF). Anything else is refused. */
export function safeMediaSrc(value?: string | null): string | undefined {
  if (typeof value !== 'string') return undefined
  if (/^blob:/i.test(value)) return value
  if (/^data:(image\/(png|jpe?g|gif|webp|avif|bmp)|application\/pdf);base64,[A-Za-z0-9+/=]+$/i.test(value)) return value
  return safeHref(value)
}

/** Opens an external link in a new tab without giving it access to this one. Does nothing for an unsafe link. */
export function openSafe(value?: string | null): boolean {
  const href = safeHref(value)
  if (!href) return false
  window.open(href, '_blank', 'noopener,noreferrer')
  return true
}

/** An app path ("/cases/k1") from data such as a notification; anything else is ignored. */
export function appPath(value?: string | null): string | undefined {
  return typeof value === 'string' && /^\/[A-Za-z0-9/_?=&.%-]{0,200}$/.test(value) ? value : undefined
}
