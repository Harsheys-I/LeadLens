/**
 * Thin fetch wrapper for LeadLens PHP API (same-origin, session cookie).
 */
import {apiBase} from './app-base.js?v=8.0.0.stable';

function resolveApiBase(){
  return apiBase();
}

export async function api(path, {method = 'GET', body, signal} = {}){
  const url = resolveApiBase() + String(path).replace(/^\//, '');
  const opts = {
    method,
    credentials: 'same-origin',
    headers: {Accept: 'application/json'},
    signal
  };
  if (body !== undefined) {
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      opts.body = body;
    } else {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
  }
  const res = await fetch(url, opts);
  let data = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = {ok: false, error: text || res.statusText};
  }
  if (!res.ok || (data && data.ok === false)) {
    const err = new Error((data && data.error) || res.statusText || 'Request failed');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const AuthApi = {
  me: () => api('auth/me'),
  login: (username, password) => api('auth/login', {method: 'POST', body: {username, password}}),
  logout: () => api('auth/logout', {method: 'POST', body: {}}),
  changePassword: (current_password, new_password) =>
    api('auth/change-password', {method: 'POST', body: {current_password, new_password}}),
  updateProfile: (body) => api('auth/profile', {method: 'POST', body}),
  requestAccess: (payload) => api('auth/request-access', {method: 'POST', body: payload}),
};

export const AdminApi = {
  listUsers: () => api('admin/users'),
  getUser: (id) => api(`admin/users/${id}`),
  createUser: (body) => api('admin/users', {method: 'POST', body}),
  updateUser: (id, body) => api(`admin/users/${id}`, {method: 'PUT', body}),
  deleteUser: (id) => api(`admin/users/${id}`, {method: 'DELETE'}),
  listRoles: () => api('admin/roles'),
  createRole: (body) => api('admin/roles', {method: 'POST', body}),
  updateRole: (id, body) => api(`admin/roles/${id}`, {method: 'PUT', body}),
  deleteRole: (id) => api(`admin/roles/${id}`, {method: 'DELETE'}),
  listAccessRequests: (status = 'pending') => api(`admin/access-requests?status=${encodeURIComponent(status)}`),
  approveRequest: (id, body) => api(`admin/access-requests/${id}/approve`, {method: 'POST', body}),
  denyRequest: (id, body) => api(`admin/access-requests/${id}/deny`, {method: 'POST', body}),
};

export const NotifApi = {
  list: () => api('notifications'),
  // POST to /notifications with action in body — extra path segments and DELETE/PUT
  // are unreliable on Hostinger/LiteSpeed (rewrite truncation / method blocks).
  markRead: (id) => api('notifications', {method: 'POST', body: {action: 'read', id}}),
  markAllRead: () => api('notifications', {method: 'POST', body: {action: 'read-all'}}),
  clearAll: () => api('notifications', {method: 'POST', body: {action: 'clear-all'}}),
  clearOne: (id) => api('notifications', {method: 'POST', body: {action: 'clear', id}}),
};

export const DashboardApi = {
  list: () => api('dashboards/list'),
  get: (id) => api(`dashboards/${id}`),
  combined: () => api('dashboards/combined'),
  telecallerNames: () => api('dashboards/telecaller-names'),
  publish: (dashboards) => api('dashboards/publish', {method: 'POST', body: {dashboards}}),
  remove: (id) => api(`dashboards/${id}`, {method: 'DELETE'}),
  removeAll: () => api('dashboards/all', {method: 'DELETE'}),
};

export const PerfDashboardApi = {
  list: () => api('perf-dashboards/list'),
  combined: () => api('perf-dashboards/combined'),
  publish: (dashboards) => api('perf-dashboards/publish', {method: 'POST', body: {dashboards}}),
  removeAll: () => api('perf-dashboards/all', {method: 'DELETE'}),
};

export const SalesGraphApi = {
  latest: () => api('sales-graph/latest'),
  publish: (payload, {title, meta} = {}) =>
    api('sales-graph/publish', {method: 'POST', body: {payload, title, meta}}),
  removeAll: () => api('sales-graph/all', {method: 'DELETE'}),
};

export const SettingsApi = {
  getAudit: () => api('settings/audit'),
  saveAudit: (settings) => api('settings/audit', {method: 'PUT', body: {settings}}),
  getDebug: () => api('settings/debug'),
  saveDebug: (settings) => api('settings/debug', {method: 'PUT', body: {settings}}),
  openaiKeyStatus: () => api('settings/openai-key-status'),
  getOpenaiKey: () => api('settings/openai-key'),
  // POST — Hostinger/shared hosts often block PUT
  saveOpenaiKey: (api_key) => api('settings/openai-key', {method: 'POST', body: {api_key}}),
  // POST clear — Hostinger/shared hosts often block DELETE
  clearOpenaiKey: () => api('settings/openai-key', {method: 'POST', body: {clear: true}}),
};

export const ErpSyncApi = {
  status: () => api('erp-sync/status'),
  getConfig: () => api('erp-sync/config'),
  saveConfig: (body) => api('erp-sync/config', {method: 'POST', body}),
  testFetch: () => api('erp-sync/test-fetch', {method: 'POST', body: {}}),
  fetchForAudit: () => api('erp-sync/fetch-for-audit', {method: 'POST', body: {}}),
  latestLeads: (meta = false) => api(`erp-sync/latest-leads${meta ? '?meta=1' : ''}`),
  run: (body = {}) => api('erp-sync/run', {method: 'POST', body}),
  daily: (body = {}) => api('erp-sync/daily', {method: 'POST', body}),
  continue: (body = {}) => api('erp-sync/continue', {method: 'POST', body}),
  keepalive: () => api('erp-sync/keepalive', {method: 'POST', body: {}}),
  publish: () => api('erp-sync/publish', {method: 'POST', body: {}}),
  job: (full = false) => api(`erp-sync/job${full ? '?full=1' : ''}`),
};

export const JobsApi = {
  list: () => api('jobs/list'),
  get: (jobId) => api(`jobs/${encodeURIComponent(jobId)}`),
  upsert: (job) => api('jobs/upsert', {method: 'POST', body: {job}}),
  // POST — Hostinger/shared hosts often block DELETE
  remove: (jobId) => api('jobs/delete', {method: 'POST', body: {job_id: jobId}}),
  clear: () => api('jobs/clear', {method: 'POST', body: {}}),
};
