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
        <rect x="18" y="22" width="40" height="54" rx="10" stroke="currentColor" stroke-width="3"/>
        <path d="M28 34h20M28 44h16M28 54h12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
        <circle cx="64" cy="58" r="16" stroke="currentColor" stroke-width="3"/>
        <path d="M58 58c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
        <path d="M70 66v6c0 2.2-1.8 4-4 4h-4" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
        <path d="M74 40c4 4 6 9 6 14" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" opacity=".55"/>
        <path d="M80 34c6 6 9 13.5 9 22" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" opacity=".35"/>
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
        <circle cx="36" cy="30" r="12" stroke="currentColor" stroke-width="3"/>
        <path d="M16 72c2.5-14 11-20 20-20s17.5 6 20 20" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
        <circle cx="66" cy="34" r="9" stroke="currentColor" stroke-width="2.8"/>
        <path d="M54 70c1.6-9 7.2-13 12-13 3.2 0 6.4 1.6 8.8 4.4" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/>
        <rect x="58" y="54" width="24" height="16" rx="4" stroke="currentColor" stroke-width="2.8"/>
        <circle cx="70" cy="62" r="2.5" fill="currentColor"/>
        <path d="M70 64.5V68" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
      </svg>`
    },
  ];
  return tiles.filter(t => {
    if (user.is_super) return true;
    return hasPermission(t.perm);
  });
}
