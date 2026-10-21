// מסמכים בתיקיות (משרד, לקוח, מתקין...). משמש בתיק, ואפשר גם ללקוח או לספק.
// גוררים קבצים לתיקייה (כמה בבת אחת), רואים התקדמות, מציגים תמונה או PDF, מורידים, מעבירים בין תיקיות ומוחקים.
// במצב הדגמה הקבצים בדפדפן; במסד המשותף בשרת, ואם Drive מחובר — גם בתיקיית התיק ב-Google Drive.
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { Download, Eye, EyeOff, ExternalLink, FileImage, FileText, FolderInput, FolderOpen, FolderPlus, Pencil, Trash2, Upload } from 'lucide-react'
import { useApp, useMe } from '../../lib/store'
import { useConfig } from '../../lib/config'
import { Callout, Confirm, Modal, Progress, toast } from '../../components/ui'
import { date, nowIso, uid } from '../../lib/format'
import { deleteLocalBlob, docBlob, downloadDoc, externalLink, filesOnServer, hasContent, isImage, isPdf, maxFileBytes, saveLocalBlob, sizeLabel, uploadToServer } from '../../lib/files'
import { createDriveFolder, ensureCaseFolder, googleApiMode, moveDriveFile, trashDriveFile, uploadToDrive } from '../../lib/integrations/google'
import type { Doc, ID, ListOption } from '../../lib/types'
import { safeHref } from '../../lib/integrations/links'
import './docs.css'

const DOC_MIME = 'application/x-genair-doc'
const OTHER = '__other'
const legacyVisible = (d: Doc) => d.folder === 'customer' || (d.folder === 'installer' && /מסירה|אחריות|הוראות/.test(d.name))
export const docVisibleToCustomer = (d: Doc) => d.customerVisible ?? legacyVisible(d)

interface Upload {
  id: string
  name: string
  folder: string
  pct: number
  error?: string
}

