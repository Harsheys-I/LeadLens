import { useEffect, useState } from 'react'
import { BarChart3, Database, FileWarning, Phone } from 'lucide-react'
import { ActivityRings } from '@/components/ui/activity-rings.tsx'
import Loader from '@/components/ui/loader.tsx'
import MouseEffectCard from '@/components/ui/mouse-effect-card.tsx'
import SlideTextButton from '@/components/ui/slide-text-button.tsx'
import SmoothTab, { type TabItem } from '@/components/ui/smooth-tab.tsx'
import SpotlightCards from '@/components/ui/spotlight-cards.tsx'
import { DashboardApi, PerfDashboardApi, SettingsApi } from '@/lib/api.ts'
import { useAuth } from '@/lib/auth.tsx'
import { LeadCharts } from '@/components/charts/lead-charts.tsx'
import { PerfCharts } from '@/components/charts/perf-charts.tsx'
import { summarizeLeads } from '@/lib/lead-kpis.ts'
import { activityRing, RING } from '@/lib/rings.ts'
import { useView } from '@/lib/use-view.ts'

const VIEWS = ['published', 'perf-dashboard', 'settings', 'perf-settings']
const ALIASES: Record<string, string> = { review: 'published', 'perf-report': 'perf-dashboard' }

export default function LeadLensPage() {
  const { hasPermission } = useAuth()
  const allowed = VIEWS.filter((id) => {
    if (id === 'published') return hasPermission('telecaller.dashboard')
    if (id === 'perf-dashboard') return hasPermission('telecaller.perf_dashboard')
    if (id === 'settings') return hasPermission('telecaller.settings')
    if (id === 'perf-settings') return hasPermission('telecaller.perf_settings')
    return false
  })
  const fallback = allowed[0] || 'published'
  const { view, select } = useView(allowed.length ? allowed : VIEWS, fallback, ALIASES)
  const items = [
    { id: 'published', name: 'B1 Leads Audit' },
    { id: 'perf-dashboard', name: 'Telecalling Performance' },
    { id: 'settings', name: 'Settings' },
    { id: 'perf-settings', name: 'Performance settings' },
  ].filter((item) => allowed.includes(item.id))

  return (
    <SmoothTab
      items={items.map((item) => ({ id: item.id, title: item.name, color: 'bg-zinc-900 dark:bg-white' }))}
      selected={allowed.includes(view) ? view : fallback}
      onChange={select}
    >
      {view === 'published' ? <PublishedView /> : null}
      {view === 'perf-dashboard' ? <PerfView /> : null}
      {view === 'settings' ? <SettingsView /> : null}
      {view === 'perf-settings' ? <PerfSettingsView /> : null}
    </SmoothTab>
  )
}

function leadRowsFromCombined(data: Record<string, unknown>) {
  const direct = Array.isArray(data.results) ? data.results as Array<Record<string, unknown>> : []
  if (direct.length) return direct
  const boards = Array.isArray(data.dashboards) ? data.dashboards as Array<Record<string, unknown>> : []
  const nested: Array<Record<string, unknown>> = []
  for (const board of boards) {
    const payload = board.payload && typeof board.payload === 'object' ? board.payload as Record<string, unknown> : null
    const rows = Array.isArray(board.results)
      ? board.results as Array<Record<string, unknown>>
      : payload && Array.isArray(payload.results)
        ? payload.results as Array<Record<string, unknown>>
        : []
    nested.push(...rows)
  }
  return nested
}

