import { useEffect, useRef, useState } from 'react'
import { BarChart3, Database, FileWarning, Gauge, ListTree, Phone } from 'lucide-react'
import { ActivityRings } from '@/components/ui/activity-rings.tsx'
import BentoGrid from '@/components/ui/bento-grid.tsx'
import Loader from '@/components/ui/loader.tsx'
import MouseEffectCard from '@/components/ui/mouse-effect-card.tsx'
import SlideTextButton from '@/components/ui/slide-text-button.tsx'
import SmoothTab, { type TabItem } from '@/components/ui/smooth-tab.tsx'
import SpotlightCards from '@/components/ui/spotlight-cards.tsx'
import { ModuleFrame } from '@/components/shell/module-frame.tsx'
import { ModuleGuard } from '@/components/shell/guard.tsx'
import { api, DashboardApi, JobsApi, PerfDashboardApi, SettingsApi } from '@/lib/api.ts'
import { useAuth } from '@/lib/auth.tsx'
import { summarizeLeads } from '@/lib/lead-kpis.ts'
import { activityRing, RING } from '@/lib/rings.ts'
import { useView } from '@/lib/use-view.ts'

const VIEWS = ['published', 'perf-dashboard', 'console', 'history', 'settings', 'perf-settings']
const ALIASES: Record<string, string> = { review: 'published', 'perf-report': 'perf-dashboard' }

type AuditProgress = {
  running?: boolean
  status?: string
  audited?: number
  total?: number
  elapsed_seconds?: number
  source_file?: string
}

export default function LeadLensPage() {
  const { hasPermission, user } = useAuth()
  const allowed = VIEWS.filter((id) => {
    if (id === 'published') return hasPermission('telecaller.dashboard')
    if (id === 'perf-dashboard') return hasPermission('telecaller.perf_dashboard')
    if (id === 'console') return hasPermission('telecaller.run_console')
    if (id === 'history') return hasPermission('telecaller.history')
    if (id === 'settings') return hasPermission('telecaller.settings')
    if (id === 'perf-settings') return hasPermission('telecaller.perf_settings')
    return false
  })
  const fallback = allowed[0] || 'published'
  const { view, select } = useView(allowed.length ? allowed : VIEWS, fallback, ALIASES)
  const items = [
    { id: 'published', name: 'B1 Leads Audit' },
    { id: 'perf-dashboard', name: 'Telecalling Performance' },
    { id: 'console', name: 'Run console' },
    { id: 'history', name: 'History' },
    { id: 'settings', name: 'Settings' },
    { id: 'perf-settings', name: 'Performance settings' },
  ].filter((item) => allowed.includes(item.id))

  return (
    <ModuleGuard allow={(person) => Boolean(person.is_super || hasPermission('module.telecaller_audit'))}>
      <ModuleFrame
        eyebrow="LeadLens"
        items={items}
        activeId={allowed.includes(view) ? view : fallback}
        onChange={select}
        onSettings={() => {
          if (hasPermission('telecaller.settings')) select('settings')
          else if (hasPermission('telecaller.perf_settings')) select('perf-settings')
        }}
      >
        {view === 'published' ? <PublishedView canPublish={Boolean(user?.is_super || hasPermission('telecaller.upload_dashboard'))} /> : null}
        {view === 'perf-dashboard' ? <PerfView /> : null}
        {view === 'console' ? <ConsoleView /> : null}
        {view === 'history' ? <HistoryView /> : null}
        {view === 'settings' ? <SettingsView /> : null}
        {view === 'perf-settings' ? <PerfSettingsView /> : null}
      </ModuleFrame>
    </ModuleGuard>
  )
}

