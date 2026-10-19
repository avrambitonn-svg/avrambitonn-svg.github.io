// נתוני הדגמה: צ'אט, משימות משותפות, פלואו בתיקים, חופשות. מקבל את מסד הנתונים אחרי הבנייה הבסיסית ומשלים אותו במקום.
import type { Activity, Case, ChatMessage, DB, ID, LeaveRequest, Message, Notification, Task } from './types'
import { addDays, atTime, ymd } from './format'
import { assigneesFor, dueIn, stagesOf, templateFor } from '../features/flow/engine'

const MIN = 60_000
const minsAgo = (m: number) => new Date(Date.now() - m * MIN).toISOString()
// לפני n ימים בשעה מסוימת, בלי שישי ושבת (ולא בעתיד, גם אם השעה עוד לא הגיעה היום)
function daysAgo(n: number, hhmm: string) {
  let d = addDays(new Date(), -n)
  while (n > 0 && (d.getDay() === 5 || d.getDay() === 6)) d = addDays(d, -1)
  const t = atTime(d, hhmm)
  return (t.getTime() > Date.now() - 5 * MIN ? new Date(Date.now() - (n + 1) * 7 * MIN) : t).toISOString()
}
const dayFmt = new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })
const shortFmt = new Intl.DateTimeFormat('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric' })
const dates = (from: string, to: string) => (from === to ? dayFmt.format(new Date(`${from}T00:00:00`)) : `${shortFmt.format(new Date(`${from}T00:00:00`))} – ${shortFmt.format(new Date(`${to}T00:00:00`))}`)

function chat(db: DB): ChatMessage[] {
  const all = (caseId: ID, extra: ID[] = []) => {
    const k = db.cases.find((x) => x.id === caseId)
    return [...new Set([k?.agentId, k?.engineerId, k?.managerId, ...(k?.installerIds ?? []), ...extra].filter(Boolean) as ID[])]
  }
  const m = (id: string, threadId: string, fromId: ID, body: string, at: string, readBy: ID[], extra: Partial<ChatMessage> = {}): ChatMessage => ({
    id, threadId, caseId: threadId.startsWith('case:') ? threadId.slice(5) : undefined, fromId, body, at, readBy: [...new Set([fromId, ...readBy])], ...extra,
  })
  const k3 = all('k3', ['u-office', 'u-admin'])
  const k4 = all('k4', ['u-office'])
  return [
    // פנטהאוז עמק רפאים: תוכנית, מנוף ויחידות
    m('ch1', 'case:k3', 'u-eng', 'העליתי את תוכנית המיזוג המעודכנת. שימו לב: היחידה החיצונית זזה לצד המערבי של הגג, שם הקורה חזקה יותר.', daysAgo(2, '09:40'), k3, { attachments: [{ name: 'תוכנית מיזוג — פנטהאוז.pdf', mime: 'application/pdf', docId: 'd1' }] }),
    m('ch2', 'case:k3', 'u-inst1', 'קיבלתי. מהצד המערבי יש עמוד חשמל, אז צריך מנוף עם זרוע של 30 מ׳ ולא 22.', daysAgo(2, '10:05'), k3),
    m('ch3', 'case:k3', 'u-office', '@סאמר חלבי המנוף מוזמן ל-07:30, זרוע 30 מ׳. ועד הבית אישר חניה לשעתיים מול הכניסה.', daysAgo(1, '16:20'), k3, { mentions: ['u-inst1'] }),
    m('ch4', 'case:k3', 'u-inst1', 'מעולה, תודה. @אלי שטרן כל 7 היחידות הפנימיות כבר הגיעו למחסן?', daysAgo(1, '16:32'), k3.filter((x) => x !== 'u-admin'), { mentions: ['u-eng'] }),
    m('ch5', 'case:k3', 'u-eng', 'הגיעו 6. השביעית (הסמויה לחדר העבודה) מגיעה מחר בבוקר מאוויר-טק. סימנתי בהזמנה.', daysAgo(1, '17:05'), ['u-inst1', 'u-office', 'u-agent2']),
    m('ch6', 'case:k3', 'u-agent2', 'הלקוח ביקש שהבקר בסלון יהיה בגוון שחור כמו המתגים. @דוד מזרחי מאשר תוספת של 180 ₪?', minsAgo(150), ['u-office'], { mentions: ['u-admin'] }),
    // וילה בבית שמש: יום ההתקנה
    m('ch7', 'case:k4', 'u-inst2', 'הגענו לאתר. הלקוח מבקש להזיז את המפזר בקומה העליונה 40 ס״מ ימינה, מעל הארון. זה מסתדר עם התעלה?', daysAgo(0, '08:10'), k4),
    m('ch8', 'case:k4', 'u-eng', 'כן, יש מרווח. רק לשמור על שיפוע של 1% בקו הניקוז, ולצלם לפני שסוגרים את הגבס.', daysAgo(0, '08:25'), k4),
    m('ch9', 'case:k4', 'u-inst1', 'חסרה לנו משאבת ניקוז אחת ברכב. @משה כהן אפשר לשלוח מהמחסן?', daysAgo(0, '09:50'), ['u-inst2', 'u-office'], { mentions: ['u-office'] }),
    m('ch10', 'case:k4', 'u-office', 'שליח יוצא עכשיו עם משאבה, תוך שעה אצלכם.', daysAgo(0, '10:05'), ['u-inst1']),
    // החלפת מזגנים, ברגר
    m('ch11', 'case:k2', 'u-agent1', 'ברגר שילם מקדמה. הם מארחים בחג ומבקשים התקנה לפני אם אפשר.', daysAgo(1, '11:00'), ['u-office', 'u-admin']),
    m('ch12', 'case:k2', 'u-office', 'בודק עם סאמר ויעקב. נראה שיש חלון ביום חמישי בבוקר, אעדכן עד מחר בצהריים.', daysAgo(1, '11:20'), ['u-agent1']),
    // שיחות אישיות
    m('ch13', 'dm:u-admin:u-office', 'u-office', 'דוד, ראית את בקשת המילואים של יעקב? הוא משובץ ביום השני של ה-VRF בפנטהאוז. אם מאשרים, אני מחפש מחליף.', minsAgo(55), []),
    m('ch14', 'dm:u-agent1:u-agent2', 'u-agent1', 'יוסי, יש לך את הקטלוג של מערכות ה-VRF עם השרטוטים? לקוח ברחביה שואל.', daysAgo(3, '14:12'), ['u-agent2']),
    m('ch15', 'dm:u-agent1:u-agent2', 'u-agent2', 'שלחתי לך במייל. יש גם עותק במסמכי התיק של הפנטהאוז.', daysAgo(3, '14:30'), ['u-agent1']),
  ]
}