function PublishedView() {
  const [state, setState] = useState<'load' | 'empty' | 'error' | 'ready'>('load')
  const [results, setResults] = useState<Array<Record<string, unknown>>>([])
  const [title, setTitle] = useState('Dashboard')
  const [detail, setDetail] = useState('')
  const [panel, setPanel] = useState('summary')

  useEffect(() => {
    let cancel = false
    DashboardApi.combined()
      .then(async (data) => {
        if (cancel) return
        let rows = leadRowsFromCombined(data)
        const boards = Array.isArray(data.dashboards) ? data.dashboards as Array<Record<string, unknown>> : []
        if (!rows.length && boards.length) {
          const loaded = await Promise.all(boards.map(async (board) => {
            const id = Number(board.id)
            if (!Number.isFinite(id) || id < 1) return []
            const one = await DashboardApi.get(id)
            const dashboard = one.dashboard && typeof one.dashboard === 'object' ? one.dashboard as Record<string, unknown> : {}
            return leadRowsFromCombined({ dashboards: [dashboard] })
          }))
          rows = loaded.flat()
        }
        if (cancel) return
        setResults(rows)
        setTitle(String(data.title || 'Dashboard'))
        setState(rows.length ? 'ready' : 'empty')
      })
      .catch((err: unknown) => {
        if (cancel) return
        setDetail(err instanceof Error ? err.message : 'Could not load the published dashboard.')
        setState('error')
      })
    return () => { cancel = true }
  }, [])

  if (state === 'load') return <Loader size="md" title="Opening LeadLens" subtitle="Loading your data" />
  if (state === 'empty' || state === 'error') {
    return (
      <MouseEffectCard
        topText="LeadLens"
        topSubtext="B1 Leads Audit"
        title="No published dashboard"
        subtitle={state === 'error' ? detail : 'ERP Sync has not published one yet.'}
        footerText="Dashboards are published by ERP Sync."
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
      cardContent: null,
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
      <SmoothTab items={tabs} selected={panel} onChange={setPanel} className="w-full max-w-none">
        {panel === 'summary' ? <ActivityRings title={title} data={rings} /> : null}
        {panel === 'performance' ? <ScoreList rows={summary.scorecard.map((row) => [`${row.name}`, `${Math.round(row.accuracy * 100)}% · ${row.leads} leads`])} /> : null}
        {panel === 'graphs' ? <LeadCharts results={results} /> : null}
        {panel === 'errors' ? <ScoreList rows={summary.rows.filter((row) => row.errorFlag).slice(0, 40).map((row) => [row.telecaller, `${row.severity || 'Error'} · ${row.errorLabels.join(', ') || row.errorDetails}`])} /> : null}
      </SmoothTab>
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

  if (state === 'load') return <Loader size="md" title="Opening LeadLens" subtitle="Loading your data" />
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
  const charts = <PerfCharts byTelecaller={byTelecaller} />
  const tabs: TabItem[] = [
    { id: 'summary', title: 'Summary', color: 'bg-rose-500', cardContent: <div className="h-full overflow-auto"><ActivityRings title="Telecalling Performance" data={rings} /></div> },
    { id: 'tele', title: 'By Telecaller', color: 'bg-lime-500', cardContent: <ScoreList rows={dim(byTelecaller)} /> },
    { id: 'project', title: 'Project', color: 'bg-cyan-500', cardContent: <ScoreList rows={dim(byProject)} /> },
    { id: 'source', title: 'Source', color: 'bg-amber-500', cardContent: <ScoreList rows={dim(bySource)} /> },
  ]
  return (
    <div className="space-y-4">
      {charts}
      <SmoothTab items={tabs} defaultTabId="summary" className="w-full max-w-none" stageClassName="h-[28rem]" />
    </div>
  )
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
          { icon: BarChart3, title: 'Published dashboards', description: 'Bucket 1 accuracy, clean leads, and critical share.', color: '#04C7DD' },
          { icon: FileWarning, title: 'OpenAI key', description: keyLine, color: '#FF2D55' },
          { icon: Phone, title: 'Performance report', description: 'Site visit, follow-up, and active leads.', color: '#8b5cf6' },
          { icon: Database, title: 'Server settings', description: user?.is_super ? 'Super User can save these for everyone.' : 'Applied for this session.', color: '#71717a' },
        ]}
      />
      <form
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
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
        <label className="flex flex-col gap-2 rounded-2xl border border-zinc-200/80 bg-white p-4 text-sm dark:border-white/10 dark:bg-[#06060f]">
          <span className="font-semibold text-zinc-900 dark:text-white">Model</span>
          <span className="text-[12.5px] text-zinc-500 dark:text-white/40">OpenAI model used for the audit.</span>
          <input className="mt-1 w-full rounded-xl border px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950" value={model} onChange={(e) => setModel(e.target.value)} />
        </label>
        <label className="flex flex-col gap-2 rounded-2xl border border-zinc-200/80 bg-white p-4 text-sm dark:border-white/10 dark:bg-[#06060f]">
          <span className="font-semibold text-zinc-900 dark:text-white">Batch size</span>
          <span className="text-[12.5px] text-zinc-500 dark:text-white/40">Leads sent in each audit request.</span>
          <input className="mt-1 w-full rounded-xl border px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950" inputMode="numeric" value={batch} onChange={(e) => setBatch(e.target.value)} />
        </label>
        <label className="flex flex-col gap-2 rounded-2xl border border-zinc-200/80 bg-white p-4 text-sm dark:border-white/10 dark:bg-[#06060f]">
          <span className="font-semibold text-zinc-900 dark:text-white">Concurrency</span>
          <span className="text-[12.5px] text-zinc-500 dark:text-white/40">Audit requests kept in flight at once.</span>
          <input className="mt-1 w-full rounded-xl border px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950" inputMode="numeric" value={concurrency} onChange={(e) => setConcurrency(e.target.value)} />
        </label>
        <div className="flex flex-col items-start gap-2 sm:col-span-2 lg:col-span-3">
          <SlideTextButton type="submit" text="Save" hoverText="Store settings" />
          {message ? <p className="text-sm">{message}</p> : null}
        </div>
      </form>
    </div>
  )
}