function PublishedView({ canPublish }: { canPublish: boolean }) {
  const [state, setState] = useState<'load' | 'empty' | 'ready'>('load')
  const [results, setResults] = useState<Array<Record<string, unknown>>>([])
  const [title, setTitle] = useState('Dashboard')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let cancel = false
    DashboardApi.combined()
      .then((data) => {
        if (cancel) return
        const rows = Array.isArray(data.results) ? data.results as Array<Record<string, unknown>> : []
        setResults(rows)
        setTitle(String(data.title || 'Dashboard'))
        setState(rows.length ? 'ready' : 'empty')
      })
      .catch(() => { if (!cancel) setState('empty') })
    return () => { cancel = true }
  }, [])

  if (state === 'load') return <Loader size="lg" title="Published dashboard" subtitle="Loading Bucket 1" />
  if (state === 'empty') {
    return (
      <MouseEffectCard
        topText="LeadLens"
        topSubtext="B1 Leads Audit"
        title="No published dashboard"
        subtitle="Publish a review pack when this role can upload."
        primaryCtaText={canPublish ? 'Publish' : 'History'}
        onPrimaryCtaClick={() => { if (!canPublish) location.hash = '#history' }}
        footerText="Accuracy rings appear after a published audit."
      />
    )
  }

  const summary = summarizeLeads(results)
  const rings = [
    activityRing('Accuracy', summary.clean, summary.total || 1, RING.rose, 168, 'clean'),
    activityRing('No error', summary.clean, summary.total || 1, RING.lime, 124, 'leads'),
    activityRing('Not critical', summary.notCritical, summary.total || 1, RING.cyan, 80, 'leads'),
  ]
  const tabs: TabItem[] = [
    {
      id: 'summary',
      title: 'Summary',
      color: 'bg-rose-500 hover:bg-rose-600',
      cardContent: <div className="h-full overflow-auto p-2"><ActivityRings title={title} data={rings} /></div>,
    },
    {
      id: 'performance',
      title: 'Performance',
      color: 'bg-lime-500 hover:bg-lime-600',
      cardContent: <ScoreList rows={summary.scorecard.map((row) => [`${row.name}`, `${Math.round(row.accuracy * 100)}% · ${row.leads} leads`])} />,
    },
    {
      id: 'graphs',
      title: 'Graphs',
      color: 'bg-cyan-500 hover:bg-cyan-600',
      cardContent: (
        <div className="h-full space-y-2 overflow-auto p-4">
          {summary.scorecard.map((row) => (
            <div key={row.name}>
              <div className="flex justify-between text-xs"><span>{row.name}</span><span>{Math.round(row.accuracy * 100)}%</span></div>
              <div className="h-2 rounded-full bg-zinc-200 dark:bg-zinc-800"><div className="h-full rounded-full bg-[#04C7DD]" style={{ width: `${Math.round(row.accuracy * 100)}%` }} /></div>
            </div>
          ))}
        </div>
      ),
    },
    {
      id: 'errors',
      title: 'Detailed error report',
      color: 'bg-zinc-800 hover:bg-zinc-900',
      cardContent: (
        <ScoreList rows={summary.rows.filter((row) => row.errorFlag).slice(0, 40).map((row) => [row.telecaller, `${row.severity || 'Error'} · ${row.errorLabels.join(', ') || row.errorDetails}`])} />
      ),
    },
  ]
  return (
    <div className="space-y-4">
      <SmoothTab items={tabs} className="w-full max-w-none" stageClassName="h-[28rem]" />
      {canPublish ? (
        <SlideTextButton
          type="button"
          text="Publish"
          hoverText="Save dashboards"
          onClick={() => {
            const byName = new Map<string, Array<Record<string, unknown>>>()
            for (const row of results) {
              const name = String(row.telecaller || 'Unknown')
              const list = byName.get(name) || []
              list.push(row)
              byName.set(name, list)
            }
            const dashboards = [...byName.entries()].map(([telecaller_name, payload]) => ({
              telecaller_name,
              title: telecaller_name,
              payload: { results: payload },
            }))
            setMessage('Publishing…')
            DashboardApi.publish(dashboards)
              .then(() => setMessage('Published.'))
              .catch((err: unknown) => setMessage(err instanceof Error ? err.message : 'Publish failed'))
          }}
        />
      ) : null}
      {message ? <p className="text-sm">{message}</p> : null}
    </div>
  )
}

