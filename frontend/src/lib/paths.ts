type AccessUser = {
  is_super?: boolean
  permissions?: string[]
} | null

function canOpen(user: AccessUser, perm: string) {
  if (!user) return false
  if (user.is_super) return true
  return Array.isArray(user.permissions) && user.permissions.includes(perm)
}

export const MODULE_DIRS = {
  telecaller: 'TeleCallerAudit',
  sales: 'SalesGraph',
  seo: 'SEO',
  admin: 'admin',
  debug: 'DeBugMode',
  erp: 'ERPSync',
} as const

export type ModuleKey = keyof typeof MODULE_DIRS

const DIR_TO_MODULE = Object.fromEntries(Object.entries(MODULE_DIRS).map(([key, dir]) => [dir, key])) as Record<string, ModuleKey>

export type Tile = {
  key: ModuleKey
  title: string
  description: string
  color: string
  perm?: string
  superOnly?: boolean
  devOnly?: boolean
}

export const TILES: Tile[] = [
  { key: 'telecaller', title: 'LeadLens', description: 'Bucket 1 follow-up review, dashboards, and export', color: '#1f5d45', perm: 'module.telecaller_audit' },
  { key: 'sales', title: 'Sales Graph', description: 'Published Leads, Visits, and Booked charts from ERP Sync', color: '#c4a35a', perm: 'module.sales_graph' },
  { key: 'seo', title: 'SEO', description: 'Technical audit, live scanner, schema studio, and the action plan', color: '#2a5f9e', perm: 'module.seo' },
  { key: 'admin', title: 'Admin', description: 'Users, roles, and who can open each module', color: '#6d4ab8', perm: 'module.admin' },
  { key: 'debug', title: 'Debug', description: 'Super User CSV prompt auditor', color: '#a33a32', superOnly: true, devOnly: true },
  { key: 'erp', title: 'ERP Sync', description: 'GitHub Actions sync for Lead Audit, Performance, and Sales Graph', color: '#2a6f7a', superOnly: true },
]

export const VIEW_ORDER = ['home', ...TILES.map((tile) => tile.key)]

export function isDevPath(pathname = location.pathname) {
  return pathname === '/dev' || pathname.startsWith('/dev/')
}

export function appRoot() {
  return isDevPath() ? '/dev/' : '/'
}

export function apiBase() {
  return isDevPath() ? '/dev/api/' : '/api/'
}

export function homeHref() {
  return appRoot()
}

export function moduleHref(key: string) {
  const dir = MODULE_DIRS[key as ModuleKey]
  return dir ? `${appRoot()}${dir}/` : homeHref()
}

export function assetUrl(path: string) {
  return `${appRoot()}${String(path).replace(/^\//, '')}`
}

export function moduleFromPath(pathname = location.pathname): ModuleKey | 'home' | null {
  let path = String(pathname || '')
  try { path = decodeURI(path) } catch { /* keep */ }
  path = path.replace(/\/+$/, '')
  if (path.startsWith('/dev/')) path = path.slice(4)
  else if (path === '/dev') path = ''
  path = path.replace(/\/index\.html$/, '').replace(/\/+$/, '')
  const seg = path.split('/').filter(Boolean)[0] || ''
  if (!seg || seg === 'index.html') return 'home'
  return DIR_TO_MODULE[seg] || null
}

export function moduleFromHref(href: string | null) {
  if (!href || href.startsWith('#')) return null
  let url: URL
  try { url = new URL(href, location.href) } catch { return null }
  if (url.origin !== location.origin) return null
  return moduleFromPath(url.pathname)
}

export function detectModule() {
  return moduleFromPath(location.pathname) || 'home'
}

export function slideDirection(from: string, to: string) {
  const a = VIEW_ORDER.indexOf(from)
  const b = VIEW_ORDER.indexOf(to)
  return b >= a ? 1 : -1
}

export function allowedModules(user: AccessUser) {
  if (!user) return []
  return TILES.filter((tile) => {
    if (tile.devOnly && !isDevPath()) return false
    if (tile.superOnly) return Boolean(user.is_super)
    if (user.is_super) return true
    return canOpen(user, tile.perm || '')
  })
}
