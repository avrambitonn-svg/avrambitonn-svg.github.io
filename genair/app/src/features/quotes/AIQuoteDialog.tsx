// טיוטת הצעת מחיר מהסקר בשטח: רואים מה נשלח, בונים, בודקים ומתקנים, ורק אז יוצרים הצעה
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot, Calculator, CheckCircle2, Circle, FileText, Image as ImageIcon, Loader2, MapPin, Mic, RotateCcw, Ruler, Server, Sparkles, Sun, Trash2, X,
} from 'lucide-react'
import type { ID, QuoteLine } from '../../lib/types'
import { useDB, useSettings } from '../../lib/store'
import { aiMode, demoDraft, draftQuote, type AiDraft } from '../../lib/integrations/ai'
import { ServerError } from '../../lib/integrations/server'
import { createQuote } from '../../lib/actions'
import { totals, lineTotal } from '../../lib/quote'
import { date, money } from '../../lib/format'
import { Badge, Callout, Empty, Modal, Progress, toast } from '../../components/ui'
import { AiInsights, NumInput } from './parts'
import { sleep, sunLabel } from './util'
import './quotes.css'

type Phase = 'intro' | 'running' | 'review' | 'error'

const modes = [
  { id: 'server', icon: <Server size={17} />, title: 'Claude דרך שרת החברה', text: 'המפתח שמור בשרת האינטגרציות. התמונות ונתוני הסקר נשלחים לניתוח מאובטח.' },
  { id: 'browser', icon: <Bot size={17} />, title: 'Claude עם מפתח מהדפדפן', text: 'משתמש במפתח שהוזן בהגדרות במחשב הזה. מתאים להדגמה, לא לעבודה שוטפת.' },
  { id: 'demo', icon: <Calculator size={17} />, title: 'מנוע חישוב מקומי', text: 'בלי AI ובלי אינטרנט: חישוב BTU לפי שטח, גובה תקרה וחשיפה לשמש.' },
] as const

const runSteps = {
  remote: ['מכין את התמונות ונתוני החדרים', 'Claude מנתח את הסקר', 'מתאים פריטים מהמחירון'],
  local: ['קורא את נתוני החדרים', 'מחשב תפוקה לכל חדר', 'מוסיף עבודה וחומרים'],
}

// הודעות שגיאה בעברית פשוטה
function errorText(e: unknown): string {
  if (e instanceof ServerError) {
    if (e.code === 'network') return 'אין חיבור לשרת האינטגרציות. בדקו שהשרת פועל ושהכתובת בהגדרות נכונה.'
    if (e.status === 401 || e.status === 403) return 'השרת דחה את הבקשה. בדקו את קוד הגישה בהגדרות ← חיבורים.'
    if (e.status === 429 || e.status === 529) return 'שירות ה-AI עמוס כרגע. נסו שוב בעוד דקה.'
    return /[֐-׿]/.test(e.message) ? e.message : `שגיאה מהשרת: ${e.message}`
  }
  if (e instanceof SyntaxError) return 'התשובה של המודל לא הגיעה בפורמט תקין. אפשר לנסות שוב.'
  if (e instanceof TypeError) return 'אין חיבור לשירות ה-AI. בדקו את החיבור לאינטרנט ונסו שוב.'
  const msg = e instanceof Error ? e.message : String(e)
  if (/api[ _-]?key|authentication|unauthorized|401/i.test(msg)) return 'מפתח ה-API לא תקין. בדקו אותו בהגדרות ← חיבורים.'
  if (/rate|overloaded|429|529/i.test(msg)) return 'שירות ה-AI עמוס כרגע. נסו שוב בעוד דקה.'
  if (/credit|billing|balance/i.test(msg)) return 'אין יתרה בחשבון ה-API. אפשר להמשיך עם המנוע המקומי.'
  return /[֐-׿]/.test(msg) ? msg : `שגיאה מהשירות: ${msg}`
}

