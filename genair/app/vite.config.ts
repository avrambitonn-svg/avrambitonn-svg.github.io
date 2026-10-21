import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// מדיניות אבטחת תוכן לגרסה שמתארחת (GitHub Pages / Vercel): סקריפטים רק מהאתר עצמו, בלי תוספים, בלי שינוי כתובת בסיס.
// connect-src פתוח ל-https/http כי כתובת השרת נקבעת בהגדרות; את ההגנה מפני framing אי אפשר לשים ב-meta (כותרת בשרת האירוח).
// בגרסת הקובץ היחיד (build:single) אין CSP: הסקריפט שם מוטמע, והקובץ נפתח גם מ-file://.
const POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https: http:",
  "media-src 'self' data: blob: https: http:",
  "font-src 'self' data:",
  "connect-src 'self' https: http: ws: wss:",
  "frame-src 'self' blob: https://www.google.com https://maps.google.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
].join('; ')

function contentSecurityPolicy(): Plugin {
  let skip = false
  return {
    name: 'content-security-policy',
    apply: 'build',
    configResolved(cfg) {
      skip = cfg.build.outDir === 'dist-single'
    },
    transformIndexHtml(html) {
      return skip ? html : html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${POLICY}" />`)
    },
  }
}

// base יחסי: האפליקציה עובדת מכל תת-נתיב (GitHub Pages, Vercel, שרת מקומי)
export default defineConfig({
  base: './',
  plugins: [react(), contentSecurityPolicy()],
  // מתי נבנתה הגרסה: מוצג בהגדרות ← נתונים, כדי לדעת איזו גרסה מותקנת
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
  server: { port: 5173 },
})
