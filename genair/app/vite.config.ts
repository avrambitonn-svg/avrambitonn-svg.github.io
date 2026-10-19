import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base יחסי: האפליקציה עובדת מכל תת-נתיב (GitHub Pages, Vercel, שרת מקומי)
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
  server: { port: 5173 },
})
