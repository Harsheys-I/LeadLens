import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import BentoGrid, { type BentoItem } from '@/components/ui/bento-grid.tsx'
import FlickeringGrid from '@/components/ui/flickering-grid.tsx'
import { KineticText } from '@/components/ui/kinetic-text.tsx'
import Loader from '@/components/ui/loader.tsx'
import MouseEffectCard from '@/components/ui/mouse-effect-card.tsx'
import SlideTextButton from '@/components/ui/slide-text-button.tsx'
import { ModuleFrame } from '@/components/shell/module-frame.tsx'
import { DashboardApi, ErpSyncApi, SettingsApi } from '@/lib/api.ts'
import { useAuth } from '@/lib/auth.tsx'
import { promptFromDebugSettings } from '@/lib/debug-prompt.ts'
import { summarizeLeads } from '@/lib/lead-kpis.ts'
import { mean, scoreAuditPages } from '@/seo/audit-data.ts'
import { moduleTilesForUser, type ModuleTile } from '@/lib/session.ts'

export default function HomePage() {
  const { user, ready, signIn, requestAccess, openPassword, openAccount } = useAuth()
  const [params] = useSearchParams()
  const [mode, setMode] = useState<'login' | 'request'>('login')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!user || user.must_change_password) return
    const next = params.get('next')
    if (!next) return
    try {
      const url = new URL(next, location.origin)
      if (url.origin !== location.origin) return
      const here = location.pathname + location.search + location.hash
      const dest = url.pathname + url.search + url.hash
      if (dest && dest !== here) location.assign(dest)
    } catch {
      /* ignore a bad next */
    }
  }, [user, params])

  if (!ready) {
    return (
      <div className="grid min-h-svh place-items-center">
        <Loader size="lg" title="Checking session" subtitle="GPP AI" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="grid min-h-svh lg:grid-cols-2">
        <div className="relative h-56 overflow-hidden rounded-2xl border border-zinc-200 lg:h-auto lg:rounded-none lg:border-y-0 lg:border-l-0 dark:border-zinc-800">
          <FlickeringGrid className="absolute inset-0 h-full w-full" />
        </div>
        <div className="flex items-center justify-center p-6 sm:p-10">
          <div className="w-full max-w-md">
            {mode === 'login' ? (
              <form
                className="space-y-4"
                onSubmit={async (event) => {
                  event.preventDefault()
                  const form = new FormData(event.currentTarget)
                  setBusy(true)
                  setMessage('')
                  try {
                    const nextUser = await signIn(String(form.get('username') || ''), String(form.get('password') || ''))
                    if (nextUser.must_change_password) openPassword()
                  } catch (err) {
                    setMessage(err instanceof Error ? err.message : 'Sign in failed')
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                <KineticText text="GPP AI" className="text-5xl tracking-tight sm:text-6xl" />
                <p className="text-sm text-zinc-500">Sign in to the modules your role can open.</p>
                <label className="block text-sm">
                  Username
                  <input name="username" autoComplete="username" className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950" required />
                </label>
                <label className="block text-sm">
                  Password
                  <input name="password" type="password" autoComplete="current-password" className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950" required />
                </label>
                {message ? <p className="text-sm text-rose-600">{message}</p> : null}
                {busy ? <Loader size="sm" title="Signing in" subtitle="Checking the session" /> : null}
                <div className="flex flex-wrap gap-2">
                  <SlideTextButton type="submit" text="Sign in" hoverText="Open GPP AI" disabled={busy} />
                  <SlideTextButton type="button" variant="ghost" text="Request access" hoverText="Ask an admin" onClick={() => { setMode('request'); setMessage('') }} />
                </div>
              </form>
            ) : (
              <RequestForm
                busy={busy}
                message={message}
                onBack={() => { setMode('login'); setMessage('') }}
                onSubmit={async (event) => {
                  event.preventDefault()
                  const form = new FormData(event.currentTarget)
                  setBusy(true)
                  setMessage('Submitting…')
                  try {
                    await requestAccess({
                      full_name: String(form.get('full_name') || '').trim(),
                      email: '',
                      requested_username: String(form.get('requested_username') || '').trim(),
                      preferred_module: String(form.get('preferred_module') || ''),
                      reason: String(form.get('reason') || '').trim(),
                    })
                    setMessage('Request submitted. An admin will review it.')
                  } catch (err) {
                    setMessage(err instanceof Error ? err.message : 'Could not submit request')
                  } finally {
                    setBusy(false)
                  }
                }}
              />
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <ModuleFrame eyebrow={user.role_name || 'Home'} items={[]} activeId="" onChange={() => {}} onSettings={openAccount}>
      <HomeBento />
    </ModuleFrame>
  )
}

function RequestForm({
  busy,
  message,
  onBack,
  onSubmit,
}: {
  busy: boolean
  message: string
  onBack: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      <h1 className="text-3xl font-semibold tracking-tight">Request access</h1>
      <p className="text-sm text-zinc-500">An admin reviews the username and module before creating the account.</p>
      <label className="block text-sm">Full name<input name="full_name" required className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950" /></label>
      <label className="block text-sm">Requested username<input name="requested_username" required className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950" /></label>
      <label className="block text-sm">
        Preferred module
        <select name="preferred_module" className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950">
          <option>LeadLens</option>
          <option>Sales Graph</option>
          <option>SEO</option>
          <option>Admin</option>
        </select>
      </label>
      <label className="block text-sm">Reason<textarea name="reason" rows={3} className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950" /></label>
      {message ? <p className="text-sm">{message}</p> : null}
      {busy ? <Loader size="sm" title="Sending request" subtitle="Waiting for the server" /> : null}
      <div className="flex flex-wrap gap-2">
        <SlideTextButton type="submit" text="Submit request" hoverText="Send to admin" disabled={busy} />
        <SlideTextButton type="button" variant="ghost" text="Sign in" hoverText="Back" onClick={onBack} />
      </div>
    </form>
  )
}

function HomeBento() {
  const { user, hasPermission, openAccount } = useAuth()
  const tiles = moduleTilesForUser(user)
  const [items, setItems] = useState<BentoItem[] | null>(null)

  useEffect(() => {
    let cancel = false
    void (async () => {
      const [dash, key, erp, debug] = await Promise.all([
        hasPermission('telecaller.dashboard') ? DashboardApi.combined().catch(() => null) : Promise.resolve(null),
        SettingsApi.openaiKeyStatus().catch(() => null),
        user?.is_super ? ErpSyncApi.status().catch(() => null) : Promise.resolve(null),
        user?.is_super ? SettingsApi.getDebug().catch(() => null) : Promise.resolve(null),
      ])
      if (cancel) return
      const results = Array.isArray(dash?.results) ? dash.results as Array<Record<string, unknown>> : []
      const summary = summarizeLeads(results)
      const scored = scoreAuditPages()
      const health = mean(scored.map((page) => page.overall_score))
      const technical = mean(scored.map((page) => page.category_scores.technical))
      const cwv = mean(scored.map((page) => page.category_scores.cwv))
      const configured = key && (key.configured === true || key.configured === 1 || key.configured === 'true')
      const keyLine = configured ? 'Key on' : 'No key'
      const job = erp && typeof erp.job === 'object' && erp.job ? erp.job as { status?: string; source_file?: string } : null
      const prompt = promptFromDebugSettings(debug?.settings)
      const next = tiles.map((tile) => tileToItem(tile, {
        accuracy: Math.round(summary.accuracy * 100),
        leads: summary.total,
        health,
        technical,
        cwv,
        keyLine,
        sync: job?.status || 'idle',
        source: job?.source_file || 'No active file',
        prompt,
      }))
      setItems(next)
    })()
    return () => { cancel = true }
  }, [user, tiles.map((tile) => tile.id).join('|'), hasPermission])

  if (!tiles.length) {
    return (
      <MouseEffectCard
        topText="GPP AI"
        topSubtext="No modules"
        title="Nothing is assigned"
        subtitle="Your role cannot open a module yet."
        primaryCtaText="Account"
        onPrimaryCtaClick={() => openAccount()}
        footerText="Ask an admin to grant a module."
      />
    )
  }

  if (!items) return <Loader size="md" title="Loading modules" subtitle="Reading published figures" />

  return <BentoGrid items={items} voice={false} className="md:grid-cols-2" />
}

function tileToItem(tile: ModuleTile, stats: {
  accuracy: number
  leads: number
  health: number
  technical: number
  cwv: number
  keyLine: string
  sync: string
  source: string
  prompt: string
}): BentoItem {
  const base = { id: tile.id, title: tile.title, description: tile.desc, href: tile.href }
  if (tile.id === 'telecaller') {
    return { ...base, feature: 'icons', openaiStatus: stats.keyLine, size: 'md' }
  }
  if (tile.id === 'sales-graph') {
    return { ...base, feature: 'chart', statistic: { value: String(stats.leads), label: 'Published leads', end: Math.max(stats.leads, 1), suffix: '' } }
  }
  if (tile.id === 'seo') {
    return {
      ...base,
      feature: 'metrics',
      metrics: [
        { label: 'SEO health', value: stats.health, suffix: '', color: 'emerald' },
        { label: 'Technical', value: stats.technical, suffix: '', color: 'blue' },
        { label: 'CWV', value: stats.cwv, suffix: '', color: 'violet' },
      ],
    }
  }
  if (tile.id === 'erp-sync') {
    return {
      ...base,
      feature: 'timeline',
      timeline: [
        { year: 'Now', event: `Sync ${stats.sync}` },
        { year: 'File', event: stats.source },
      ],
    }
  }
  if (tile.id === 'admin') {
    return { ...base, feature: 'spotlight', spotlightItems: ['People', 'Access requests', 'Roles'] }
  }
  return { ...base, feature: 'typing', typingText: stats.prompt, className: 'md:col-span-2' }
}