// פניות מהאזור האישי: אחת נענתה ואחת עוד לא
function portalMessages(): Message[] {
  return [
    { id: 'mp1', caseId: 'k2', customerId: 'c2', channel: 'portal', direction: 'in', body: 'שלום, אפשר להקדים את ההתקנה לסוף השבוע הזה? אנחנו מארחים בחג.', at: daysAgo(1, '21:10'), status: 'read', readAt: daysAgo(1, '21:30'), readBy: 'u-office' },
    { id: 'mp2', caseId: 'k2', customerId: 'c2', channel: 'portal', direction: 'out', body: 'ערב טוב יעקב, בדקנו ויש חלון ביום חמישי בבוקר. נאשר סופית מחר עד 12:00.', at: daysAgo(1, '21:40'), by: 'u-office', status: 'sent' },
    { id: 'mp3', caseId: 'k1', customerId: 'c1', channel: 'portal', direction: 'in', body: 'שאלה לגבי ההצעה: אם נוותר על המזגן בחדר ילדים 2, בכמה יורד המחיר? ואפשר לשלם ב-3 תשלומים?', at: minsAgo(70), status: 'delivered' },
  ]
}

// פלואו בתיקים פעילים, בשלב שמתאים למצב התיק. השלבים הקודמים הושלמו עם המשימות שלהם
function flows(db: DB, acts: Activity[]): Task[] {
  // מנהל הפרויקט ומנהלי המחלקה של הפנטהאוז ונווה השקד (כמו בנתוני ההנהלה)
  const roles: Record<ID, Partial<Case>> = { k3: { projectManagerId: 'u-inst1', departmentManagerIds: ['u-office', 'u-eng'] }, k5: { projectManagerId: 'u-eng', departmentManagerIds: ['u-office'] } }
  const plan: [ID, number][] = [['k1', 2], ['k2', 3], ['k3', 4], ['k5', 1]]
  const out: Task[] = []
  for (const [caseId, cur] of plan) {
    const k0 = db.cases.find((x) => x.id === caseId)
    const tpl = k0 && templateFor(db.config, k0)
    if (!k0 || !tpl) continue
    const k = { ...k0, ...roles[caseId], departmentManagerIds: k0.departmentManagerIds ?? roles[caseId]?.departmentManagerIds, projectManagerId: k0.projectManagerId ?? roles[caseId]?.projectManagerId }
    const stages = stagesOf(db.config, tpl)
    if (cur >= stages.length) continue
    const start = +new Date(k.createdAt)
    const span = Math.max(Date.now() - 3 * 3600_000 - start, 3600_000)
    const at = (i: number) => new Date(start + (span * i) / (cur + 0.5)).toISOString()
    const log = stages.slice(0, cur + 1).map((st, i) => ({ stageId: st.id, startedAt: at(i), ...(i < cur ? { doneAt: at(i + 1), doneBy: k.agentId ?? 'u-office' } : {}) }))
    k0.flow = { templateId: tpl.id, stageIdx: cur, startedAt: at(0), log }
    k0.templateId = tpl.id
    acts.push({ id: `af-${caseId}-0`, at: at(0), caseId, kind: 'note', userId: 'u-office', text: `פלואו התחיל: ${tpl.name} — שלב ראשון: ${stages[0].name}` })
    stages.slice(0, cur + 1).forEach((st, i) => {
      st.tasks.forEach((def, j) => {
        assigneesFor(db, k, def.role).forEach((assigneeId, n) => {
          // בברגר משימת התיאום כבר קיימת (t2): מחברים אותה לשלב במקום ליצור כפולה
          if (caseId === 'k2' && i === cur && def.role === 'office') {
            const t2 = db.tasks.find((t) => t.id === 't2')
            if (t2) { t2.flowStageId = st.id; return }
          }
          const done = i < cur
          out.push({
            id: `tf-${caseId}-${i}-${j}-${n}`, title: def.title, caseId, assigneeId, createdBy: 'u-office', due: done ? ymd(at(i + 1)) : dueIn(def.dueDays ?? 0, new Date(at(i))),
            done, status: done ? 'done' : 'new', priority: 'normal', createdAt: at(i), flowStageId: st.id, ...(done ? { doneAt: at(i + 1), doneBy: assigneeId } : {}),
          })
        })
      })
      if (i < cur) acts.push({ id: `af-${caseId}-${i + 1}`, at: at(i + 1), caseId, kind: 'note', userId: k.agentId, text: `שלב הושלם: ${st.name} (כל המשימות בוצעו)` })
    })
  }
  return out
}

