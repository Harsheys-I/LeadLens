/**
 * Session helpers + permission checks for LeadLens shells.
 */
import {AuthApi} from './api-client.js?v=8.0.1.kpi-fix';
import {appUrl, homePath, isHomePath, isDevHost} from './app-base.js?v=8.0.1.kpi-fix';

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
export async function requireAuth({loginPath = homePath()} = {}){
  const user = await loadSession();
  if (user) return user;
  if (isHomePath()) return null;
  const next = encodeURIComponent(location.pathname + location.search + location.hash);
  location.href = `${loginPath}?next=${next}`;
  return null;
}

export function requirePermission(perm, {fallback = homePath()} = {}){
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
      title: 'LeadLens',
      href: appUrl('/TeleCallerAudit/'),
      perm: 'module.telecaller_audit',
      soon: false,
      desc: 'Bucket 1 Followup Review, Run console, published dashboards',
      icon: '📊'
    },
    {
      id: 'debug',
      title: 'DeBug Mode',
      href: appUrl('/DeBugMode/'),
      superOnly: true,
      devOnly: true,
      soon: false,
      desc: 'SuperUser CSV prompt auditor — custom prompt + Structured Outputs',
      icon: '🧪'
    },
    {
      id: 'sales-graph',
      title: 'Sales Graph',
      href: appUrl('/SalesGraph/'),
      perm: 'module.sales_graph',
      soon: false,
      desc: 'Leads & Visits Excel upload, published charts and tables',
      icon: '📈'
    },
    {
      id: 'seo',
      title: 'SEO',
      href: appUrl('/SEO/'),
      perm: 'module.seo',
      soon: false,
      desc: 'Technical SEO audit, live scanner, schema studio & action plan',
      icon: '🔍'
    },
    {
      id: 'admin',
      title: 'Admin',
      href: appUrl('/admin/'),
      perm: 'module.admin',
      soon: false,
      desc: 'Users, roles, access requests',
      icon: '🛡️'
    },
  ];
  return tiles.filter(t => {
    if (t.devOnly && !isDevHost()) return false;
    if (t.superOnly) return Boolean(user.is_super);
    if (user.is_super) return true;
    return hasPermission(t.perm);
  });
}
