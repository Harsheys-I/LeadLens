import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import Loader from '@/components/ui/loader.tsx'
import { useAuth } from '@/lib/auth.tsx'
import type { SessionUser } from '@/lib/session.ts'

export function ModuleGuard({ allow, children }: { allow: (user: SessionUser) => boolean; children: ReactNode }) {
  const { user, ready } = useAuth()
  if (!ready) {
    return (
      <div className="grid min-h-svh place-items-center">
        <Loader size="lg" title="Checking session" subtitle="GPP AI" />
      </div>
    )
  }
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search + location.hash)
    return <Navigate to={`/?next=${next}`} replace />
  }
  if (user.must_change_password) return <Navigate to="/" replace />
  if (!allow(user)) return <Navigate to="/" replace />
  return children
}
