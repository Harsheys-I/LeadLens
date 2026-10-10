import { appUrl, isDevHost } from '@/lib/app-base.ts'

export type SessionUser = {
  id: number
  username: string
  display_name?: string
  role_name?: string
  role_key?: string
  role_rank?: number
  is_super?: boolean
  permissions?: string[]
  must_change_password?: boolean
  telecaller_name?: string
}

export type ModuleTile = {
  id: string
  title: string
  href: string
  perm?: string
  superOnly?: boolean
  devOnly?: boolean
  desc: string
}

export function hasPermission(user: SessionUser | null, perm: string) {
  if (!user) return false
  if (user.is_super) return true
  return Array.isArray(user.permissions) && user.permissions.includes(perm)
}

export function hasAnyPermission(user: SessionUser | null, ...perms: string[]) {
  return perms.some((perm) => hasPermission(user, perm))
}

export function moduleTilesForUser(user: SessionUser | null): ModuleTile[] {
  if (!user) return []
  const tiles: ModuleTile[] = [
    {
      id: 'telecaller',
      title: 'LeadLens',
      href: appUrl('/TeleCallerAudit/#published'),
      perm: 'module.telecaller_audit',
      desc: 'Bucket 1 Followup Review, Run console, published dashboards',
    },
    {
      id: 'debug',
      title: 'DeBug Mode',
      href: appUrl('/DeBugMode/'),
      superOnly: true,
      devOnly: true,
      desc: 'Super User CSV prompt auditor — custom prompt and structured outputs',
    },
    {
      id: 'sales-graph',
      title: 'Sales Graph',
      href: appUrl('/SalesGraph/'),
      perm: 'module.sales_graph',
      desc: 'Published Leads, Visits and Booked charts from ERP Sync',
    },
    {
      id: 'erp-sync',
      title: 'ERP Sync',
      href: appUrl('/ERPSync/'),
      superOnly: true,
      desc: 'GitHub Actions sync for Lead Audit, Performance, and Sales Graph',
    },
    {
      id: 'seo',
      title: 'SEO',
      href: appUrl('/SEO/'),
      perm: 'module.seo',
      desc: 'Technical SEO audit, live scanner, schema studio and action plan',
    },
    {
      id: 'admin',
      title: 'Admin',
      href: appUrl('/admin/'),
      perm: 'module.admin',
      desc: 'Users, roles, access requests',
    },
  ]
  return tiles.filter((tile) => {
    if (tile.devOnly && !isDevHost()) return false
    if (tile.superOnly) return Boolean(user.is_super)
    if (user.is_super) return true
    return hasPermission(user, tile.perm || '')
  })
}

export function roleLabel(user: SessionUser | null) {
  if (!user) return ''
  if (user.is_super || user.role_key === 'super') return 'Super User'
  if (user.role_key === 'admin' || /admin/i.test(user.role_name || '')) return 'Admin'
  if (/tele/i.test(user.role_key || '') || /tele/i.test(user.role_name || '')) return 'TeleCaller'
  return user.role_name || 'TeleCaller'
}
