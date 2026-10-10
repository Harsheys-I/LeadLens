import { useId, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ExternalLink, KeyRound, LogOut, User } from 'lucide-react'
import SwitchButton from '@/components/ui/switch-button.tsx'
import type { SessionUser } from '@/lib/session.ts'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export type ProfileDropdownProps = {
  user: SessionUser | null
  onChangePassword?: () => void
  onSignOut?: () => void
  onProfile?: () => void
  className?: string
}

function initialsFrom(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function GeminiMark({ className }: { className?: string }) {
  const raw = useId().replace(/:/g, '')
  const gradientId = `gemini-${raw}`
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#4B90FF" />
          <stop offset="52%" stopColor="#9B72FF" />
          <stop offset="100%" stopColor="#FF6BCB" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${gradientId})`}
        d="M12 1.8c.55 5.15 2.95 7.55 8.1 8.1-5.15.55-7.55 2.95-8.1 8.1-.55-5.15-2.95-7.55-8.1-8.1 5.15-.55 7.55-2.95 8.1-8.1Z"
      />
    </svg>
  )
}

function GradientSeparator() {
  return (
    <div
      className="my-1.5 h-px w-full bg-gradient-to-r from-transparent via-violet-400/70 to-transparent dark:via-fuchsia-400/50"
      role="separator"
    />
  )
}

function MenuRow({
  icon,
  label,
  badge,
  external,
  danger,
  onSelect,
}: {
  icon: ReactNode
  label: string
  badge?: string
  external?: boolean
  danger?: boolean
  onSelect?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'group/row flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm outline-none transition-colors',
        'hover:bg-zinc-100 focus-visible:bg-zinc-100 dark:hover:bg-zinc-800/80 dark:focus-visible:bg-zinc-800/80',
        danger
          ? 'text-red-600 hover:bg-red-50 focus-visible:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40 dark:focus-visible:bg-red-950/40'
          : 'text-zinc-800 dark:text-zinc-100',
      )}
    >
      <span
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors',
          danger
            ? 'bg-red-500/10 text-red-600 group-hover/row:bg-red-500/15 dark:text-red-400'
            : 'bg-zinc-100 text-zinc-600 group-hover/row:bg-white dark:bg-zinc-800 dark:text-zinc-300 dark:group-hover/row:bg-zinc-700',
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
      {badge ? (
        <span className="max-w-[9.5rem] truncate rounded-full bg-gradient-to-r from-violet-500/15 via-fuchsia-500/15 to-orange-400/20 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:text-fuchsia-200">
          {badge}
        </span>
      ) : null}
      {external ? (
        <ExternalLink className="size-3.5 shrink-0 text-zinc-400 transition-transform group-hover/row:-translate-y-0.5 group-hover/row:translate-x-0.5" />
      ) : null}
    </button>
  )
}

export function ProfileDropdown({
  user,
  onChangePassword,
  onSignOut,
  onProfile,
  className,
}: ProfileDropdownProps) {
  const [open, setOpen] = useState(false)
  const bendId = `profile-bend-${useId().replace(/:/g, '')}`
  const name = user?.display_name || user?.username || 'Account'
  const role = user?.role_name || ''
  const initials = initialsFrom(name)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <div className={cn('group relative inline-flex', className)}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              'flex items-center gap-3 rounded-2xl border border-zinc-200/80 bg-white py-1.5 pr-3 pl-3 text-left',
              'transition-colors hover:border-zinc-300 hover:bg-zinc-50',
              'dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700 dark:hover:bg-zinc-900',
              'outline-none focus-visible:ring-2 focus-visible:ring-zinc-400',
            )}
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">{name}</span>
              {role ? (
                <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{role}</span>
              ) : null}
            </span>
            <span className="relative size-10 shrink-0 rounded-full bg-gradient-to-br from-violet-500 via-fuchsia-500 to-orange-400 p-[2px]">
              <span className="flex size-full items-center justify-center overflow-hidden rounded-full bg-white dark:bg-zinc-950">
                <span className="text-xs font-semibold tracking-wide text-zinc-700 dark:text-zinc-200">
                  {initials}
                </span>
              </span>
            </span>
          </button>
        </DropdownMenuTrigger>

        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute -bottom-3 left-1/2 -translate-x-1/2 transition-all duration-300',
            open ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0 group-hover:translate-y-0 group-hover:opacity-70',
          )}
        >
          <svg width="72" height="12" viewBox="0 0 72 12" fill="none">
            <path
              d="M1 1C16 1 18 11 36 11C54 11 56 1 71 1"
              stroke={`url(#${bendId})`}
              strokeWidth="1.5"
              strokeLinecap="round"
              className={cn('origin-center transition-transform duration-300', open && 'scale-x-110')}
            />
            <defs>
              <linearGradient id={bendId} x1="0" y1="0" x2="72" y2="0" gradientUnits="userSpaceOnUse">
                <stop stopColor="#8B5CF6" stopOpacity="0" />
                <stop offset="0.5" stopColor="#D946EF" />
                <stop offset="1" stopColor="#FB923C" stopOpacity="0" />
              </linearGradient>
            </defs>
          </svg>
        </span>

        <DropdownMenuContent
          align="end"
          sideOffset={14}
          className="w-[280px] overflow-visible border-0 bg-transparent p-0 shadow-none"
        >
          <AnimatePresence>
            {open ? (
              <motion.div
                key="profile-menu"
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.98 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className={cn(
                  'rounded-2xl border border-zinc-200/80 bg-white/95 p-1.5 shadow-xl backdrop-blur-md',
                  'dark:border-zinc-800 dark:bg-zinc-950/95',
                )}
              >
                <MenuRow icon={<User className="size-4" />} label="Profile" onSelect={onProfile} />
                <MenuRow icon={<User className="size-4" />} label="Role" badge={role || '—'} />
                <div className="px-1 py-1">
                  <SwitchButton className="w-full" />
                </div>
                <MenuRow icon={<KeyRound className="size-4" />} label="Change password" onSelect={onChangePassword} />
                <GradientSeparator />
                <MenuRow icon={<LogOut className="size-4" />} label="Sign out" danger onSelect={onSignOut} />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </DropdownMenuContent>
      </div>
    </DropdownMenu>
  )
}
