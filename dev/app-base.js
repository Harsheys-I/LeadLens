/**
 * Site prefix when served under /dev (Hostinger staging) vs production /.
 */
const DEV_PREFIX = '/dev';

export function isDevHost(pathname = location.pathname){
  const path = String(pathname || '');
  return path === DEV_PREFIX || path.startsWith(DEV_PREFIX + '/');
}

/** '' on production, '/dev' on staging (no trailing slash). */
export function appBase(pathname = location.pathname){
  return isDevHost(pathname) ? DEV_PREFIX : '';
}

/** Absolute-from-host path. `appUrl('/api/')` → `/dev/api/` or `/api/`. */
export function appUrl(path = '/', pathname = location.pathname){
  const p = path.startsWith('/') ? path : `/${path}`;
  return appBase(pathname) + p;
}

export function homePath(pathname = location.pathname){
  return isDevHost(pathname) ? `${DEV_PREFIX}/` : '/';
}

export function apiBase(pathname = location.pathname){
  return appUrl('/api/', pathname);
}

export function isHomePath(pathname = location.pathname){
  const path = String(pathname).replace(/\/index\.html$/i, '/');
  if (isDevHost(path) || isDevHost(pathname)) {
    return path === `${DEV_PREFIX}/` || path === DEV_PREFIX;
  }
  return path === '/' || path === '';
}