export function AIQuoteDialog({ caseId, onClose, onCreated }: { caseId: ID; onClose: () => void; onCreated?: (quoteId: ID) => void }) {
  const cases = useDB((d) => d.cases)
  const catalog = useDB((d) => d.catalog)
  const users = useDB((d) => d.users)
  const settings = useSettings()
  const k = cases.find((x) => x.id === caseId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const mode = useMemo(() => aiMode(), [settings.serverUrl, settings.anthropicKey])

  const [phase, setPhase] = useState<Phase>('intro')
  const [draft, setDraft] = useState<AiDraft | null>(null)
  const [lines, setLines] = useState<QuoteLine[]>([])
  const [error, setError] = useState('')
  const [progress, setProgress] = useState(0)
  const [local, setLocal] = useState(mode === 'demo')
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  // התקדמות משוערת בזמן ההמתנה (הבקשה עצמה היא קריאה אחת)
  useEffect(() => {
    if (phase !== 'running') return
    setProgress(6)
    const t = setInterval(() => setProgress((p) => (p < 92 ? p + Math.max(1, (92 - p) * (local ? 0.22 : 0.06)) : p)), 220)
    return () => clearInterval(t)
  }, [phase, local])

  const t = useMemo(() => totals({ lines, discountPct: 0, vatPct: settings.vatPct }, catalog), [lines, settings.vatPct, catalog])

  if (!k) {
    return (
      <Modal title="טיוטת הצעה מהסקר" onClose={onClose}>
        <Empty title="התיק לא נמצא" />
      </Modal>
    )
  }
  const survey = k.survey
  const surveyor = users.find((u) => u.id === survey.doneBy)
  const emptySurvey = !survey.rooms.length && !survey.photos.length

  async function run(useLocal: boolean) {
    if (!k) return
    setLocal(useLocal)
    setPhase('running')
    setError('')
    const started = Date.now()
    try {
      const d = useLocal ? demoDraft(k, survey, catalog) : await draftQuote(k, survey, catalog)
      // המנוע המקומי מהיר מאוד; השהיה קצרה כדי שיהיה ברור שמשהו קרה
      await sleep(Math.max(0, (useLocal ? 1100 : 300) - (Date.now() - started)))
      if (!alive.current) return
      setProgress(100)
      await sleep(250)
      if (!alive.current) return
      setDraft(d)
      setLines(d.lines)
      setPhase('review')
    } catch (e) {
      if (!alive.current) return
      setError(errorText(e))
      setPhase('error')
    }
  }

  function create() {
    if (!draft || !lines.length) return
    const q = createQuote(caseId, lines, { ai: draft.meta })
    toast.success(`נוצרה הצעה ${q.number}`)
    onCreated?.(q.id)
    onClose()
  }

  const setLine = (id: string, changes: Partial<QuoteLine>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...changes } : l)))
  const steps = local ? runSteps.local : runSteps.remote
  const stepIdx = progress < 34 ? 0 : progress < 70 ? 1 : 2

  const footer =
    phase === 'intro' ? (
      <>
        <button className="btn" onClick={onClose}>ביטול</button>
        <button className="btn primary" onClick={() => run(mode === 'demo')}><Sparkles size={16} /> בניית טיוטה</button>
      </>
    ) : phase === 'running' ? (
      <button className="btn primary" disabled><Loader2 size={16} className="spin" /> בונה טיוטה...</button>
    ) : phase === 'error' ? (
      <>
        <button className="btn" onClick={onClose}>ביטול</button>
        <button className="btn" onClick={() => run(false)}><RotateCcw size={15} /> ניסיון חוזר</button>
        <button className="btn primary" onClick={() => run(true)}><Calculator size={16} /> בנייה עם מנוע החישוב המקומי</button>
      </>
    ) : (
      <>
        <button className="btn ghost" onClick={() => setPhase('intro')}><RotateCcw size={15} /> בנייה מחדש</button>
        <span className="grow" />
        <button className="btn" onClick={onClose}>ביטול</button>
        <button className="btn primary" disabled={!lines.length} onClick={create}><FileText size={16} /> יצירת הצעה</button>
      </>
    )

  return (
    <Modal title={<span className="row" style={{ gap: 8 }}><Sparkles size={18} color="var(--brand)" /> טיוטת הצעה מהסקר</span>} onClose={onClose} size="wide" footer={footer}>
      {phase === 'intro' && (
        <div className="ai-body">
          <div className="row between wrap">
            <div>
              <div className="strong">{k.title}</div>
              <div className="tiny muted">
                {k.number}
                {survey.doneAt ? ` · סקר ${date(survey.doneAt)}${surveyor ? ` ע״י ${surveyor.name}` : ''}` : ' · הסקר עוד לא סומן כהושלם'}
              </div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <Badge tone="muted">{survey.rooms.length} חדרים</Badge>
              <Badge tone="muted">{survey.photos.length} תמונות</Badge>
            </div>
          </div>

          {emptySurvey && (
            <Callout tone="warning">
              הסקר ריק: אין חדרים ואין תמונות. הטיוטה תהיה כללית מאוד, ולכן עדיף להשלים קודם את הסקר בשטח.
            </Callout>
          )}

          {survey.rooms.length > 0 && (
            <div>
              <div className="ai-sec-title"><Ruler size={15} /> חדרים</div>
              <div className="ai-rooms table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>חדר</th><th>שטח</th><th>תקרה</th><th>חשיפה לשמש</th><th>קומה</th></tr>
                  </thead>
                  <tbody>
                    {survey.rooms.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <div className="strong">{r.name}</div>
                          {r.notes && <div className="tiny muted">{r.notes}</div>}
                        </td>
                        <td className="num nowrap">{r.areaSqm ? `${r.areaSqm} מ״ר` : <span className="muted">חסר</span>}</td>
                        <td className="num nowrap">{r.ceilingM ? `${r.ceilingM} מ׳` : <span className="muted">2.7 (הנחה)</span>}</td>
                        <td>{r.sunExposure ? <span className={`ai-sun ${r.sunExposure}`}><Sun size={14} /> {sunLabel[r.sunExposure]}</span> : <span className="muted">לא ידוע</span>}</td>
                        <td className="num">{r.floor ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div>
            <div className="ai-sec-title"><MapPin size={15} /> נתוני שטח</div>
            <div className="ai-flags">
              <span className="ai-flag">צנרת: <b>{survey.pipeLengthM !== undefined ? `${survey.pipeLengthM} מ׳` : 'לא נמדד'}</b></span>
              <span className={`ai-flag ${survey.electricalReady === false ? 'warn' : ''}`}>לוח חשמל: <b>{survey.electricalReady === undefined ? 'לא נבדק' : survey.electricalReady ? 'מוכן' : 'לא מוכן'}</b></span>
              <span className={`ai-flag ${survey.workAtHeight ? 'warn' : ''}`}>עבודה בגובה: <b>{survey.workAtHeight ? 'כן' : 'לא'}</b></span>
              <span className={`ai-flag ${survey.craneNeeded ? 'warn' : ''}`}>מנוף: <b>{survey.craneNeeded ? 'כן' : 'לא'}</b></span>
              <span className="ai-flag">מזגנים לפירוק: <b>{survey.existingUnitsToRemove ?? 0}</b></span>
            </div>
          </div>

          {survey.photos.length > 0 && (
            <div>
              <div className="ai-sec-title"><ImageIcon size={15} /> תמונות {survey.photos.length > 8 && <span className="tiny muted">(8 הראשונות נשלחות לניתוח)</span>}</div>
              <div className="ai-photos">
                {survey.photos.map((p) => (
                  <div key={p.id} className="photo">
                    <img src={p.dataUrl} alt={p.caption ?? 'תמונה מהסקר'} />
                    {p.caption && <div className="cap">{p.caption}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {(survey.voiceNotes || survey.notes || k.notes) && (
            <div className="col" style={{ gap: 8 }}>
              <div className="ai-sec-title" style={{ marginBottom: 0 }}><Mic size={15} /> הערות</div>
              {survey.voiceNotes && <div className="ai-voice"><Mic size={16} /><div>{survey.voiceNotes}</div></div>}
              {survey.notes && <div className="ai-voice"><FileText size={16} /><div>{survey.notes}</div></div>}
              {k.notes && <div className="ai-voice"><FileText size={16} /><div><span className="tiny muted">מהפנייה: </span>{k.notes}</div></div>}
            </div>
          )}

          <div>
            <div className="ai-sec-title"><Bot size={15} /> מי יבנה את הטיוטה</div>
            <div className="ai-modes">
              {modes.map((m) => (
                <div key={m.id} className={`ai-mode ${mode === m.id ? 'on' : ''}`}>
                  <span className="ico">{m.icon}</span>
                  <div className="grow">
                    <div className="row" style={{ gap: 8 }}>
                      <b>{m.title}</b>
                      {mode === m.id && <Badge tone="brand">ירוץ עכשיו</Badge>}
                      {mode === m.id && m.id !== 'demo' && <span className="tiny muted ltr">{settings.aiModel}</span>}
                    </div>
                    <p>{m.text}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="tiny muted mt8">המחירים תמיד נלקחים מהמחירון. ה-AI רק בוחר פריטים וכמויות, ואתם מאשרים לפני שנוצרת הצעה.</p>
          </div>
        </div>
      )}

      {phase === 'running' && (
        <div className="ai-run">
          <div className="ai-orb">{local ? <Calculator size={30} /> : <Sparkles size={30} />}</div>
          <div>
            <div className="strong" style={{ fontSize: 17 }}>בונה טיוטה...</div>
            <div className="small muted">{local ? 'מנוע החישוב המקומי' : `Claude · ${settings.aiModel}`}</div>
          </div>
          <Progress value={progress} />
          <div className="ai-steps">
            {steps.map((s, i) => (
              <div key={s} className={`s ${i < stepIdx || progress >= 100 ? 'done' : i === stepIdx ? 'now' : ''}`}>
                {i < stepIdx || progress >= 100 ? <CheckCircle2 size={16} /> : i === stepIdx ? <Loader2 size={16} className="spin" /> : <Circle size={16} />}
                {s}
              </div>
            ))}
          </div>
        </div>
      )}

      {phase === 'error' && (
        <div className="ai-body">
          <Callout tone="danger">
            <div className="strong">לא הצלחנו לבנות טיוטה</div>
            <div className="mt8">{error}</div>
          </Callout>
          <p className="small muted">
            אפשר לנסות שוב, או לבנות טיוטה עם מנוע החישוב המקומי. הוא לא רואה את התמונות, אבל מחשב תפוקה לפי נתוני החדרים ומוסיף עבודה וחומרים.
          </p>
        </div>
      )}

      {phase === 'review' && draft && (
        <div className="ai-review">
          <div className="col" style={{ gap: 10 }}>
            {lines.length === 0 ? (
              <Empty title="אין שורות בטיוטה">{draft.lines.length ? 'הסרתם את כל השורות. אפשר לבנות מחדש.' : 'לא היו מספיק נתונים כדי לבחור פריטים. השלימו את הסקר ונסו שוב.'}</Empty>
            ) : (
              <div className="ai-lines">
                <div className="ai-line head">
                  <span>פריט</span><span>כמות</span><span>מחיר ליח׳</span><span className="tot">סה״כ</span><span />
                </div>
                {lines.map((l) => (
                  <div key={l.id} className="ai-line">
                    <div>
                      <div className="desc">{l.description}</div>
                      {l.room && <span className="room"><MapPin size={11} /> {l.room}</span>}
                      {l.aiReason && <div className="why">{l.aiReason}</div>}
                    </div>
                    <NumInput label="כמות" value={l.qty} min={0.01} suffix={l.unit} onChange={(qty) => setLine(l.id, { qty })} />
                    <NumInput label="מחיר ליחידה" value={l.unitPrice} suffix="₪" onChange={(unitPrice) => setLine(l.id, { unitPrice })} />
                    <span className="tot">{money(lineTotal(l))}</span>
                    <button className="icon-btn" style={{ width: 32, height: 32 }} aria-label="הסרת שורה" title="הסרת שורה" onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {lines.length < draft.lines.length && (
              <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setLines(draft.lines)}>
                <X size={14} /> ביטול השינויים ({draft.lines.length - lines.length} שורות הוסרו)
              </button>
            )}
          </div>

          <div className="ai-side">
            <div className="ai-box">
              <div className="money-line"><span className="muted">לפני מע״מ</span><span className="num">{money(t.net)}</span></div>
              <div className="money-line"><span className="muted">מע״מ {settings.vatPct}%</span><span className="num">{money(t.vat)}</span></div>
              <div className="money-line total"><span>סה״כ</span><span className="num">{money(t.total)}</span></div>
              <p className="tiny muted mt8">הנחה, תנאים ותוקף מגדירים בעורך אחרי היצירה.</p>
            </div>
            <div className="ai-box tint">
              <AiInsights meta={draft.meta} compact />
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
