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
    return currentUser;
  } catch (err) {
    currentUser = null;
    if (err.status === 401) return null;
    throw err;
  }
}

export async function login(username, password){
  const data = await AuthApi.login(username, password);
  currentUser = data.user;
  return currentUser;
}

export async function logout(){
  try { await AuthApi.logout(); } catch { /* ignore */ }
  currentUser = null;
}

export async function changePassword(currentPassword, newPassword){
  const data = await AuthApi.changePassword(currentPassword, newPassword);
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
      desc: 'Bucket 1 audits, Run console, published dashboards'
    },
    {
      id: 'crm',
      title: 'CRM',
      href: '#',
      perm: 'module.crm',
      soon: true,
      desc: 'Coming soon'
    },
    {
      id: 'hr',
      title: 'HR',
      href: '#',
      perm: 'module.hr',
      soon: true,
      desc: 'Coming soon'
    },
    {
      id: 'admin',
      title: 'Admin',
      href: '/admin/',
      perm: 'module.admin',
      soon: false,
      desc: 'Users, roles, access requests'
    },
  ];
  return tiles.filter(t => {
    if (user.is_super) return true;
    // Show coming-soon tiles if user has the module perm OR always show CRM/HR as soon if they have any module access?
    // Plan: tile visibility respects module permissions.
    return hasPermission(t.perm);
  });
}
