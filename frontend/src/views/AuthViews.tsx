import { useState, type FormEvent } from 'react'
import FlickeringGrid from '@/components/ui/flickering-grid.tsx'
import SwitchButton from '@/components/ui/switch-button.tsx'
import { assetUrl } from '@/lib/paths.ts'
import { useAuth } from '@/lib/auth.tsx'
import { resolveTheme, getThemePreference } from '@/lib/theme.ts'
import { THEME_CHANGE_EVENT } from '@/components/ui/switch-button.tsx'
import { useSyncExternalStore } from 'react'

const field = 'mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-600'

function useResolvedTheme() {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener(THEME_CHANGE_EVENT, onChange)
      const media = window.matchMedia('(prefers-color-scheme: dark)')
      media.addEventListener('change', onChange)
      return () => {
        window.removeEventListener(THEME_CHANGE_EVENT, onChange)
        media.removeEventListener('change', onChange)
      }
    },
    () => resolveTheme(getThemePreference()),
    () => 'light' as const,
  )
}

export function LoginView() {
  const { signIn, requestAccess } = useAuth()
  const theme = useResolvedTheme()
  const [error, setError] = useState('')
  const [mode, setMode] = useState<'login' | 'request'>('login')
  const [note, setNote] = useState('')
  const gridColor = theme === 'dark' ? '#7dcea6' : '#12372a'

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const fd = new FormData(event.currentTarget)
    setError('')
    try {
      await signIn(String(fd.get('username') || ''), String(fd.get('password') || ''))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed')
    }
  }

  const request = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const fd = new FormData(event.currentTarget)
    setError('')
    setNote('')
    try {
      await requestAccess({
        full_name: String(fd.get('full_name') || '').trim(),
        email: '',
        requested_username: String(fd.get('requested_username') || '').trim(),
        preferred_module: String(fd.get('preferred_module') || ''),
        reason: String(fd.get('reason') || '').trim(),
      })
      setNote('Request submitted. An admin will review it.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit request')
    }
  }

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <div className="relative h-56 w-full shrink-0 overflow-hidden bg-[var(--paper)] lg:h-auto lg:min-h-screen lg:w-1/2" aria-hidden="true">
        <FlickeringGrid
          className="absolute inset-0"
          squareSize={4}
          gridGap={6}
          color={gridColor}
          maxOpacity={0.4}
          flickerChance={0.1}
        />
      </div>
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <section className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <div className="mb-6 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <img src={assetUrl('assets/gpp-ai-logo.png')} alt="" width="64" height="36" />
              <div>
                <strong>GPP AI</strong>
                <p className="text-sm text-zinc-500">AI telecalling QA</p>
              </div>
            </div>
            <SwitchButton />
          </div>
          {mode === 'login' ? (
            <>
              <h1 className="text-2xl font-semibold">Sign in</h1>
              <p className="mt-1 text-sm text-zinc-500">Use your GPP AI account to open the modules your role allows.</p>
              <form className="mt-4 space-y-3" onSubmit={login}>
                <label className="block text-sm">Username<input name="username" autoComplete="username" required className={field} /></label>
                <label className="block text-sm">Password<input name="password" type="password" autoComplete="current-password" required className={field} /></label>
                {error ? <p className="text-sm text-red-600">{error}</p> : null}
                <button className="w-full rounded-lg bg-zinc-900 py-2 text-sm text-white dark:bg-white dark:text-zinc-900" type="submit">Sign in</button>
              </form>
              <p className="mt-4 text-sm text-zinc-500">
                Need access? <button type="button" className="text-teal-800 dark:text-teal-300" onClick={() => { setMode('request'); setError('') }}>Request access</button>
              </p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-semibold">Request access</h1>
              <p className="mt-1 text-sm text-zinc-500">An admin will review your request. No email is sent in this phase.</p>
              <form className="mt-4 space-y-3" onSubmit={request}>
                <label className="block text-sm">Full name<input name="full_name" required className={field} /></label>
                <label className="block text-sm">Preferred username<input name="requested_username" className={field} /></label>
                <label className="block text-sm">Preferred module
                  <select name="preferred_module" className={field} defaultValue="TeleCaller">
                    <option value="TeleCaller">LeadLens</option>
                    <option value="Sales Graph">Sales Graph</option>
                    <option value="SEO">SEO</option>
                    <option value="Admin">Admin</option>
                    <option value="Other">Other</option>
                  </select>
                </label>
                <label className="block text-sm">Reason<textarea name="reason" rows={3} className={field} /></label>
                {error ? <p className="text-sm text-red-600">{error}</p> : null}
                {note ? <p className="text-sm text-teal-800">{note}</p> : null}
                <div className="flex gap-3">
                  <button className="rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white dark:bg-white dark:text-zinc-900" type="submit">Submit request</button>
                  <button type="button" className="text-sm" onClick={() => { setMode('login'); setError(''); setNote('') }}>Back to sign in</button>
                </div>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
