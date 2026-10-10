import { readdirSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const rootDir = import.meta.dirname

/**
 * Emit the seven route shells into `web-app/` so Hostinger URLs are the React
 * app. `emptyOutDir` stays false: emptying `web-app/` would delete `api/`, PHP,
 * Excel templates, and the JS modules the publishers still run.
 * Hashed bundles land in `web-app/assets/` beside shared images. Only previous
 * Vite hashes are removed; `gpp-ai-logo.png` and other non-hashed files stay.
 */
const outDir = resolve(rootDir, '../web-app')
const assetsDirName = 'assets'

const shells = ['', 'TeleCallerAudit', 'SalesGraph', 'ERPSync', 'SEO', 'admin', 'DeBugMode']

function pruneHashedAssets(assetsDir: string): Plugin {
  return {
    name: 'prune-hashed-assets',
    buildStart() {
      let names: string[] = []
      try {
        names = readdirSync(assetsDir)
      } catch {
        return
      }
      for (const name of names) {
        if (/-[A-Za-z0-9_-]{8}\.(js|css)$/.test(name)) {
          unlinkSync(join(assetsDir, name))
        }
      }
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), pruneHashedAssets(resolve(outDir, assetsDirName))],
  resolve: {
    alias: {
      '@': resolve(rootDir, 'src'),
    },
  },
  build: {
    outDir,
    emptyOutDir: false,
    assetsDir: assetsDirName,
    rollupOptions: {
      input: Object.fromEntries(
        shells.map((dir) => [
          dir || 'index',
          resolve(rootDir, dir ? `${dir}/index.html` : 'index.html'),
        ]),
      ),
    },
  },
})
