import { apiBase } from '@/lib/app-base.ts'

export class ApiError extends Error {
  status: number
  data: unknown
  constructor(message: string, status: number, data: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data
  }
}

export async function api(path: string, { method = 'GET', body, signal }: { method?: string; body?: unknown; signal?: AbortSignal } = {}) {
  const url = apiBase() + String(path).replace(/^\//, '')
  const headers: Record<string, string> = { Accept: 'application/json' }
  const opts: RequestInit = { method, credentials: 'same-origin', headers, signal }
  if (body !== undefined) {
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      opts.body = body
    } else {
      headers['Content-Type'] = 'application/json'
      opts.body = JSON.stringify(body)
    }
  }
  const res = await fetch(url, opts)
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { ok: false, error: text || res.statusText }
  }
  const record = data && typeof data === 'object' ? (data as { ok?: boolean; error?: string }) : null
  if (!res.ok || record?.ok === false) {
    throw new ApiError(record?.error || res.statusText || 'Request failed', res.status, data)
  }
  return data as Record<string, unknown>
}

export const AuthApi = {
  me: () => api('auth/me'),
  login: (username: string, password: string) => api('auth/login', { method: 'POST', body: { username, password } }),
  logout: () => api('auth/logout', { method: 'POST', body: {} }),
  changePassword: (current_password: string, new_password: string) =>
    api('auth/change-password', { method: 'POST', body: { current_password, new_password } }),
  updateProfile: (body: { username?: string; display_name?: string }) => api('auth/profile', { method: 'POST', body }),
  requestAccess: (payload: Record<string, string>) => api('auth/request-access', { method: 'POST', body: payload }),
}

export const AdminApi = {
  listUsers: () => api('admin/users'),
  getUser: (id: number) => api(`admin/users/${id}`),
  createUser: (body: Record<string, unknown>) => api('admin/users', { method: 'POST', body }),
  updateUser: (id: number, body: Record<string, unknown>) => api(`admin/users/${id}`, { method: 'PUT', body }),
  deleteUser: (id: number) => api(`admin/users/${id}`, { method: 'DELETE' }),
  listRoles: () => api('admin/roles'),
  createRole: (body: Record<string, unknown>) => api('admin/roles', { method: 'POST', body }),
  updateRole: (id: number, body: Record<string, unknown>) => api(`admin/roles/${id}`, { method: 'PUT', body }),
  deleteRole: (id: number) => api(`admin/roles/${id}`, { method: 'DELETE' }),
  listAccessRequests: (status = 'pending') => api(`admin/access-requests?status=${encodeURIComponent(status)}`),
  approveRequest: (id: number, body: Record<string, unknown>) =>
    api(`admin/access-requests/${id}/approve`, { method: 'POST', body }),
  denyRequest: (id: number, body: Record<string, unknown>) =>
    api(`admin/access-requests/${id}/deny`, { method: 'POST', body }),
}

export const NotifApi = {
  list: () => api('notifications'),
  markRead: (id: number) => api('notifications', { method: 'POST', body: { action: 'read', id } }),
  markAllRead: () => api('notifications', { method: 'POST', body: { action: 'read-all' } }),
  clearAll: () => api('notifications', { method: 'POST', body: { action: 'clear-all' } }),
  clearOne: (id: number) => api('notifications', { method: 'POST', body: { action: 'clear', id } }),
}

export const DashboardApi = {
  list: () => api('dashboards/list'),
  get: (id: number) => api(`dashboards/${id}`),
  combined: () => api('dashboards/combined'),
  telecallerNames: () => api('dashboards/telecaller-names'),
  publish: (dashboards: unknown[]) => api('dashboards/publish', { method: 'POST', body: { dashboards } }),
  remove: (id: number) => api(`dashboards/${id}`, { method: 'DELETE' }),
  removeAll: () => api('dashboards/all', { method: 'DELETE' }),
}

export const PerfDashboardApi = {
  list: () => api('perf-dashboards/list'),
  combined: () => api('perf-dashboards/combined'),
  publish: (dashboards: unknown[]) => api('perf-dashboards/publish', { method: 'POST', body: { dashboards } }),
  removeAll: () => api('perf-dashboards/all', { method: 'DELETE' }),
}

export const SalesGraphApi = {
  latest: () => api('sales-graph/latest'),
  publish: (payload: unknown, { title, meta }: { title?: string; meta?: unknown } = {}) =>
    api('sales-graph/publish', { method: 'POST', body: { payload, title, meta } }),
  removeAll: () => api('sales-graph/all', { method: 'DELETE' }),
}

export const SettingsApi = {
  getAudit: () => api('settings/audit'),
  saveAudit: (settings: unknown) => api('settings/audit', { method: 'PUT', body: { settings } }),
  getDebug: () => api('settings/debug'),
  saveDebug: (settings: unknown) => api('settings/debug', { method: 'PUT', body: { settings } }),
  openaiKeyStatus: () => api('settings/openai-key-status'),
  getOpenaiKey: () => api('settings/openai-key'),
  saveOpenaiKey: (api_key: string) => api('settings/openai-key', { method: 'POST', body: { api_key } }),
  clearOpenaiKey: () => api('settings/openai-key', { method: 'POST', body: { clear: true } }),
}

export const ErpSyncApi = {
  status: () => api('erp-sync/status'),
  trigger: (body: Record<string, unknown> = {}) => api('erp-sync/trigger', { method: 'POST', body }),
  ghaStatus: () => api('erp-sync/gha-status'),
  continue: (body: Record<string, unknown> = {}) => api('erp-sync/continue', { method: 'POST', body }),
  publish: () => api('erp-sync/publish', { method: 'POST', body: {} }),
  job: (full = false) => api(`erp-sync/job${full ? '?full=1' : ''}`),
  diagnose: () => api('erp-sync/diagnose'),
  kick: (body: Record<string, unknown> = {}) => api('erp-sync/kick', { method: 'POST', body }),
  clearLock: (force = false) => api('erp-sync/clear-lock', { method: 'POST', body: { force: Boolean(force) } }),
}

export const JobsApi = {
  list: () => api('jobs/list'),
  get: (jobId: string) => api(`jobs/${encodeURIComponent(jobId)}`),
  upsert: (job: unknown) => api('jobs/upsert', { method: 'POST', body: { job } }),
  remove: (jobId: string) => api('jobs/delete', { method: 'POST', body: { job_id: jobId } }),
  clear: () => api('jobs/clear', { method: 'POST', body: {} }),
}
