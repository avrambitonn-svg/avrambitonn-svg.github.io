// הכלים של ההדגמה: מציאת אלמנט על המסך לפי טקסט, הקלדה שמרגישה אמיתית, והמתנה שמכבדת השהיה
export type Target =
  | Target[] // הראשון שנמצא
  | string // סלקטור CSS
  | {
      text: string // הטקסט שמופיע באלמנט
      sel?: string // באילו אלמנטים לחפש (ברירת מחדל: כפתורים, קישורים, לשוניות, כותרות)
      within?: string // רק בתוך האזור הזה
      closest?: string // להדגיש את העוטף הקרוב (למשל את כל הכרטיס)
      exact?: boolean
      nth?: number
    }

export interface Step {
  id: string
  chapter: string
  route?: string // מעבר למסך לפני השלב (נתיב בתוך המערכת)
  target?: Target
  title: string
  text: string
  // click: לוחץ אחרי ההסבר; press: לוחץ קודם ואז מסביר; type: מקליד; select: בוחר אפשרות ברשימה (לפי טקסט)
  action?: 'click' | 'press' | { type: string; clear?: boolean } | { select: string } | 'scroll'
  before?: () => void | Promise<void>
  after?: () => void | Promise<void>
  read?: number // זמן קריאה במילישניות (ברירת מחדל: לפי אורך הטקסט)
  pad?: number
  optional?: boolean // אם האלמנט לא נמצא, מדלגים בשקט
  slide?: { kicker?: string; title: string; sub?: string; items?: string[] } // שקופית על כל המסך במקום כרטיס
}

const DEFAULT_SEL = 'button, a, [role=tab], .chip, .nav-link, h1, h2, h3, label, .stat, .badge, th, input, select, textarea'

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

export function visible(el: Element): el is HTMLElement {
  const r = (el as HTMLElement).getBoundingClientRect()
  if (r.width < 2 || r.height < 2) return false
  const cs = getComputedStyle(el)
  return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05
}

export function findTarget(t: Target): HTMLElement | null {
  if (Array.isArray(t)) {
    for (const x of t) { const el = findTarget(x); if (el) return el }
    return null
  }
  if (typeof t === 'string') {
    const all = Array.from(document.querySelectorAll(t)).filter(visible)
    return (all[0] as HTMLElement) ?? null
  }
  const root: ParentNode = t.within ? document.querySelector(t.within) ?? document : document
  const want = norm(t.text)
  const matches = Array.from(root.querySelectorAll(t.sel ?? DEFAULT_SEL)).filter((el) => {
    if (!visible(el)) return false
    const txt = norm(el.textContent) || norm((el as HTMLInputElement).placeholder) || norm(el.getAttribute('aria-label'))
    return t.exact ? txt === want : txt.includes(want)
  })
  // הכי ספציפי: האלמנט הקטן ביותר שמתאים (לא העוטף של כל העמוד)
  matches.sort((a, b) => area(a) - area(b))
  const pick = t.nth !== undefined ? orderInDoc(matches)[t.nth] : matches[0]
  if (!pick) return null
  const el = t.closest ? (pick.closest(t.closest) as HTMLElement | null) ?? (pick as HTMLElement) : (pick as HTMLElement)
  return el
}

const area = (el: Element) => { const r = el.getBoundingClientRect(); return r.width * r.height }
const orderInDoc = (els: Element[]) => [...els].sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))

export class Cancelled extends Error {}

// ריצה שאפשר לבטל ולהשהות: כל המתנה בודקת אם עברנו לשלב אחר
export class Run {
  cancelled = false
  constructor(private isPlaying: () => boolean) {}
  check() { if (this.cancelled) throw new Cancelled() }
  async sleep(ms: number) {
    const end = Date.now() + ms
    while (Date.now() < end) {
      this.check()
      await new Promise((r) => setTimeout(r, Math.min(80, end - Date.now())))
    }
    this.check()
  }
  // זמן קריאה: עוצר כשההדגמה מושהית וממשיך מאותה נקודה
  async read(ms: number) {
    let left = ms
    while (left > 0) {
      this.check()
      await new Promise((r) => setTimeout(r, 80))
      if (this.isPlaying()) left -= 80
    }
  }
  async waitFor(t: Target, timeout = 6000): Promise<HTMLElement | null> {
    const end = Date.now() + timeout
    while (Date.now() < end) {
      this.check()
      const el = findTarget(t)
      if (el) return el
      await new Promise((r) => setTimeout(r, 100))
    }
    return null
  }
}

// הקלדה שגם React מזהה (דרך ה-setter המקורי ואירוע input)
export async function typeInto(run: Run, el: HTMLElement, text: string, clear = true, perChar = 55) {
  const input = el.matches('input, textarea') ? (el as HTMLInputElement | HTMLTextAreaElement) : (el.querySelector('input, textarea') as HTMLInputElement | null)
  if (!input) return
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!
  input.focus()
  let value = clear ? '' : input.value
  if (clear) { setter.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true })) }
  for (const ch of text) {
    value += ch
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await run.sleep(perChar)
  }
}

// בחירת אפשרות ברשימה נפתחת לפי הטקסט שלה, כמו שמשתמש היה בוחר
export function chooseOption(el: HTMLElement, text: string) {
  const select = el.matches('select') ? (el as HTMLSelectElement) : (el.querySelector('select') as HTMLSelectElement | null)
  if (!select) return
  const opt = [...select.options].find((o) => o.text.includes(text))
  if (!opt) return
  select.focus()
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, opt.value)
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

export function go(route: string) {
  const want = '#' + route
  if (window.location.hash !== want) window.location.hash = want
}