export function DocsPanel({ caseId, customerId, supplierId }: { caseId?: ID; customerId?: ID; supplierId?: ID }) {
  const me = useMe()
  const all = useApp((s) => s.db.docs)
  const users = useApp((s) => s.db.users)
  const kase = useApp((s) => (caseId ? s.db.cases.find((k) => k.id === caseId) : undefined))
  const upsert = useApp((s) => s.upsert)
  const patch = useApp((s) => s.patch)
  const remove = useApp((s) => s.remove)
  const log = useApp((s) => s.log)
  const setConfig = useApp((s) => s.setConfig)
  const folderList = useConfig((c) => c.driveFolders)
  const googleMode = useApp((s) => s.settings.googleMode)
  const docs = useMemo(
    () => all.filter((d) => (caseId ? d.caseId === caseId : supplierId ? d.supplierId === supplierId : d.customerId === customerId)).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)),
    [all, caseId, customerId, supplierId],
  )
  const folders = useMemo(() => folderList.filter((f) => f.active), [folderList])
  const strays = useMemo(() => docs.filter((d) => !folders.some((f) => f.key === d.folder)), [docs, folders])
  const [uploads, setUploads] = useState<Upload[]>([])
  const [drag, setDrag] = useState('')
  const [preview, setPreview] = useState<Doc | null>(null)
  const [del, setDel] = useState<Doc | null>(null)
  const [renaming, setRenaming] = useState('')
  const drive = googleMode === 'api' && googleApiMode() && !!caseId
  const isAdmin = me.role === 'admin'
  const nameOf = (id?: ID) => users.find((u) => u.id === id)?.name.split(' ')[0]
  const labelOf = (key: string) => folderList.find((f) => f.key === key)?.label ?? key

  const setUp = (id: string, p: Partial<Upload>) => setUploads((list) => list.map((u) => (u.id === id ? { ...u, ...p } : u)))

  async function uploadFiles(files: File[], folder: string) {
    const limit = maxFileBytes()
    for (const file of files) {
      if (file.size > limit) {
        toast.error(`${file.name}: גדול מ-${Math.round(limit / 1024 / 1024)}MB`)
        continue
      }
      const id = uid('d')
      setUploads((l) => [...l, { id, name: file.name, folder, pct: 0 }])
      try {
        let doc: Doc = { id, folder, name: file.name, mime: file.type || 'application/octet-stream', size: file.size, uploadedAt: nowIso(), uploadedBy: me.id, caseId, customerId, supplierId }
        if (filesOnServer()) {
          const driveFolderId = drive && caseId ? await ensureCaseFolder(caseId, folder) : undefined
          const r = await uploadToServer(file, { caseId, folder, driveFolderId }, (pct) => setUp(id, { pct }))
          doc = { ...doc, fileId: r.fileId, driveFileId: r.driveFileId ?? undefined, webViewLink: r.webViewLink ?? undefined }
          if (r.driveError) toast.info(`${file.name} נשמר בשרת, אבל לא עלה ל-Drive`)
        } else {
          doc.blobKey = await saveLocalBlob(id, file)
          setUp(id, { pct: drive ? 50 : 100 })
          const folderId = drive && caseId ? await ensureCaseFolder(caseId, folder) : undefined
          if (folderId) {
            try {
              const r = await uploadToDrive(file, folderId)
              doc = { ...doc, driveFileId: r.id, webViewLink: r.webViewLink }
            } catch {
              toast.info(`${file.name} נשמר בדפדפן, אבל לא עלה ל-Drive`)
            }
          }
        }
        for (const k of Object.keys(doc) as (keyof Doc)[]) if (doc[k] === undefined) delete doc[k]
        upsert('docs', doc)
        if (caseId) log({ kind: 'document', caseId, text: `הועלה מסמך ל${labelOf(folder)}: ${file.name}` })
        setUploads((l) => l.filter((u) => u.id !== id))
      } catch (e) {
        setUp(id, { error: (e as Error).message || 'ההעלאה נכשלה' })
      }
    }
  }

  async function move(d: Doc, to: string) {
    if (d.folder === to) return
    patch('docs', d.id, { folder: to })
    if (caseId) log({ kind: 'document', caseId, text: `${d.name}: הועבר מ${labelOf(d.folder)} ל${labelOf(to)}` })
    toast.success(`הועבר ל${labelOf(to)}`)
    if (d.driveFileId && drive && caseId) {
      try {
        const target = await ensureCaseFolder(caseId, to)
        if (target) await moveDriveFile(d.driveFileId, kase?.driveFolders?.[d.folder], target)
      } catch {
        toast.info('הקובץ הועבר במערכת; ב-Drive צריך להעביר ידנית')
      }
    }
  }

  async function confirmDelete(d: Doc) {
    remove('docs', d.id)
    if (caseId) log({ kind: 'document', caseId, text: `נמחק מסמך: ${d.name}` })
    await deleteLocalBlob(d)
    if (d.driveFileId) await trashDriveFile(d.driveFileId).catch(() => {})
  }

  const onDrop = (folder: string) => (e: DragEvent) => {
    e.preventDefault()
    setDrag('')
    const docId = e.dataTransfer.getData(DOC_MIME)
    if (docId) {
      const d = docs.find((x) => x.id === docId)
      if (d) void move(d, folder)
      return
    }
    const files = Array.from(e.dataTransfer.files ?? [])
    if (files.length) void uploadFiles(files, folder)
  }

  const groups: (ListOption & { list: Doc[] })[] = [
    ...folders.map((f) => ({ ...f, list: docs.filter((d) => d.folder === f.key) })),
    ...(strays.length ? [{ key: OTHER, label: 'אחר', color: '#94a3b8', active: true, list: strays }] : []),
  ]

  return (
    <div className="col" style={{ gap: 16 }}>
      <Callout>
        <div className="row wrap between" style={{ gap: 8 }}>
          <span style={{ flex: '1 1 260px', minWidth: 0 }}>
            {filesOnServer() ? 'הקבצים נשמרים בשרת, וכל הצוות רואה אותם.' : <>במצב הדגמה הקבצים נשמרים בדפדפן הזה (עד <span className="ltr">25MB</span> לקובץ).</>}
            {drive ? ' הם עולים גם לתיקיית התיק ב-Google Drive.' : filesOnServer() ? ' כשמחברים את Google Drive, לכל תיק נפתחת תיקייה עם אותן תיקיות משנה.' : ''}
            {' '}גוררים קבצים לתיקייה, או לוחצים על "העלאה".
          </span>
          {drive && safeHref(kase?.driveFolderUrl) && <a className="btn sm" href={safeHref(kase?.driveFolderUrl)} target="_blank" rel="noreferrer"><ExternalLink size={14} /> התיקייה ב-Drive</a>}
          {drive && kase && !kase.driveFolderId && <button className="btn sm" onClick={() => void createDriveFolder(kase).then(() => toast.success('נפתחה תיקייה ב-Drive'))}><FolderPlus size={14} /> פתיחת תיקייה ב-Drive</button>}
        </div>
      </Callout>

      {uploads.length > 0 && (
        <section className="card">
          {uploads.map((u) => (
            <div key={u.id} className="dp-up">
              <Upload size={16} className="muted" />
              <div className="grow">
                <div className="small strong truncate">{u.name} <span className="tiny muted">← {labelOf(u.folder)}</span></div>
                {u.error ? <div className="tiny" style={{ color: 'var(--danger)' }}>{u.error}</div> : <Progress value={u.pct} />}
              </div>
              {u.error && <button className="btn sm ghost" onClick={() => setUploads((l) => l.filter((x) => x.id !== u.id))}>סגירה</button>}
            </div>
          ))}
        </section>
      )}

      <div className="grid g3">
        {groups.map((g) => (
          <section
            key={g.key}
            className={`card dp-folder ${drag === g.key ? 'drag' : ''}`}
            onDragOver={(e) => {
              if (g.key === OTHER) return
              e.preventDefault()
              setDrag(g.key)
            }}
            onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDrag('')}
            onDrop={g.key === OTHER ? undefined : onDrop(g.key)}
          >
            <div className="card-head">
              <div className="row" style={{ minWidth: 0, gap: 8 }}>
                <span className="dp-ico" style={{ background: `color-mix(in srgb, ${g.color ?? 'var(--brand)'} 14%, white)`, color: g.color ?? 'var(--brand)' }}><FolderOpen size={16} /></span>
                {renaming === g.key ? (
                  <input
                    className="input dp-label-input"
                    defaultValue={g.label}
                    autoFocus
                    aria-label="שם התיקייה"
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    onBlur={(e) => {
                      const label = e.target.value.trim()
                      if (label && label !== g.label) setConfig({ driveFolders: folderList.map((f) => (f.key === g.key ? { ...f, label } : f)) })
                      setRenaming('')
                    }}
                  />
                ) : (
                  <h2>{g.label}</h2>
                )}
                <span className="badge muted">{g.list.length}</span>
                {isAdmin && g.key !== OTHER && renaming !== g.key && <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => setRenaming(g.key)} aria-label={`שינוי שם התיקייה ${g.label}`}><Pencil size={13} /></button>}
              </div>
              {g.key !== OTHER && <FolderUpload onFiles={(f) => void uploadFiles(f, g.key)} />}
            </div>
            {g.list.length === 0 ? (
              <div className="dp-drop"><b>ריק.</b> אפשר לגרור לכאן קבצים</div>
            ) : (
              <div>
                {g.list.map((d) => (
                  <DocRow
                    key={d.id}
                    d={d}
                    who={nameOf(d.uploadedBy)}
                    folders={folders}
                    caseScope={!!caseId}
                    onPreview={() => setPreview(d)}
                    onMove={(to) => void move(d, to)}
                    onToggleVisible={() => patch('docs', d.id, { customerVisible: !docVisibleToCustomer(d) })}
                    onDelete={() => setDel(d)}
                  />
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
      {preview && <Preview d={preview} onClose={() => setPreview(null)} />}
      {del && <Confirm title="מחיקת מסמך" text={`למחוק את "${del.name}"?${del.driveFileId ? ' הקובץ יעבור גם לפח ב-Drive.' : ''}`} confirmLabel="מחיקה" danger onConfirm={() => void confirmDelete(del)} onClose={() => setDel(null)} />}
    </div>
  )
}

function FolderUpload({ onFiles }: { onFiles: (files: File[]) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <>
      <button className="btn sm ghost" onClick={() => ref.current?.click()}><Upload size={15} /> העלאה</button>
      <input
        ref={ref}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          if (files.length) onFiles(files)
          e.target.value = ''
        }}
      />
    </>
  )
}

function DocRow({ d, who, folders, caseScope, onPreview, onMove, onToggleVisible, onDelete }: {
  d: Doc; who?: string; folders: ListOption[]; caseScope: boolean; onPreview: () => void; onMove: (to: string) => void; onToggleVisible: () => void; onDelete: () => void
}) {
  const content = hasContent(d)
  const visible = docVisibleToCustomer(d)
  const Icon = isImage(d.mime) ? FileImage : FileText
  return (
    <div className="dp-row" draggable onDragStart={(e) => { e.dataTransfer.setData(DOC_MIME, d.id); e.dataTransfer.effectAllowed = 'move' }}>
      <Icon size={17} className="muted" style={{ flex: 'none' }} />
      <div className="grow">
        <button className={`dp-name ${content ? '' : 'off'}`} onClick={content ? onPreview : undefined} title={d.name}>{d.name}</button>
        <div className="tiny muted">
          {date(d.uploadedAt)}
          {d.size ? <> · <span className="ltr">{sizeLabel(d.size)}</span></> : null}
          {d.source === 'portal' ? ' · מהלקוח' : who ? ` · ${who}` : ''}
          {!content ? ' · קובץ לדוגמה' : ''}
          {d.driveFileId ? ' · Drive' : ''}
        </div>
      </div>
      <div className="dp-acts">
        {caseScope && (
          <button className="icon-btn" onClick={onToggleVisible} aria-pressed={visible} aria-label={visible ? 'מוצג ללקוח באזור האישי. לחיצה מסתירה' : 'לא מוצג ללקוח. לחיצה מציגה באזור האישי'} title={visible ? 'מוצג ללקוח' : 'פנימי'}>
            {visible ? <Eye size={15} color="var(--success)" /> : <EyeOff size={15} />}
          </button>
        )}
        <label className="dp-move" title="העברה לתיקייה אחרת">
          <FolderInput size={15} />
          <select value={d.folder} onChange={(e) => onMove(e.target.value)} aria-label="העברה לתיקייה">
            {!folders.some((f) => f.key === d.folder) && <option value={d.folder}>אחר</option>}
            {folders.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </label>
        {content && <button className="icon-btn" onClick={() => void downloadDoc(d).catch((e) => toast.error((e as Error).message))} aria-label={`הורדת ${d.name}`}><Download size={15} /></button>}
        <button className="icon-btn" onClick={onDelete} aria-label={`מחיקת ${d.name}`}><Trash2 size={15} /></button>
      </div>
    </div>
  )
}

function Preview({ d, onClose }: { d: Doc; onClose: () => void }) {
  const [url, setUrl] = useState('')
  const [err, setErr] = useState('')
  const link = safeHref(externalLink(d))
  const viewable = isImage(d.mime) || isPdf(d.mime)
  useEffect(() => {
    if (link || !viewable) return
    let objectUrl = ''
    let alive = true
    docBlob(d)
      .then((b) => {
        if (!alive) return
        if (!b) return setErr('אין קובץ שמור למסמך הזה')
        // הסוג נקבע לפי מה שמוצג (תמונה או PDF), לא לפי הקובץ: קובץ HTML שמתחזה ל-PDF לא ירוץ בתוך האפליקציה
        objectUrl = URL.createObjectURL(new Blob([b], { type: isImage(d.mime) ? d.mime : 'application/pdf' }))
        setUrl(objectUrl)
      })
      .catch((e) => alive && setErr((e as Error).message))
    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [d, link, viewable])
  return (
    <Modal
      title={d.name}
      size="wide"
      onClose={onClose}
      footer={
        <>
          {link && <a className="btn" href={link} target="_blank" rel="noreferrer"><ExternalLink size={15} /> פתיחה</a>}
          {!link && <button className="btn" onClick={() => void downloadDoc(d).catch((e) => toast.error((e as Error).message))}><Download size={15} /> הורדה</button>}
          <button className="btn primary" onClick={onClose}>סגירה</button>
        </>
      }
    >
      <div className="dp-preview">
        {err ? <div className="empty small">{err}</div>
          : link ? <div className="empty small">הקובץ נמצא בקישור חיצוני (Drive). פותחים אותו בלשונית חדשה.</div>
          : !viewable ? <div className="empty small">אין תצוגה מקדימה לסוג הקובץ הזה. אפשר להוריד אותו.</div>
          : !url ? <div className="empty small">טוען...</div>
          : isImage(d.mime) ? <img src={url} alt={d.name} />
          : <iframe src={url} title={d.name} />}
      </div>
    </Modal>
  )
}
