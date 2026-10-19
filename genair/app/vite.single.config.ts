import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, mergeConfig, type Plugin } from 'vite'
import base from './vite.config'

// קובץ HTML אחד שנפתח בלחיצה כפולה, בלי שרת ובלי התקנה: כל ה-JS, ה-CSS והאייקון בתוכו.
// נוח לשלוח ללקוח או לפתוח במחשב בלי אינטרנט מקומי. בונים עם: npm run build:single
function inlineAll(): Plugin {
  return {
    name: 'inline-all',
    apply: 'build',
    // אחרי הכתיבה לדיסק, כשכל ההחלפות של Vite כבר נעשו: מכניסים את הקבצים לתוך ה-HTML ומוחקים אותם
    writeBundle(options) {
      const dir = options.dir!
      const page = join(dir, 'index.html')
      let src = readFileSync(page, 'utf8')
      src = src.replace(/<script type="module" crossorigin src="\.\/([^"]+)"><\/script>/g, (_, f: string) => `<script type="module">${readFileSync(join(dir, f), 'utf8').replace(/<\/script/gi, '<\\/script')}</script>`)
      src = src.replace(/<link rel="stylesheet" crossorigin href="\.\/([^"]+)">/g, (_, f: string) => `<style>${readFileSync(join(dir, f), 'utf8')}</style>`)
      src = src.replace(/<link rel="modulepreload"[^>]*>\s*/g, '').replace(/<link rel="manifest"[^>]*>\s*/, '')
      const icon = `data:image/svg+xml,${encodeURIComponent(readFileSync(new URL('./public/favicon.svg', import.meta.url), 'utf8'))}`
      writeFileSync(page, src.replace('href="./favicon.svg"', `href="${icon}"`))
      rmSync(join(dir, 'assets'), { recursive: true, force: true })
    },
  }
}

export default mergeConfig(base, defineConfig({
  publicDir: false,
  plugins: [inlineAll()],
  build: { outDir: 'dist-single', chunkSizeWarningLimit: 4000, cssCodeSplit: false, assetsInlineLimit: 100_000_000, rollupOptions: { output: { inlineDynamicImports: true } } },
}))
