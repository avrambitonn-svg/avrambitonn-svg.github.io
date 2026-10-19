// קבצי מסמכים: במצב הדגמה הקובץ נשמר ב-IndexedDB של הדפדפן (מפתח משלו, לא בתוך המאגר),
// במצב משותף הוא עולה לשרת (ומשם לתיקיית התיק ב-Drive כשמחובר). כאן גם הורדה ותצוגה מקדימה.
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval'
import type { Doc } from './types'
import { bridge } from './sync/bridge'
import { serverBase, useSession } from './sync/session'
import { download } from './integrations/links'

export const LOCAL_MAX_BYTES = 25 * 1024 * 1024
export const SERVER_MAX_BYTES = 25 * 1024 * 1024

export const filesOnServer = () => bridge.mode === 'server'
export const maxFileBytes = () => (filesOnServer() ? SERVER_MAX_BYTES : LOCAL_MAX_BYTES)

export const blobKeyFor = (docId: string) => `genair-file:${docId}`

export async function saveLocalBlob(docId: string, file: Blob): Promise<string> {
  const key = blobKeyFor(docId)
  await idbSet(key, file)
  return key
}

export interface UploadResult {
  fileId: string
  name: string
  mime: string
  size: number
  driveFileId?: string
  webViewLink?: string
  driveError?: string
}

/** העלאה לשרת עם התקדמות (XHR, כי ל-fetch אין התקדמות העלאה) */
export function uploadToServer(file: File, opts: { caseId?: string; folder?: string; driveFolderId?: string }, onProgress?: (pct: number) => void): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${serverBase()}/api/files`)
    const token = useSession.getState().token
    if (token) xhr.setRequestHeader('authorization', `Bearer ${token}`)
    xhr.setRequestHeader('content-type', file.type || 'application/octet-stream')
    xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name))
    if (opts.caseId) xhr.setRequestHeader('x-case-id', opts.caseId)
    if (opts.folder) xhr.setRequestHeader('x-folder', opts.folder)
    if (opts.driveFolderId) xhr.setRequestHeader('x-drive-folder-id', opts.driveFolderId)
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100))
    xhr.onerror = () => reject(new Error('אין חיבור לשרת'))
    xhr.onload = () => {
      let body: { error?: { message?: string } } & Partial<UploadResult> = {}
      try {
        body = JSON.parse(xhr.responseText)
      } catch {
        /* */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as UploadResult)
      else reject(new Error(body.error?.message ?? `העלאה נכשלה (${xhr.status})`))
    }
    xhr.send(file)
  })
}

/** תוכן הקובץ של מסמך, אם יש (מקומי, בשרת או מוטמע). קישור חיצוני בלבד = null. */
export async function docBlob(d: Doc): Promise<Blob | null> {
  if (d.blobKey) {
    const b = await idbGet<Blob>(d.blobKey).catch(() => undefined)
    if (b) return b
  }
  if (d.fileId && serverBase()) {
    const res = await fetch(`${serverBase()}/api/files/${encodeURIComponent(d.fileId)}`, { headers: { authorization: `Bearer ${useSession.getState().token ?? ''}` } })
    if (!res.ok) throw new Error(res.status === 404 ? 'הקובץ לא נמצא בשרת' : 'ההורדה נכשלה')
    return res.blob()
  }
  if (d.dataUrl) return (await fetch(d.dataUrl)).blob()
  return null
}

export const hasContent = (d: Doc) => Boolean(d.blobKey || d.fileId || d.dataUrl || d.url || d.webViewLink)
export const externalLink = (d: Doc) => (!d.blobKey && !d.fileId && !d.dataUrl ? d.url ?? d.webViewLink : undefined)

export async function downloadDoc(d: Doc) {
  const link = externalLink(d)
  if (link) return void window.open(link, '_blank', 'noopener')
  const b = await docBlob(d)
  if (!b) throw new Error('אין קובץ שמור למסמך הזה')
  download(b, d.name)
}

/** מוחק את התוכן המקומי (ההגדרה של המסמך נמחקת במאגר) */
export async function deleteLocalBlob(d: Doc) {
  if (d.blobKey) await idbDel(d.blobKey).catch(() => {})
}

export const isImage = (mime: string) => /^image\//.test(mime)
export const isPdf = (mime: string) => mime === 'application/pdf'

export function sizeLabel(bytes?: number) {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}
