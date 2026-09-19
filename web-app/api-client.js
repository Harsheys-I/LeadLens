/**
 * Thin fetch wrapper for LeadLens PHP API (same-origin, session cookie).
 */
import {apiBase} from './app-base.js?v=7.2.0.dev';

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
  orgCatalog: () => api('admin/org'),
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

export const TeamFormsApi = {
  workspace: () => api('team-forms/workspace'),
  listUsers: () => api('team-forms/users'),
  listDepartments: () => api('team-forms/departments'),
  createDepartment: (body) => api('team-forms/departments', {method: 'POST', body}),
  updateDepartment: (id, body) => api(`team-forms/departments/${id}/update`, {method: 'POST', body}),
  deleteDepartment: (id) => api(`team-forms/departments/${id}/delete`, {method: 'POST', body: {}}),
  listGroups: (departmentId) =>
    api(`team-forms/groups${departmentId ? `?department_id=${encodeURIComponent(departmentId)}` : ''}`),
  createGroup: (body) => api('team-forms/groups', {method: 'POST', body}),
  updateGroup: (id, body) => api(`team-forms/groups/${id}/update`, {method: 'POST', body}),
  deleteGroup: (id) => api(`team-forms/groups/${id}/delete`, {method: 'POST', body: {}}),
  listMembers: (groupId) => api(`team-forms/groups/${groupId}/members`),
  addMember: (groupId, body) => api(`team-forms/groups/${groupId}/members`, {method: 'POST', body}),
  removeMember: (groupId, body) =>
    api(`team-forms/groups/${groupId}/members`, {method: 'POST', body: {...body, action: 'remove'}}),
  listForms: (groupId) => api(`team-forms/groups/${groupId}/forms`),
  createForm: (groupId, body) => api(`team-forms/groups/${groupId}/forms`, {method: 'POST', body}),
  getForm: (id) => api(`team-forms/forms/${id}`),
  updateForm: (id, body) => api(`team-forms/forms/${id}/update`, {method: 'POST', body}),
  deleteForm: (id) => api(`team-forms/forms/${id}/delete`, {method: 'POST', body: {}}),
  addField: (formId, body) => api(`team-forms/forms/${formId}/fields`, {method: 'POST', body}),
  updateField: (formId, fieldId, body) =>
    api(`team-forms/forms/${formId}/fields/${fieldId}/update`, {method: 'POST', body}),
  deleteField: (formId, fieldId) =>
    api(`team-forms/forms/${formId}/fields/${fieldId}/delete`, {method: 'POST', body: {action: 'delete'}}),
  reorderFields: (formId, order) =>
    api(`team-forms/forms/${formId}/fields`, {method: 'POST', body: {action: 'reorder', order}}),
  assignForm: (formId, body) => api(`team-forms/forms/${formId}/create-tasks`, {method: 'POST', body}),
  createTasks: (formId, body) => api(`team-forms/forms/${formId}/create-tasks`, {method: 'POST', body}),
  listFormAssignments: (formId) => api(`team-forms/forms/${formId}/assign`),
  myTasks: (since) => api(`team-forms/tasks?mine=1${since ? `&since=${encodeURIComponent(since)}` : ''}`),
  reviewTasks: (since) =>
    api(`team-forms/review/tasks${since ? `?since=${encodeURIComponent(since)}` : ''}`),
  getTask: (id) => api(`team-forms/tasks/${id}`),
  assignTask: (id, body) => api(`team-forms/tasks/${id}/update`, {method: 'POST', body}),
  saveAnswers: (id, answers) => api(`team-forms/tasks/${id}/answers`, {method: 'POST', body: {answers}}),
  uploadTaskFile: (id, fieldId, file) => {
    const fd = new FormData();
    fd.append('field_id', String(fieldId));
    fd.append('file', file);
    return api(`team-forms/tasks/${id}/files`, {method: 'POST', body: fd});
  },
  taskFileUrl: (id, fieldId) =>
    `${resolveApiBase()}team-forms/tasks/${id}/file?field_id=${encodeURIComponent(fieldId)}`,
  setStatus: (id, status, extra = {}) =>
    api(`team-forms/tasks/${id}/status`, {method: 'POST', body: {status, ...extra}}),
  addComment: (id, bodyOrOpts) => {
    const opts = typeof bodyOrOpts === 'string' || bodyOrOpts == null
      ? {body: bodyOrOpts || ''}
      : bodyOrOpts;
    const fd = new FormData();
    fd.append('body', String(opts.body ?? ''));
    fd.append('links', JSON.stringify(Array.isArray(opts.links) ? opts.links : []));
    if (opts.time_spent_minutes != null && opts.time_spent_minutes !== '') {
      fd.append('time_spent_minutes', String(opts.time_spent_minutes));
    }
    for (const file of opts.files || []) fd.append('files[]', file);
    return api(`team-forms/tasks/${id}/comments`, {method: 'POST', body: fd});
  },
  submitTask: (id, opts = {}) => {
    const fd = new FormData();
    fd.append('body', String(opts.body ?? ''));
    fd.append('links', JSON.stringify(Array.isArray(opts.links) ? opts.links : []));
    for (const file of opts.files || []) fd.append('files[]', file);
    return api(`team-forms/tasks/${id}/submit`, {method: 'POST', body: fd});
  },
  commentFileUrl: (id, commentId, index) =>
    `${resolveApiBase()}team-forms/tasks/${id}/comment-file?comment_id=${encodeURIComponent(commentId)}&i=${encodeURIComponent(index)}`,
  approveTask: (id) => api(`team-forms/tasks/${id}/approve`, {method: 'POST', body: {}}),
  reworkTask: (id, note = '') =>
    api(`team-forms/tasks/${id}/rework`, {method: 'POST', body: {body: note}}),
  closeTask: (id) => api(`team-forms/tasks/${id}/close`, {method: 'POST', body: {}}),
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
