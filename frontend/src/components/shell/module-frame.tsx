import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { NotifApi, SettingsApi } from '@/lib/api.ts'
import { useAuth } from '@/lib/auth.tsx'
import { roleLabel } from '@/lib/session.ts'
import { setSystemTheme } from '@/components/ui/switch-button.tsx'
import SwitchButton from '@/components/ui/switch-button.tsx'
import { ProfileDropdown } from '@/components/ui/profile-dropdown.tsx'
import { MorphicNavbar, type MorphicNavItem } from '@/components/ui/morphic-navbar.tsx'
import SlideTextButton from '@/components/ui/slide-text-button.tsx'

type Notice = { id: number; type?: string; title?: string; body?: string; read?: boolean; created_at?: string }

export function ModuleFrame({
  eyebrow,
  items,
  activeId,
  onChange,
  onSettings,
  children,
}: {
  eyebrow: string
  items: MorphicNavItem[]
  activeId: string
  onChange: (id: string) => void
  onSettings?: () => void
  children: React.ReactNode
}) {
  const { user, signOut, openAccount } = useAuth()
  const navigate = useNavigate()
  const [modelLabel, setModelLabel] = useState('Audit model')

  useEffect(() => {
    let cancel = false
    Promise.all([
      SettingsApi.getAudit().catch(() => null),
      SettingsApi.openaiKeyStatus().catch(() => null),
    ]).then(([audit, key]) => {
      if (cancel) return
      const settings = audit && typeof audit.settings === 'object' && audit.settings ? audit.settings as { model?: string } : null
      const model = settings?.model || 'gpt-4o-mini'
      const configured = key && (key.configured === true || key.configured === 1 || key.configured === 'true')
      setModelLabel(`${model} · ${configured ? 'Key on' : 'No key'}`)
    })
    return () => { cancel = true }
  }, [user?.id])

  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <Link to="/" className="min-w-0">
            <span className="block text-sm font-semibold tracking-tight">GPP AI</span>
            <span className="block text-xs text-zinc-500">{eyebrow}</span>
          </Link>
          <div className="flex items-center gap-2">
            <SwitchButton />
            <NotificationBell />
            <ProfileDropdown
              name={user?.display_name || user?.username || 'Account'}
              username={user?.username}
              modelLabel={modelLabel}
              subscriptionLabel={roleLabel(user)}
              onProfile={openAccount}
              onModel={onSettings}
              onSubscription={onSettings}
              onSettings={onSettings}
              onSystemTheme={() => setSystemTheme()}
              onTerms={() => window.open('https://gurupunvaanii.com/', '_blank', 'noopener')}
              onSignOut={() => { void signOut().then(() => navigate('/')) }}
            />
          </div>
        </div>
        {items.length > 0 ? <MorphicNavbar items={items} activeId={activeId} onChange={onChange} /> : null}
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 pb-12">{children}</main>
    </div>
  )
}

function NotificationBell() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Notice[]>([])
  const [unread, setUnread] = useState(0)

  async function refresh() {
    try {
      const data = await NotifApi.list()
      setUnread(Number(data.unread || 0))
      setItems((data.notifications as Notice[]) || [])
    } catch {
      /* keep the last list */
    }
  }

  useEffect(() => {
    const timer = window.setInterval(() => { void refresh() }, 20000)
    const kickoff = window.setTimeout(() => { void refresh() }, 0)
    return () => {
      window.clearInterval(timer)
      window.clearTimeout(kickoff)
    }
  }, [])

  return (
    <>
      <button
        type="button"
        className="relative inline-flex size-10 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
        aria-label="Notifications"
        onClick={() => { setOpen(true); void refresh() }}
      >
        <Bell className="size-4" />
        {unread > 0 ? (
          <span className="absolute -top-1 -right-1 rounded-full bg-rose-500 px-1.5 text-[10px] text-white">{unread > 99 ? '99+' : unread}</span>
        ) : null}
      </button>
      {open ? (
        <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setOpen(false)}>
          <aside
            className="absolute top-0 right-0 flex h-full w-full max-w-sm flex-col border-l border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="font-semibold">Notifications</h2>
                <p className="text-xs text-zinc-500">{unread < 1 ? "You're all caught up" : `${unread} unread`}</p>
              </div>
              <SlideTextButton type="button" variant="ghost" text="Close" hoverText="Hide" onClick={() => setOpen(false)} />
            </div>
            <div className="mb-3 flex gap-2">
              <SlideTextButton type="button" variant="ghost" text="Mark read" hoverText="Clear badge" onClick={() => { void NotifApi.markAllRead().then(refresh) }} />
              <SlideTextButton type="button" variant="ghost" text="Clear" hoverText="Remove all" onClick={() => { void NotifApi.clearAll().then(refresh) }} />
            </div>
            <ul className="flex-1 space-y-2 overflow-y-auto">
              {items.length === 0 ? <li className="text-sm text-zinc-500">No notifications.</li> : null}
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="w-full rounded-2xl border border-zinc-200 bg-white p-3 text-left dark:border-zinc-800 dark:bg-zinc-900"
                    onClick={() => {
                      void NotifApi.markRead(item.id)
                      setOpen(false)
                      if (item.type === 'access_request') navigate('/admin/#users')
                      else if (item.type === 'perf_dashboard_update') navigate('/TeleCallerAudit/#perf-dashboard')
                      else if (item.type === 'dashboard_update') navigate('/TeleCallerAudit/#published')
                    }}
                  >
                    <span className="block text-sm font-medium">{item.title || item.type || 'Notice'}</span>
                    {item.body ? <span className="mt-1 block text-xs text-zinc-500">{item.body}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      ) : null}
    </>
  )
}