function PerfHelp({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="rounded-2xl border border-zinc-200/80 bg-white p-4 text-sm dark:border-white/10 dark:bg-[#06060f]">
      <h3 className="font-semibold text-zinc-900 dark:text-white">{title}</h3>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-[13.5px] leading-relaxed text-zinc-700 dark:text-zinc-200">
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </section>
  )
}

function PerfSettingsView() {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200/80 bg-white p-4 dark:border-white/10 dark:bg-[#06060f]">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-white">TeleCalling Performance · column reference</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Required headers are matched case-insensitively using common aliases.</p>
      </div>
      <PerfHelp
        title="Master Data (M)"
        items={[
          'Mobile',
          'Project Name',
          'Source',
          'Lead Registration Date (LRD)',
          'Next Followup Date (NFD)',
          'Status — used for Draft / leads without calls',
          'Telecaller Name',
        ]}
      />
      <PerfHelp
        title="History Data (H)"
        items={[
          'Mobile',
          'Project Name',
          'Source',
          'Lead Update Date (LUD) — min/max across H sets the report date range',
          'Status — Not Interested, Sent to Enquiry, Site Visit Scheduled / Pending / Cancelled',
          'Telecaller Name',
        ]}
      />
      <PerfHelp
        title="Scorecard columns"
        items={[
          'Total Leads — unique leads (Mobile + TeleCaller) in Master ∪ History',
          'History rows — Mobile/Project/Source/Telecaller forward-filled; STE uses any History Status row; SVS uses latest History Status per Mobile+TeleCaller+Project; SVP/SVC use any History Status row (once per Mobile+TeleCaller+Project); NI uses latest Status per Mobile+TeleCaller',
          'Active Leads — unique Master leads (Mobile + TeleCaller)',
          'Total Calls — History row count (each call row after forward-fill)',
          'Avg Calls per Day — Total Calls ÷ inclusive calendar days between min and max History Lead Update Date',
          'Draft Leads — Master leads with Status = Draft',
          'Not Follow-up Leads — Master leads not present in History, Status ≠ Draft',
          'Site Visited — any History Status = Sent/Send to Enquiry (once per Mobile+TeleCaller+Project)',
          'Site Visit Scheduled — latest History Status = Site Visit Scheduled (once per Mobile+TeleCaller+Project)',
          'Site Visit Pending — any History Status = Site Visit Pending',
          'Total Leads vs Site Visited — Site Visited ÷ Total Leads',
          'Site Visit Cancelled — any History Status = Site Visit Cancelled',
          'Not Interested — latest History Status',
          'Overdue Leads — Master Next Followup Date before tomorrow (once per lead)',
        ]}
      />
      <PerfHelp
        title="Status matching (case-insensitive)"
        items={[
          'Not Interested — History Status on latest row',
          'Site Visit Scheduled / Pending / Cancelled — SVS from latest History Status; SVP/SVC from any History Status row (once per Mobile+TeleCaller+Project)',
          'Sent to Enquiry / Site Visited — History Status on any row (sent to enquiry or send to enquiry)',
        ]}
      />
      <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
        Status stacks are independent tallies (a lead may appear in STE and a latest-status bucket). Overdue counts Master rows where Next Followup Date is before tomorrow (calendar day). No History filter is applied to overdue.
      </p>
    </div>
  )
}
