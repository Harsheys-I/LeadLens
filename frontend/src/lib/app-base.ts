import { apiBase as pathsApiBase, appRoot, homeHref, isDevPath } from '@/lib/paths.ts'

export function isDevHost(pathname = location.pathname) {
  return isDevPath(pathname)
}

export function appBase(pathname = location.pathname) {
  return isDevPath(pathname) ? '/dev' : ''
}

export function appUrl(path = '/', pathname = location.pathname) {
  const p = path.startsWith('/') ? path : `/${path}`
  return appBase(pathname) + p
}

export function homePath() {
  return homeHref()
}

export function apiBase(pathname = location.pathname) {
  return isDevPath(pathname) ? pathsApiBase() : '/api/'
}

export function isHomePath(pathname = location.pathname) {
  const path = String(pathname).replace(/\/index\.html$/i, '/')
  if (isDevPath(path)) return path === '/dev/' || path === '/dev'
  return path === '/' || path === ''
}

export { appRoot }
