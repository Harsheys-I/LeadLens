import { useCallback, useEffect, useRef, useState } from 'react'
import Loader from '@/components/ui/loader.tsx'
import Shell from '@/components/shell/Shell.tsx'
import { useAuth } from '@/lib/auth.tsx'
import { allowedModules, detectModule, homeHref, moduleFromHref, moduleFromPath, moduleHref, slideDirection, type ModuleKey } from '@/lib/paths.ts'
import { initTheme } from '@/lib/theme.ts'
import { LoginView } from '@/views/AuthViews.tsx'
import HomeView from '@/views/HomeView.tsx'
import AdminPage from '@/pages/admin-page.tsx'
import DebugPage from '@/pages/debug-page.tsx'
import ErpPage from '@/pages/erp-page.tsx'
import LeadLensPage from '@/pages/leadlens-page.tsx'
import SalesGraphPage from '@/pages/sales-graph-page.tsx'
import SeoPage from '@/pages/seo-page.tsx'

export default function App() {
  const { user, ready } = useAuth()
  const [view, setView] = useState(() => detectModule())
  const [direction, setDirection] = useState(0)
  const viewRef = useRef(view)
  viewRef.current = view

  const go = useCallback((next: string, history = true) => {
    let target: ModuleKey | 'home' = (next || 'home') as ModuleKey | 'home'
    if (user && target !== 'home') {
      const allowed = new Set(allowedModules(user).map((item) => item.key))
      if (!allowed.has(target as never)) target = 'home'
    }
    if (target === viewRef.current) return
    setDirection(slideDirection(viewRef.current, target))
    viewRef.current = target
    setView(target)
    if (history) {
      const url = target === 'home' ? homeHref() : moduleHref(target)
      window.history.pushState({ module: target }, '', url)
    }
  }, [user])

  const goRef = useRef(go)
  goRef.current = go

  useEffect(() => { initTheme() }, [])

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = (event.target as Element | null)?.closest?.('a[href]')
      if (!anchor || anchor.hasAttribute('download')) return
      if (anchor.getAttribute('target') && anchor.getAttribute('target') !== '_self') return
      const key = moduleFromHref(anchor.getAttribute('href'))
      if (!key) return
      event.preventDefault()
      goRef.current(key)
    }
    const onPop = () => {
      goRef.current(moduleFromPath(window.location.pathname) || 'home', false)
    }
    document.addEventListener('click', onClick)
    window.addEventListener('popstate', onPop)
    return () => {
      document.removeEventListener('click', onClick)
      window.removeEventListener('popstate', onPop)
    }
  }, [])

  useEffect(() => {
    if (!ready || !user || user.must_change_password) return
    const initial = detectModule()
    if (initial !== 'home') {
      const allowed = new Set(allowedModules(user).map((item) => item.key))
      if (!allowed.has(initial as never)) {
        location.replace(homeHref())
        return
      }
      if (initial !== viewRef.current) {
        viewRef.current = initial
        setView(initial)
      }
    }
  }, [ready, user])

  if (!ready) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Loader size="lg" title="Checking your session" subtitle="Signing you in" />
      </div>
    )
  }

  if (!user) {
    if (detectModule() !== 'home') location.replace(homeHref())
    return <LoginView />
  }

  if (user.must_change_password) return null

  let body = null
  if (view === 'home') body = <HomeView user={user} />
  else if (view === 'telecaller') body = <LeadLensPage />
  else if (view === 'sales') body = <SalesGraphPage />
  else if (view === 'seo') body = <SeoPage />
  else if (view === 'admin') body = <AdminPage />
  else if (view === 'debug') body = <DebugPage />
  else if (view === 'erp') body = <ErpPage />

  return (
    <Shell
      view={view}
      direction={direction}
      user={user}
      onNavigate={go}
    >
      {body}
    </Shell>
  )
}
