import { readdirSync, unlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const rootDir = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(rootDir, '../web-app')
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
        if (/-[A-Za-z0-9_-]{8}\.(js|css)$/.test(name)) unlinkSync(join(assetsDir, name))
      }
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), pruneHashedAssets(resolve(outDir, 'assets'))],
  resolve: {
    alias: {
      '@': resolve(rootDir, 'src'),
      '@bklitui/ui/charts': resolve(rootDir, 'src/components/charts/index.ts'),
    },
  },
  build: {
    outDir,
    emptyOutDir: false,
    assetsDir: 'assets',
    cssCodeSplit: false,
    rollupOptions: {
      input: Object.fromEntries(
        shells.map((dir) => [dir || 'index', resolve(rootDir, dir ? `${dir}/index.html` : 'index.html')]),
      ),
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  server: {
    proxy: {
      '/dev/api': { target: 'http://127.0.0.1:8080', changeOrigin: true },
      '/api': { target: 'http://127.0.0.1:8080', changeOrigin: true },
    },
  },
})
