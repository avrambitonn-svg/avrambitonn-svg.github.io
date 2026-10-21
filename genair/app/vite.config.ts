import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// מדיניות אבטחת תוכן (CSP) לבנייה הרגילה בלבד: סקריפטים רק מהאתר עצמו, בלי סקריפט מוטמע.
// לא בפיתוח (Vite מזריק סקריפטים), ולא בקובץ האחד (dist-single), שבו כל ה-JS מוטמע בדף.
// frame-src: המפה בתיק ובשטח (Google Maps) ותצוגת PDF מקובץ מקומי (blob). connect-src כולל data:/blob: לקריאת קבצים שמורים.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https: http://localhost:* ws://localhost:* data: blob:",
  "media-src 'self' blob: data:",
  "frame-src 'self' blob: https://maps.google.com https://www.google.com",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

function cspMeta(): Plugin {
  return {
    name: 'csp-meta',
    apply: (config, { command }) => command === 'build' && config.build?.outDir !== 'dist-single',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }],
  }
}

// base יחסי: האפליקציה עובדת מכל תת-נתיב (GitHub Pages, Vercel, שרת מקומי)
export default defineConfig({
  base: './',
  plugins: [react(), cspMeta()],
  // מתי נבנתה הגרסה: מוצג בהגדרות ← נתונים, כדי לדעת איזו גרסה מותקנת
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
  server: { port: 5173 },
})