function sharedTasks(): Task[] {
  const now = new Date()
  const four = atTime(now, '16:00')
  return [
    {
      id: 'tc1', title: 'להכין רשימת ציוד וחלקים ל-VRF בפנטהאוז', caseId: 'k3', assigneeId: 'u-inst1', createdBy: 'u-eng', sharedWith: ['u-office'], due: dueIn(1), done: false, priority: 'high', status: 'in_progress',
      remindAt: atTime(addDays(now, 1), '08:00').toISOString(), notes: '7 יחידות פנימיות, 60 מ׳ צנרת, 7 בקרים (אחד בגוון שחור). לבדוק מול ההזמנה מאוויר-טק.', createdAt: daysAgo(1, '17:10'),
    },
    {
      id: 'tc2', title: 'לשלוח לרוזנטל אישור על תוספת הבקר השחור', caseId: 'k3', assigneeId: 'u-agent2', createdBy: 'u-admin', sharedWith: ['u-office'], due: ymd(), done: false, priority: 'normal', status: 'new',
      remindAt: minsAgo(40), remindedAt: minsAgo(40), createdAt: minsAgo(140),
    },
    {
      id: 'tc3', title: 'לעדכן את לוח ההתקנות לשבוע הבא ולשלוח לצוות', assigneeId: 'u-office', createdBy: 'u-admin', sharedWith: ['u-admin', 'u-inst1'], due: dueIn(1), done: false, priority: 'normal', status: 'waiting_approval',
      remindAt: (four.getTime() > Date.now() + 10 * MIN ? four : atTime(addDays(now, 1), '09:00')).toISOString(), createdAt: daysAgo(1, '09:00'),
    },
  ]
}

