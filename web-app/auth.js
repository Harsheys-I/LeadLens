/**
 * Session helpers + permission checks for LeadLens shells.
 */
import {AuthApi} from './api-client.js';

let currentUser = null;

export function getUser(){
  return currentUser;
}

export function hasPermission(perm){
  if (!currentUser) return false;
  if (currentUser.is_super) return true;
  return Array.isArray(currentUser.permissions) && currentUser.permissions.includes(perm);
}

export function hasAnyPermission(...perms){
  return perms.some(p => hasPermission(p));
}

export async function loadSession(){
  try {
    const data = await AuthApi.me();
    currentUser = data.user || null;
    if (currentUser) {
      try { sessionStorage.setItem('ll_session_hint', '1'); } catch { /* ignore */ }
    } else {
      try { sessionStorage.removeItem('ll_session_hint'); } catch { /* ignore */ }
    }
    return currentUser;
  } catch (err) {
    currentUser = null;
    if (err.status === 401) {
      try { sessionStorage.removeItem('ll_session_hint'); } catch { /* ignore */ }
      return null;
    }
    throw err;
  }
}

export function hasSessionHint(){
  try { return sessionStorage.getItem('ll_session_hint') === '1'; }
  catch { return false; }
}

export async function login(username, password){
  const data = await AuthApi.login(username, password);
  currentUser = data.user;
  try { sessionStorage.setItem('ll_session_hint', '1'); } catch { /* ignore */ }
  return currentUser;
}

export async function logout(){
  try { await AuthApi.logout(); } catch { /* ignore */ }
  currentUser = null;
  try { sessionStorage.removeItem('ll_session_hint'); } catch { /* ignore */ }
}

export async function changePassword(currentPassword, newPassword){
  const data = await AuthApi.changePassword(currentPassword, newPassword);
  currentUser = data.user;
  return currentUser;
}

export async function updateProfile({username, display_name} = {}){
  const body = {};
  if (username != null) body.username = username;
  if (display_name != null) body.display_name = display_name;
  const data = await AuthApi.updateProfile(body);
  currentUser = data.user;
  return currentUser;
}

/** Redirect to login (home) if no session. Returns user or null after redirect. */
export async function requireAuth({loginPath = '/'} = {}){
  const user = await loadSession();
  if (user) return user;
  const path = location.pathname.replace(/\/index\.html$/i, '/');
  const onLogin = path === '/' || path === '';
  if (onLogin) return null;
  const next = encodeURIComponent(location.pathname + location.search + location.hash);
  location.href = `${loginPath}?next=${next}`;
  return null;
}

export function requirePermission(perm, {fallback = '/'} = {}){
  if (!hasPermission(perm)) {
    location.href = fallback;
    return false;
  }
  return true;
}

export function moduleTilesForUser(user = currentUser){
  if (!user) return [];
  const tiles = [
    {
      id: 'telecaller',
      title: 'TeleCaller Audit',
      href: '/TeleCallerAudit/',
      perm: 'module.telecaller_audit',
      soon: false,
      desc: 'Bucket 1 audits, Run console, published dashboards',
      icon: `<svg viewBox="0 0 96 96" fill="none" aria-hidden="true">
        <rect x="22" y="18" width="36" height="48" rx="8" stroke="currentColor" stroke-width="3.5"/>
        <path d="M32 32h16M32 42h12M32 52h8" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
        <circle cx="62" cy="58" r="14" stroke="currentColor" stroke-width="3.5"/>
        <path d="M56.5 58c0-3 2.5-5.5 5.5-5.5s5.5 2.5 5.5 5.5" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
        <path d="M67.5 65v5c0 2-1.5 3.5-3.5 3.5h-4" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
      </svg>`
    },
    {
      id: 'debug',
      title: 'DeBug Mode',
      href: '/DeBugMode/',
      superOnly: true,
      soon: false,
      desc: 'SuperUser CSV prompt auditor — custom prompt + Structured Outputs',
      icon: `<svg viewBox="0 0 96 96" fill="none" aria-hidden="true">
        <rect x="18" y="22" width="60" height="52" rx="8" stroke="currentColor" stroke-width="3.5"/>
        <path d="M30 40h36M30 52h24M30 64h16" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
        <path d="M58 58l8 8M66 58l-8 8" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>
      </svg>`
    },
    {
      id: 'admin',
      title: 'Admin',
      href: '/admin/',
      perm: 'module.admin',
      soon: false,
      desc: 'Users, roles, access requests',
      icon: `<svg viewBox="0 0 96 96" fill="none" aria-hidden="true">
        <circle cx="48" cy="34" r="14" stroke="currentColor" stroke-width="3.5"/>
        <path d="M22 78c3.5-16 14-24 26-24s22.5 8 26 24" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>
        <path d="M64 28h12M70 22v12" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>
      </svg>`
    },
  ];
  return tiles.filter(t => {
    if (t.superOnly) return Boolean(user.is_super);
    if (user.is_super) return true;
    return hasPermission(t.perm);
  });
}
