import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AuthApi, ApiError } from '@/lib/api.ts'
import { hasAnyPermission, hasPermission, type SessionUser } from '@/lib/session.ts'
import SlideTextButton from '@/components/ui/slide-text-button.tsx'

type AuthContextValue = {
  user: SessionUser | null
  ready: boolean
  hasPermission: (perm: string) => boolean
  hasAnyPermission: (...perms: string[]) => boolean
  signIn: (username: string, password: string) => Promise<SessionUser>
  signOut: () => Promise<void>
  requestAccess: (payload: Record<string, string>) => Promise<void>
  saveProfile: (body: { username?: string; display_name?: string }) => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
  openAccount: () => void
  openPassword: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}

function rememberHint(on: boolean) {
  try {
    if (on) sessionStorage.setItem('ll_session_hint', '1')
    else sessionStorage.removeItem('ll_session_hint')
  } catch {
    /* private mode */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [ready, setReady] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)

  useEffect(() => {
    let cancel = false
    AuthApi.me()
      .then((data) => {
        if (cancel) return
        const next = (data.user as SessionUser | null) || null
        setUser(next)
        rememberHint(Boolean(next))
      })
      .catch((err: unknown) => {
        if (cancel) return
        setUser(null)
        if (err instanceof ApiError && err.status === 401) rememberHint(false)
      })
      .finally(() => {
        if (!cancel) setReady(true)
      })
    return () => {
      cancel = true
    }
  }, [])

  const value = useMemo<AuthContextValue>(() => ({
    user,
    ready,
    hasPermission: (perm) => hasPermission(user, perm),
    hasAnyPermission: (...perms) => hasAnyPermission(user, ...perms),
    signIn: async (username, password) => {
      const data = await AuthApi.login(username, password)
      const next = data.user as SessionUser
      setUser(next)
      rememberHint(true)
      if (next.must_change_password) setPasswordOpen(true)
      return next
    },
    signOut: async () => {
      try { await AuthApi.logout() } catch { /* session already gone */ }
      setUser(null)
      rememberHint(false)
      setAccountOpen(false)
    },
    requestAccess: async (payload) => {
      await AuthApi.requestAccess(payload)
    },
    saveProfile: async (body) => {
      const data = await AuthApi.updateProfile(body)
      setUser(data.user as SessionUser)
    },
    changePassword: async (currentPassword, newPassword) => {
      const data = await AuthApi.changePassword(currentPassword, newPassword)
      setUser(data.user as SessionUser)
      setPasswordOpen(false)
    },
    openAccount: () => setAccountOpen(true),
    openPassword: () => setPasswordOpen(true),
  }), [user, ready])

  return (
    <AuthContext.Provider value={value}>
      {children}
      <AccountDialog
        open={accountOpen}
        user={user}
        onClose={() => setAccountOpen(false)}
        onSave={value.saveProfile}
        onPassword={value.changePassword}
      />
      <PasswordDialog
        open={passwordOpen || Boolean(user?.must_change_password && ready)}
        forced={Boolean(user?.must_change_password)}
        superUser={Boolean(user?.is_super)}
        onClose={() => {
          if (!user?.must_change_password) setPasswordOpen(false)
        }}
        onSubmit={value.changePassword}
      />
    </AuthContext.Provider>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-zinc-500">{label}</span>
      {children}
    </label>
  )
}

const inputClass = 'w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900'

function AccountDialog({
  open,
  user,
  onClose,
  onSave,
  onPassword,
}: {
  open: boolean
  user: SessionUser | null
  onClose: () => void
  onSave: (body: { username?: string; display_name?: string }) => Promise<void>
  onPassword: (currentPassword: string, newPassword: string) => Promise<void>
}) {
  const [username, setUsername] = useState('')
  const [display, setDisplay] = useState('')
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!open || !user) return
    setUsername(user.username || '')
    setDisplay(user.display_name || '')
    setCurrent('')
    setNext('')
    setConfirm('')
    setMessage('')
  }, [open, user])

  if (!open || !user) return null

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <form
        className="w-full max-w-md space-y-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-5 dark:border-zinc-800 dark:bg-zinc-950"
        onSubmit={async (event) => {
          event.preventDefault()
          if (current || next) {
            if (next !== confirm) { setMessage('New passwords do not match.'); return }
            if (next.length < 8) { setMessage('New password must be at least 8 characters.'); return }
          }
          setMessage('Saving…')
          try {
            await onSave({ username: username.trim(), display_name: display.trim() })
            if (current || next) await onPassword(current, next)
            setMessage('Account updated.')
            setTimeout(onClose, 400)
          } catch (err) {
            setMessage(err instanceof Error ? err.message : 'Could not update account')
          }
        }}
      >
        <h2 className="text-lg font-semibold">Account</h2>
        <Field label="Username"><input className={inputClass} value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
        <Field label="Display name"><input className={inputClass} value={display} onChange={(e) => setDisplay(e.target.value)} /></Field>
        <Field label="Telecaller"><input className={inputClass} value={user.telecaller_name || '— set by Admin only —'} readOnly /></Field>
        <Field label="Current password"><input className={inputClass} type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" /></Field>
        <Field label="New password"><input className={inputClass} type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" /></Field>
        <Field label="Confirm password"><input className={inputClass} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" /></Field>
        {message ? <p className="text-sm text-zinc-600 dark:text-zinc-300">{message}</p> : null}
        <div className="flex gap-2">
          <SlideTextButton type="submit" text="Save" hoverText="Update account" />
          <SlideTextButton type="button" variant="ghost" text="Cancel" hoverText="Close" onClick={onClose} />
        </div>
      </form>
    </div>
  )
}

function PasswordDialog({
  open,
  forced,
  superUser,
  onClose,
  onSubmit,
}: {
  open: boolean
  forced: boolean
  superUser: boolean
  onClose: () => void
  onSubmit: (currentPassword: string, newPassword: string) => Promise<void>
}) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState('')
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <form
        className="w-full max-w-md space-y-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-5 dark:border-zinc-800 dark:bg-zinc-950"
        onSubmit={async (event) => {
          event.preventDefault()
          if (next !== confirm) { setMessage('New passwords do not match.'); return }
          if (next.length < 8) { setMessage('New password must be at least 8 characters.'); return }
          setMessage('Saving…')
          try {
            await onSubmit(current, next)
            setMessage('')
          } catch (err) {
            setMessage(err instanceof Error ? err.message : 'Could not change password')
          }
        }}
      >
        <p className="text-xs tracking-[0.18em] text-zinc-500">{superUser ? 'SUPER USER' : 'SECURITY'}</p>
        <h2 className="text-lg font-semibold">{superUser ? 'Change Super User password' : 'Change your password'}</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-300">You’re using a temporary password. Choose a new password before continuing.</p>
        <Field label="Current password"><input className={inputClass} type="password" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
        <Field label="New password"><input className={inputClass} type="password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
        <Field label="Confirm password"><input className={inputClass} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
        {message ? <p className="text-sm">{message}</p> : null}
        <div className="flex gap-2">
          <SlideTextButton type="submit" text="Save" hoverText="Update password" />
          {forced ? null : <SlideTextButton type="button" variant="ghost" text="Cancel" hoverText="Close" onClick={onClose} />}
        </div>
      </form>
    </div>
  )
}
