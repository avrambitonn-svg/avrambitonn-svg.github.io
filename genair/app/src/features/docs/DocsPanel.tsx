// מסמכים בתיקיות (משרד, לקוח, מתקין...). משמש בתיק, ואפשר גם ללקוח או לספק.
import { useMemo, useState } from 'react'
import { FileText, FolderOpen, Trash2, Upload } from 'lucide-react'
import { useApp, useMe } from '../../lib/store'
import { Callout, Card, toast } from '../../components/ui'
import { date, nowIso, uid } from '../../lib/format'
import type { Doc, ID } from '../../lib/types'

const folderLabel: Record<string, string> = { office: 'משרד', customer: 'מהלקוח', installer: 'מתקינים', engineering: 'הנדסה', suppliers: 'ספקים', archive: 'ארכיון' }

export function DocsPanel({ caseId, customerId, supplierId }: { caseId?: ID; customerId?: ID; supplierId?: ID }) {
  const me = useMe()
  const all = useApp((s) => s.db.docs)
  const upsert = useApp((s) => s.upsert)
  const remove = useApp((s) => s.remove)
  const log = useApp((s) => s.log)
  const docs = useMemo(
    () => all.filter((d) => (caseId ? d.caseId === caseId : supplierId ? d.supplierId === supplierId : d.customerId === customerId)),
    [all, caseId, customerId, supplierId],
  )
  const [folder, setFolder] = useState<Doc['folder']>('office')

  const add = (d: Doc) => {
    upsert('docs', { ...d, caseId, customerId, supplierId, uploadedBy: me.id })
    if (caseId) log({ kind: 'document', caseId, text: `הועלה מסמך: ${d.name}` })
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      <Callout>מסמכים נשמרים בתיק. כשהשרת מחובר ל-Google Drive, לכל תיק נפתחת תיקייה עם אותן תיקיות משנה.</Callout>
      <div className="grid g3">
        {Object.keys(folderLabel).map((f) => {
          const list = docs.filter((d) => d.folder === f)
          return (
            <Card key={f} title={<div className="row"><FolderOpen size={16} color="var(--brand)" /><h2>{folderLabel[f]}</h2><span className="badge muted">{list.length}</span></div>}
              actions={<label className="btn sm ghost" onClick={() => setFolder(f)}><Upload size={15} /><input type="file" hidden onChange={async (e) => {
                const file = e.target.files?.[0]
                if (!file) return
                const small = file.size < 1_500_000
                const dataUrl = small ? await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(file) }) : undefined
                add({ id: uid('d'), folder, name: file.name, mime: file.type || 'application/octet-stream', size: file.size, dataUrl, uploadedAt: nowIso() })
                if (!small) toast.info('קובץ גדול: נשמר שם הקובץ. בייצור הקובץ עצמו עולה ל-Drive.')
                e.target.value = ''
              }} /></label>}>
              {list.length === 0 ? <div className="empty small" style={{ padding: 18 }}>ריק</div> : (
                <div className="list">
                  {list.map((d) => (
                    <div key={d.id} className="list-item">
                      <FileText size={16} className="muted" />
                      <div className="grow">
                        {d.dataUrl ? <a className="small strong" href={d.dataUrl} download={d.name}>{d.name}</a> : <span className="small strong">{d.name}</span>}
                        <div className="tiny muted">{date(d.uploadedAt)}{d.size ? ` · ${Math.round(d.size / 1024)}KB` : ''}</div>
                      </div>
                      <button className="icon-btn" onClick={() => remove('docs', d.id)} aria-label="מחיקה"><Trash2 size={15} /></button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}