function ScoreList({ rows }: { rows: string[][] }) {
  if (!rows.length) return <p className="p-4 text-sm text-zinc-500">No rows.</p>
  return (
    <ul className="h-full space-y-2 overflow-auto p-4 text-sm">
      {rows.map(([name, detail]) => (
        <li key={`${name}-${detail}`} className="flex justify-between gap-3 border-b border-zinc-200/70 pb-2 dark:border-zinc-800">
          <span className="font-medium">{name}</span>
          <span className="text-zinc-500">{detail}</span>
        </li>
      ))}
    </ul>
  )
}

type PerfSummary = {
  totalLeads?: number
  activeLeads?: number
  siteVisited?: number
  notFollowupLeads?: number
}

function PerfView() {
  const [summary, setSummary] = useState<PerfSummary | null>(null)
  const [byTelecaller, setByTelecaller] = useState<Record<string, PerfSummary>>({})
  const [byProject, setByProject] = useState<Record<string, PerfSummary>>({})
  const [bySource, setBySource] = useState<Record<string, PerfSummary>>({})
  const [state, setState] = useState<'load' | 'empty' | 'ready'>('load')

  useEffect(() => {
    PerfDashboardApi.combined()
      .then((data) => {
        const next = (data.summary || {}) as PerfSummary
        const total = Number(next.totalLeads || 0)
        setSummary(next)
        setByTelecaller((data.byTelecaller || {}) as Record<string, PerfSummary>)
        setByProject((data.byProject || {}) as Record<string, PerfSummary>)
        setBySource((data.bySource || {}) as Record<string, PerfSummary>)
        setState(total > 0 ? 'ready' : 'empty')
      })
      .catch(() => setState('empty'))
  }, [])

  if (state === 'load') return <Loader size="md" title="Performance" subtitle="Loading the published report" />
  if (state === 'empty' || !summary) {
    return (
      <MouseEffectCard
        topText="LeadLens"
        topSubtext="Telecalling Performance"
        title="No performance dashboard"
        subtitle="Publish a performance workbook to fill these rings."
        primaryCtaText="Settings"
        onPrimaryCtaClick={() => { location.hash = '#perf-settings' }}
        footerText="Site visit, follow-up, and active-lead share."
      />
    )
  }
  const total = Number(summary.totalLeads || 0) || 1
  const visited = Number(summary.siteVisited || 0)
  const follow = Math.max(0, total - Number(summary.notFollowupLeads || 0))
  const active = Number(summary.activeLeads || 0)
  const rings = [
    activityRing('Site visited', visited, total, RING.rose, 168, 'leads'),
    activityRing('Follow-up', follow, total, RING.lime, 124, 'leads'),
    activityRing('Active leads', active, total, RING.cyan, 80, 'leads'),
  ]
  const dim = (map: Record<string, PerfSummary>) => Object.entries(map).map(([name, row]) => [name, `${row.siteVisited || 0} visited · ${row.totalLeads || 0} leads`])
  const tabs: TabItem[] = [
    { id: 'summary', title: 'Summary', color: 'bg-rose-500', cardContent: <div className="h-full overflow-auto"><ActivityRings title="Telecalling Performance" data={rings} /></div> },
    { id: 'tele', title: 'By Telecaller', color: 'bg-lime-500', cardContent: <ScoreList rows={dim(byTelecaller)} /> },
    { id: 'project', title: 'Project', color: 'bg-cyan-500', cardContent: <ScoreList rows={dim(byProject)} /> },
    { id: 'source', title: 'Source', color: 'bg-amber-500', cardContent: <ScoreList rows={dim(bySource)} /> },
  ]
  return <SmoothTab items={tabs} className="w-full max-w-none" stageClassName="h-[28rem]" />
}

