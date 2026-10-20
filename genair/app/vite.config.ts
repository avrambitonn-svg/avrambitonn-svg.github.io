import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base יחסי: האפליקציה עובדת מכל תת-נתיב (GitHub Pages, Vercel, שרת מקומי)
export default defineConfig({
  base: './',
  plugins: [react()],
  // מתי נבנתה הגרסה: מוצג בהגדרות ← נתונים, כדי לדעת איזו גרסה מותקנת
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
  server: { port: 5173 },
})
