import { useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import PageSlide from '@/components/PageSlide.tsx'
import MorphicNavbar from '@/components/ui/morphic-navbar.tsx'
import { ProfileDropdown } from '@/components/ui/profile-dropdown.tsx'
import SmoothDrawer, { type Notice } from '@/components/ui/smooth-drawer.tsx'
import { NotifApi } from '@/lib/api.ts'
import { useAuth } from '@/lib/auth.tsx'
import { allowedModules, assetUrl, homeHref, moduleHref, TILES } from '@/lib/paths.ts'
import type { SessionUser } from '@/lib/session.ts'

export default function Shell({
  view,
  direction,
  user,
  onNavigate,
  children,
}: {
  view: string
  direction: number
  user: SessionUser
  onNavigate: (key: string) => void
  children: React.ReactNode
}) {
  const { signOut, openAccount, openPassword } = useAuth()
  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState<Notice[]>([])
  const modules = allowedModules(user)
  const tile = TILES.find((item) => item.key === view)
  const title = view === 'home' ? 'GPP AI' : tile?.title || 'GPP AI'
  const unread = notes.filter((note) => note.is_read === 0 || note.is_read === false || note.read === false).length

  async function refresh() {
    try {
      const data = await NotifApi.list()
      setNotes((data.notifications as Notice[]) || [])
    } catch {
      setNotes([])
    }
  }

  useEffect(() => {
    const kick = window.setTimeout(() => { void refresh() }, 0)
    const timer = window.setInterval(() => { void refresh() }, 20000)
    return () => {
      window.clearTimeout(kick)
      window.clearInterval(timer)
    }
  }, [user.id])

  useEffect(() => {
    document.title = view === 'home' ? 'GPP AI' : `${title} · GPP AI`
  }, [title, view])

  const navItems = modules.map((item) => ({ key: item.key, href: moduleHref(item.key), name: item.title }))

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-4">
        <a href={homeHref()} className="flex items-center gap-2 font-semibold">
          <img src={assetUrl('assets/gpp-ai-logo.png')} alt="" width="48" height="28" />
          GPP AI
        </a>
        <div className="flex min-w-0 flex-1 justify-center">
          <MorphicNavbar items={navItems} activeKey={view} onNavigate={onNavigate} />
        </div>
        <button
          type="button"
          className="relative grid h-10 w-10 place-items-center rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900"
          aria-label="Notifications"
          onClick={() => { setOpen(true); void refresh() }}
        >
          <Bell className="h-4 w-4" />
          {unread ? <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-teal-700 px-1 text-[11px] text-white">{unread}</span> : null}
        </button>
        <ProfileDropdown
          user={user}
          onProfile={openAccount}
          onChangePassword={openPassword}
          onSignOut={() => { void signOut().then(() => onNavigate('home')) }}
        />
      </header>
      <PageSlide viewKey={view} direction={direction}>
        {view === 'home' ? null : (
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-800 dark:text-teal-300">{title}</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">{tile?.description || title}</h1>
          </div>
        )}
        {children}
      </PageSlide>
      <SmoothDrawer
        open={open}
        unread={unread}
        notes={notes}
        onClose={() => setOpen(false)}
        onRead={(id) => {
          void NotifApi.markRead(id).then(refresh)
          const note = notes.find((item) => item.id === id)
          const kind = (note as Notice & { type?: string })?.type
          if (kind === 'access_request') onNavigate('admin')
          else if (kind === 'perf_dashboard_update' || kind === 'dashboard_update') onNavigate('telecaller')
          setOpen(false)
        }}
        onMarkAll={() => { void NotifApi.markAllRead().then(refresh) }}
        onClearAll={() => { void NotifApi.clearAll().then(refresh) }}
      />
    </div>
  )
}