function ConsoleView() {
  const [progress, setProgress] = useState<AuditProgress>({})
  const [message, setMessage] = useState('Choose a workbook to stage, or stop a server audit.')
  const fileRef = useRef<HTMLInputElement>(null)
  const running = Boolean(progress.running) || progress.status === 'auditing'
  const audited = Number(progress.audited || 0)
  const total = Number(progress.total || 0)

  useEffect(() => {
    let stop = false
    const pull = () => {
      api('audit/status').then((data) => {
        if (stop) return
        const next = (data.progress || data) as AuditProgress
        setProgress(next)
      }).catch(() => {})
    }
    pull()
    const timer = window.setInterval(pull, 2000)
    return () => { stop = true; window.clearInterval(timer) }
  }, [])

  async function toggleRun() {
    if (running) {
      setMessage('Stopping…')
      try {
        const data = await api('audit/cancel', { method: 'POST', body: {} })
        setMessage(String(data.message || 'Audit stopped'))
      } catch (err) {
        setMessage(err instanceof Error ? err.message : 'Could not stop the audit')
      }
      return
    }
    fileRef.current?.click()
  }

  const rings = [
    activityRing('Progress', audited, total || 1, RING.rose, 168, '%'),
    activityRing('Leads', total, Math.max(total, audited, 1), RING.lime, 124, 'leads'),
    activityRing('Audited', audited, Math.max(total, audited, 1), RING.cyan, 80, 'calls'),
  ]

  return (
    <div className="space-y-4">
      <ActivityRings title={progress.source_file || 'Run console'} data={rings} />
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls,.csv,.json"
        className="hidden"
        onChange={async (event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          setMessage(`Staging ${file.name}…`)
          const body = new FormData()
          body.append('file', file)
          try {
            const data = await api('audit/stage', { method: 'POST', body })
            setMessage(`Staged ${String(data.source_file || file.name)} · ${String(data.lead_count || 0)} leads. The OpenAI batch loop still runs from the existing audit engine.`)
          } catch (err) {
            setMessage(err instanceof Error ? err.message : 'Stage failed')
          }
        }}
      />
      <BentoGrid
        items={[]}
        voice={{
          title: 'Run audit',
          description: message,
          running,
          elapsed: Number(progress.elapsed_seconds || 0),
          onToggle: () => { void toggleRun() },
        }}
      />
      <div className="flex flex-wrap gap-2">
        <SlideTextButton type="button" text="Run audit" hoverText={running ? 'Stop audit' : 'Choose workbook'} onClick={() => { void toggleRun() }} />
        <SlideTextButton type="button" variant="ghost" text="Cancel" hoverText="Stop audit" onClick={() => { void toggleRun() }} />
      </div>
    </div>
  )
}

function HistoryView() {
  const [rows, setRows] = useState<Array<{ id?: string; name?: string; title?: string; status?: string; updated_at?: string }>>([])
  const [state, setState] = useState<'load' | 'empty' | 'ready'>('load')
  useEffect(() => {
    Promise.all([DashboardApi.list().catch(() => ({ dashboards: [] })), JobsApi.list().catch(() => ({ jobs: [] }))])
      .then(([dash, jobs]) => {
        const published = Array.isArray(dash.dashboards) ? dash.dashboards as Array<Record<string, unknown>> : []
        const jobRows = Array.isArray(jobs.jobs) ? jobs.jobs as Array<Record<string, unknown>> : []
        const merged = [
          ...published.map((row) => ({ id: String(row.id), name: String(row.telecaller_name || row.title || 'Dashboard'), status: 'published', updated_at: String(row.updated_at || '') })),
          ...jobRows.map((row) => ({ id: String(row.id || row.job_id || ''), name: String(row.fileName || row.name || 'Job'), status: String(row.status || ''), updated_at: String(row.updatedAt || '') })),
        ]
        setRows(merged)
        setState(merged.length ? 'ready' : 'empty')
      })
  }, [])
  if (state === 'load') return <Loader size="sm" title="History" subtitle="Reading jobs and dashboards" />
  if (state === 'empty') {
    return (
      <MouseEffectCard
        topText="LeadLens"
        topSubtext="History"
        title="No history yet"
        subtitle="Completed audits and published dashboards show up here."
        primaryCtaText="Run console"
        onPrimaryCtaClick={() => { location.hash = '#console' }}
        footerText="Same jobs list as the PHP session."
      />
    )
  }
  return <ScoreList rows={rows.map((row) => [row.name || 'Item', `${row.status || ''} ${row.updated_at || ''}`])} />
}

