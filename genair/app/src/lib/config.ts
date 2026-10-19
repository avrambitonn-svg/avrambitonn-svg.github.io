// רשימות שהמנהל עורך בעצמו (הגדרות ← רשימות). ברירות המחדל ב-configDefaults.ts; מה שנשמר נמצא ב-db.config.
import { useEffect } from 'react'
import type { Config, ListOption } from './types'
import { app, useApp } from './store'
import { defaultConfig } from './configDefaults'

export { defaultConfig }

// השלמת שדות חסרים בהגדרות שנשמרו בגרסה קודמת
export function withConfigDefaults(c?: Partial<Config>): Config {
  return { ...defaultConfig(), ...(c ?? {}) }
}

export const config = () => app().db.config
// שימו לב: הבורר צריך להחזיר ערך קיים (רשימה, מחרוזת), לא מערך חדש. סינון עושים ב-useMemo.
export function useConfig<T>(sel: (c: Config) => T): T {
  return useApp((s) => sel(s.db.config))
}
export const setConfig = (p: Partial<Config>) => app().setConfig(p)

export type ListKey = { [K in keyof Config]-?: Config[K] extends ListOption[] ? K : never }[keyof Config]
export function optionOf(list: ListKey, key?: string): ListOption | undefined {
  return key ? (config()[list] as ListOption[]).find((o) => o.key === key) : undefined
}
// תווית לפי מפתח; ערך שאינו מפתח (טקסט חופשי מגרסה קודמת) מוצג כמו שהוא
export const labelOf = (list: ListKey, key?: string) => optionOf(list, key)?.label ?? key ?? ''
export const colorOf = (list: ListKey, key?: string) => optionOf(list, key)?.color
// לבחירה בטפסים: רק פעילים, ועוד הערך הנוכחי אם הושבת (כדי שלא ייעלם מרשומה ישנה)
export function choices<T extends ListOption>(list: T[], current?: string): T[] {
  return list.filter((o) => o.active || o.key === current)
}
// מפתח לפי תווית או מפתח (תגיות נשמרות בתיק כטקסט)
export function findOption<T extends ListOption>(list: T[], v?: string): T | undefined {
  return v ? list.find((o) => o.key === v || o.label === v) : undefined
}

// מפתח חדש לפריט שהמשתמש הוסיף (לא משתנה כשמשנים את השם)
export const newKey = (prefix = 'x') => `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`

// ---------- ערכת צבע ----------
export const themes: { key: Config['theme']; label: string; swatch: [string, string] }[] = [
  { key: 'genair', label: 'ג׳נאייר (תכלת)', swatch: ['#00aeef', '#1c2127'] },
  { key: 'navy', label: 'כחול כהה', swatch: ['#1d4ed8', '#14213d'] },
  { key: 'green', label: 'ירוק', swatch: ['#047857', '#1c2127'] },
  { key: 'orange', label: 'כתום', swatch: ['#c2410c', '#1c2127'] },
]

export function applyTheme(t?: Config['theme']) {
  if (typeof document === 'undefined') return
  const v = t && t !== 'genair' ? t : 'genair'
  if (document.documentElement.dataset.theme !== v) document.documentElement.dataset.theme = v
}

// מחברים פעם אחת ב-Layout: ערכת הצבע מההגדרות חלה על כל המסכים
export function useThemeSync() {
  const theme = useApp((s) => s.db.config?.theme)
  useEffect(() => applyTheme(theme), [theme])
}