// חופשה מאושרת למתקין בשבוע הבא (בלי משימות באותם ימים), ובקשת מילואים שממתינה ומתנגשת ביום התקנה
function leaves(db: DB): LeaveRequest[] {
  const busy = (userId: ID, from: string, to: string) => db.appointments.some((a) => a.userIds.includes(userId) && a.status !== 'cancelled' && ymd(a.start) <= to && ymd(a.end) >= from)
  let sun = addDays(new Date(), 7 - new Date().getDay())
  while (busy('u-tech', ymd(sun), ymd(addDays(sun, 2)))) sun = addDays(sun, 7)
  const ap4 = db.appointments.find((a) => a.id === 'ap4')
  const day4 = ap4 ? ymd(ap4.start) : ymd(addDays(new Date(), 4))
  return [
    { id: 'lv1', userId: 'u-tech', type: 'vacation', from: ymd(sun), to: ymd(addDays(sun, 2)), reason: 'נסיעה משפחתית לגליל', status: 'approved', decidedBy: 'u-admin', decidedAt: daysAgo(1, '12:30'), decisionNote: 'חופשה נעימה! נתן, תעביר את הקריאות הפתוחות למשה.', createdAt: daysAgo(4, '18:00') },
    { id: 'lv2', userId: 'u-inst2', type: 'reserve', from: day4, to: day4, reason: 'צו מילואים ליום אחד (אימון)', status: 'pending', createdAt: minsAgo(190) },
  ]
}

export function applyCollabSeed(db: DB): void {
  db.chat = [...chat(db), ...(db.chat ?? [])]

  // פניות קודמות מוואטסאפ כבר טופלו; הפנייה של משפחת שפירא מהבוקר עוד לא נקראה
  db.messages.forEach((m) => {
    if (m.direction === 'in' && m.id !== 'm5' && !m.readAt) Object.assign(m, { readAt: m.at, readBy: 'u-office' })
  })
  db.messages.push(...portalMessages())

  const acts: Activity[] = []
  const flowTasks = flows(db, acts)
  const t2 = db.tasks.find((t) => t.id === 't2')
  if (t2) Object.assign(t2, { sharedWith: ['u-agent1'], status: 'in_progress', notes: 'הלקוח מבקש לפני החג. לבדוק חלון ביום חמישי עם סאמר ויעקב.' })
  db.tasks.forEach((t) => {
    if (t.done && !t.status) Object.assign(t, { status: 'done', doneAt: t.doneAt ?? t.createdAt, doneBy: t.doneBy ?? t.assigneeId })
  })
  db.tasks.push(...sharedTasks(), ...flowTasks)

  const lv = leaves(db)
  db.leaves = [...lv, ...(db.leaves ?? [])]
  const pend = lv.find((l) => l.status === 'pending')

  const notes: Notification[] = [
    { id: 'nc1', at: minsAgo(150), userId: 'u-admin', text: 'אזכור מיוסי פרץ · GN-260127: הלקוח ביקש שהבקר בסלון יהיה בגוון שחור כמו המתגים...', link: '/cases/k3?chat=case%3Ak3', read: false },
    { id: 'nc2', at: minsAgo(55), userId: 'u-admin', text: 'משה כהן: דוד, ראית את בקשת המילואים של יעקב?', link: '/?chat=dm%3Au-admin%3Au-office', read: false },
    { id: 'nc3', at: minsAgo(70), userId: 'u-agent1', text: 'פנייה חדשה מגולדברג באזור האישי: אם נוותר על המזגן בחדר ילדים 2...', link: '/cases/k1?chat=k%3Ak1', read: false },
    { id: 'nc4', at: minsAgo(40), userId: 'u-agent2', text: 'תזכורת: לשלוח לרוזנטל אישור על תוספת הבקר השחור', link: '/tasks?task=tc2', read: false },
    { id: 'nc5', at: minsAgo(40), userId: 'u-office', text: 'תזכורת: לשלוח לרוזנטל אישור על תוספת הבקר השחור', link: '/tasks?task=tc2', read: true },
    { id: 'nc6', at: daysAgo(1, '12:30'), userId: 'u-tech', text: `אושרה בקשת החופשה שלך (${dates(lv[0].from, lv[0].to)}): חופשה נעימה!`, link: '/leave', read: false },
    ...(pend ? (['u-admin', 'u-office'] as ID[]).map((userId, i): Notification => ({ id: `nc${7 + i}`, at: pend.createdAt, userId, text: `בקשת מילואים מיעקב דהן: ${dates(pend.from, pend.to)}`, link: '/leave?tab=pending', read: false })) : []),
  ]
  db.notifications = [...notes, ...db.notifications].sort((a, b) => b.at.localeCompare(a.at))
  db.activities = [...acts, ...db.activities].sort((a, b) => b.at.localeCompare(a.at))
}