function SettingsView() {
  const { user } = useAuth()
  const [model, setModel] = useState('gpt-4o-mini')
  const [batch, setBatch] = useState('20')
  const [concurrency, setConcurrency] = useState('2')
  const [keyLine, setKeyLine] = useState('Checking key…')
  const [message, setMessage] = useState('')
  const [settings, setSettings] = useState<Record<string, unknown>>({})

  useEffect(() => {
    Promise.all([
      SettingsApi.getAudit().catch(() => ({ settings: {} })),
      SettingsApi.openaiKeyStatus().catch(() => ({ configured: false })),
    ]).then(([audit, key]) => {
      const next = audit.settings && typeof audit.settings === 'object' ? audit.settings as Record<string, unknown> : {}
      setSettings(next)
      setModel(String(next.model || 'gpt-4o-mini'))
      setBatch(String(next.batchSize || 20))
      setConcurrency(String(next.concurrency || 2))
      const status = key as { configured?: unknown; masked?: string }
      const on = status.configured === true || status.configured === 1 || status.configured === 'true'
      setKeyLine(on ? `Key on${status.masked ? ` · ${status.masked}` : ''}` : 'No key')
    })
  }, [])

  return (
    <div className="space-y-6">
      <SpotlightCards
        eyebrow="Capabilities"
        heading="LeadLens settings"
        items={[
          { icon: Gauge, title: 'Run console', description: 'Workbook staging and the live server audit.', color: '#f59e0b' },
          { icon: BarChart3, title: 'Published dashboards', description: 'Bucket 1 accuracy, clean leads, and critical share.', color: '#04C7DD' },
          { icon: ListTree, title: 'History', description: 'Jobs and the latest published telecaller packs.', color: '#A3F900' },
          { icon: FileWarning, title: 'OpenAI key', description: keyLine, color: '#FF2D55' },
          { icon: Phone, title: 'Performance report', description: 'Site visit, follow-up, and active leads.', color: '#8b5cf6' },
          { icon: Database, title: 'Server settings', description: user?.is_super ? 'Super User can save these for everyone.' : 'Applied for this session.', color: '#71717a' },
        ]}
      />
      <BentoGrid
        voice={false}
        items={[{
          id: 'model',
          title: 'Audit model',
          description: `${model} · ${keyLine}`,
          feature: 'icons',
          openaiStatus: keyLine,
        }]}
      />
      <form
        className="grid max-w-lg gap-3"
        onSubmit={async (event) => {
          event.preventDefault()
          const next = { ...settings, model, batchSize: Number(batch), concurrency: Number(concurrency) }
          setMessage('Saving…')
          try {
            if (user?.is_super) await SettingsApi.saveAudit(next)
            setSettings(next)
            setMessage(user?.is_super ? 'Saved for everyone.' : 'Settings applied for this session (server settings are Super User only).')
          } catch (err) {
            setMessage(err instanceof Error ? err.message : 'Saved locally; server save failed.')
          }
        }}
      >
        <label className="text-sm">Model<input className="mt-1 w-full rounded-xl border px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950" value={model} onChange={(e) => setModel(e.target.value)} /></label>
        <label className="text-sm">Batch size<input className="mt-1 w-full rounded-xl border px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950" value={batch} onChange={(e) => setBatch(e.target.value)} /></label>
        <label className="text-sm">Concurrency<input className="mt-1 w-full rounded-xl border px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950" value={concurrency} onChange={(e) => setConcurrency(e.target.value)} /></label>
        <SlideTextButton type="submit" text="Save" hoverText="Store settings" />
        {message ? <p className="text-sm">{message}</p> : null}
      </form>
    </div>
  )
}

function PerfSettingsView() {
  const [message, setMessage] = useState('')
  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-500">Performance publishing uses the same perf-dashboards API. Clearing removes every published performance pack.</p>
      <SlideTextButton
        type="button"
        variant="ghost"
        text="Clear performance"
        hoverText="Remove all"
        onClick={() => {
          setMessage('Clearing…')
          PerfDashboardApi.removeAll()
            .then(() => setMessage('Performance dashboards removed.'))
            .catch((err: unknown) => setMessage(err instanceof Error ? err.message : 'Could not clear'))
        }}
      />
      {message ? <p className="text-sm">{message}</p> : null}
    </div>
  )
}
