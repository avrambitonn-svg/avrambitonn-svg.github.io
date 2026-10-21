// הצעת מחיר להדפסה ולשמירה כ-PDF, במיתוג ג'נאייר. מסך ללא תפריט המערכת, מתאים גם ללקוח.
import { useEffect, useMemo, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { Printer } from 'lucide-react'
import { brand } from '../../brand'
import { useDB, useSettings } from '../../lib/store'
import { lineTotal, totals } from '../../lib/quote'
import { date, dateTime, money, pct, phone } from '../../lib/format'
import { addressText, portalUrl } from '../../lib/integrations/links'
import { Wordmark } from '../../components/Layout'
import { QR } from '../../components/extras'
import { Empty } from '../../components/ui'
import { caseContact, depositMethodLabel, groupByRoom } from '../../features/quotes/util'
import './print.css'

export default function QuotePrint() {
  const { id } = useParams()
  const quotes = useDB((d) => d.quotes)
  const cases = useDB((d) => d.cases)
  const customers = useDB((d) => d.customers)
  const contacts = useDB((d) => d.contacts)
  const catalog = useDB((d) => d.catalog)
  const users = useDB((d) => d.users)
  const settings = useSettings()

  const q = quotes.find((x) => x.id === id)
  const k = q ? cases.find((x) => x.id === q.caseId) : undefined
  const customer = k ? customers.find((c) => c.id === k.customerId) : undefined
  const contact = caseContact(k, contacts)
  const agent = users.find((u) => u.id === k?.agentId)
  const t = useMemo(() => (q ? totals(q, catalog) : undefined), [q, catalog])
  const groups = useMemo(() => (q ? groupByRoom(q.lines) : []), [q])

  // שם הקובץ כששומרים כ-PDF
  useEffect(() => {
    if (!q) return
    const prev = document.title
    document.title = `הצעת מחיר ${q.number}${q.version > 1 ? ` גרסה ${q.version}` : ''}${customer ? ` · ${customer.name}` : ''} · ${brand.name}`
    return () => {
      document.title = prev
    }
  }, [q, customer])

  if (!q || !k || !t) {
    return (
      <div className="qp-root">
        <div className="qp-sheet" style={{ minHeight: 0 }}>
          <Empty title="ההצעה לא נמצאה" />
        </div>
      </div>
    )
  }

  const address = customer?.addresses.find((a) => a.id === k.addressId) ?? customer?.addresses[0]
  const addrExtra = address && [address.floor && `קומה ${address.floor}`, address.apartment && `דירה ${address.apartment}`].filter(Boolean).join(', ')
  const approved = q.status === 'approved' && q.signature
  const issued = q.sentAt ?? q.createdAt
  const deposit = q.deposit?.amount ?? Math.round((t.total * settings.depositPct) / 100)
  const depositPctOfTotal = t.total ? Math.round((deposit / t.total) * 100) : 0
  const terms = q.terms.split('\n').map((x) => x.trim()).filter(Boolean)
  const sku = (itemId?: string) => catalog.find((c) => c.id === itemId)?.sku

  return (
    <div className="qp-root" dir="rtl">
      <div className="qp-toolbar">
        <Wordmark />
        <span className="strong" style={{ color: '#fff' }}>הצעת מחיר <span className="ltr">{q.number}</span></span>
        <span className="hint">בחלון ההדפסה בוחרים ״שמירה כ-PDF״ כדי לקבל קובץ</span>
        <span className="grow" />
        <button className="btn primary" onClick={() => window.print()}><Printer size={16} /> הדפסה / שמירה כ-PDF</button>
      </div>

      <article className="qp-sheet">
        <header className="qp-head">
          <div className="doc">
            <h1>
              הצעת מחיר
              {q.status === 'draft' && <span className="qp-tag draft">טיוטה</span>}
              {q.status === 'approved' && <span className="qp-tag ok">מאושרת</span>}
            </h1>
            <div className="no">
              מס׳ <b className="ltr">{q.number}</b>
              {q.version > 1 && <> · גרסה {q.version}</>} · {date(issued)}
            </div>
          </div>
          <div className="brandbox">
            <Wordmark />
            <div className="slogan">{brand.slogan}</div>
          </div>
        </header>
        <div className="qp-stripe" />

        <section className="qp-parties">
          <div className="qp-box">
            <div className="t">לכבוד</div>
            <div className="name">{customer?.name ?? '—'}</div>
            {contact && contact.name !== customer?.name && <div className="line">{contact.name}{contact.role ? `, ${contact.role}` : ''}</div>}
            {address && <div className="line">{addressText(address)}{addrExtra ? ` · ${addrExtra}` : ''}</div>}
            <div className="line">
              <span className="ltr">{phone(contact?.phone ?? customer?.phone)}</span>
              {(contact?.email ?? customer?.email) && <> · <span className="ltr">{contact?.email ?? customer?.email}</span></>}
            </div>
            {customer?.idNumber && <div className="line">ח.פ / ת.ז {customer.idNumber}</div>}
          </div>
          <div className="qp-box">
            <div className="t">פרטי ההצעה</div>
            <dl className="qp-kv" style={{ margin: 0 }}>
              <dt>תאריך</dt><dd>{date(issued)}</dd>
              <dt>בתוקף עד</dt><dd>{date(q.validUntil)}</dd>
              <dt>מס׳ תיק</dt><dd className="ltr" style={{ justifySelf: 'start' }}>{k.number}</dd>
              {agent && <><dt>יועץ/ת</dt><dd>{agent.name} · <span className="ltr">{phone(agent.phone)}</span></dd></>}
            </dl>
          </div>
        </section>

        <h2 className="qp-project">{k.title}</h2>

        <table className="qp-table">
          <thead>
            <tr>
              <th>תיאור</th>
              <th className="n">כמות</th>
              <th className="n">מחיר ליח׳</th>
              <th className="n">סה״כ</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <GroupRows key={g.key || '_'} label={g.label} show={groups.length > 1 || !!g.key}>
                {g.lines.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <span className="desc">{l.description || '—'}</span>
                      {sku(l.itemId) && <span className="sku ltr">{sku(l.itemId)}</span>}
                    </td>
                    <td className="n">{l.qty.toLocaleString('he-IL')} {l.unit}</td>
                    <td className="n">{money(l.unitPrice)}</td>
                    <td className="n tot">{money(lineTotal(l))}</td>
                  </tr>
                ))}
              </GroupRows>
            ))}
          </tbody>
        </table>

        <section className="qp-sum">
          <div className="left">
          <div className="qp-notes">
            {q.notes ? (
              <>
                <div className="t">הערות</div>
                <p style={{ whiteSpace: 'pre-line' }}>{q.notes}</p>
              </>
            ) : (
              <p>
                ההצעה הוכנה עבורכם לפי הסקר בשטח. נשמח לענות על כל שאלה בטלפון <span className="ltr">{brand.phone}</span> או בוואטסאפ.
              </p>
            )}
          </div>
          {terms.length > 0 && (
            <div className="qp-terms">
              <div className="t">תנאים</div>
              <ol>{terms.map((x, i) => <li key={i}>{x}</li>)}</ol>
            </div>
          )}
          </div>
          <div className="qp-totals">
            <div className="r"><span>סה״כ</span><span>{money(t.subtotal)}</span></div>
            {t.discount > 0 && <div className="r"><span>הנחה {pct(q.discountPct)}</span><span>−{money(t.discount)}</span></div>}
            {t.discount > 0 && <div className="r"><span>אחרי הנחה</span><span>{money(t.net)}</span></div>}
            <div className="r"><span>מע״מ {pct(q.vatPct)}</span><span>{money(t.vat)}</span></div>
            <div className="r grand"><span>סה״כ לתשלום</span><span>{money(t.total)}</span></div>
            <div className="dep">
              {q.deposit?.paidAt
                ? `שולמה מקדמה ${money(q.deposit.amount)}${q.deposit.method ? ` (${depositMethodLabel[q.deposit.method]})` : ''}`
                : q.deposit
                  ? `מקדמה ${money(q.deposit.amount)} ממתינה לאימות`
                  : `מקדמה באישור: ${money(deposit)} (${depositPctOfTotal}%)`}
            </div>
          </div>
        </section>

        <section className="qp-sign">
          <div>
            <div className="qp-sigbox">{approved && <img src={q.signature!.dataUrl} alt={`חתימה של ${q.signature!.name}`} />}</div>
            <div className="qp-sigcap">
              {approved ? <>נחתם דיגיטלית ע״י <b>{q.signature!.name}</b></> : 'חתימת הלקוח'}
            </div>
          </div>
          <div>
            <div className={`qp-sigbox ${approved ? 'stamped' : ''}`}>
              {approved && (
                <div className="qp-stamp">
                  אושר ונחתם
                  <small>{date(q.signature!.at)}</small>
                </div>
              )}
            </div>
            <div className="qp-sigcap">{approved ? <><b>{q.signature!.name}</b> · {dateTime(q.signature!.at)}</> : 'שם מלא ותאריך'}</div>
          </div>
          {k.portal.enabled && (
            <div className="qp-qr">
              <QR text={portalUrl(k.portal.token)} size={74} />
              <div>
                <b>{approved ? 'האזור האישי' : 'אישור אונליין'}</b>
                {approved ? 'מועדים, מסמכים ואחריות במקום אחד' : 'סורקים, עוברים על ההצעה וחותמים מהנייד'}
              </div>
            </div>
          )}
        </section>

        <footer className="qp-foot">
          <div className="in">
            <div className="contacts">
              <b>{brand.name} · {brand.nameEn}</b>
              <span>{brand.address}</span>
              <span className="ltr">{brand.phone}</span>
              <span className="ltr">{brand.email}</span>
              <span className="ltr">{brand.website.replace(/^https?:\/\/(www\.)?/, '')}</span>
            </div>
            <span className="promise">{brand.promise}</span>
          </div>
        </footer>
      </article>
    </div>
  )
}

function GroupRows({ label, show, children }: { label: string; show: boolean; children: ReactNode }) {
  return (
    <>
      {show && (
        <tr className="grp">
          <td colSpan={4}><span>{label}</span></td>
        </tr>
      )}
      {children}
    </>
  )
}
