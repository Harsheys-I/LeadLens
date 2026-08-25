/**
 * Thin fetch wrapper for LeadLens PHP API (same-origin, session cookie).
 */
function resolveApiBase(){
  return '/api/';
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
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
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
  requestAccess: (payload) => api('auth/request-access', {method: 'POST', body: payload}),
};

export const AdminApi = {
  listUsers: () => api('admin/users'),
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
  markRead: (id) => api(`notifications/read/${id}`, {method: 'POST', body: {}}),
  markAllRead: () => api('notifications/read-all', {method: 'POST', body: {}}),
};

export const DashboardApi = {
  list: () => api('dashboards/list'),
  get: (id) => api(`dashboards/${id}`),
  publish: (dashboards) => api('dashboards/publish', {method: 'POST', body: {dashboards}}),
  remove: (id) => api(`dashboards/${id}`, {method: 'DELETE'}),
};
