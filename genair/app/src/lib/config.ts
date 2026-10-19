// רשימות שהמנהל עורך בעצמו (הגדרות ← רשימות). ברירות המחדל ב-configDefaults.ts; מה שנשמר נמצא ב-db.config.
import type { Config, ListOption } from './types'
import { app, useApp } from './store'
import { defaultConfig } from './configDefaults'

export { defaultConfig }

// השלמת שדות חסרים בהגדרות שנשמרו בגרסה קודמת
export function withConfigDefaults(c?: Partial<Config>): Config {
  return { ...defaultConfig(), ...(c ?? {}) }
}

export const config = () => app().db.config
export function useConfig<T>(sel: (c: Config) => T): T {
  return useApp((s) => sel(s.db.config))
}
export const setConfig = (p: Partial<Config>) => app().setConfig(p)

type ListKey = { [K in keyof Config]: Config[K] extends ListOption[] ? K : never }[keyof Config]
export function optionOf(list: ListKey, key?: string): ListOption | undefined {
  return key ? (config()[list] as ListOption[]).find((o) => o.key === key) : undefined
}
export const labelOf = (list: ListKey, key?: string) => optionOf(list, key)?.label ?? key ?? ''
