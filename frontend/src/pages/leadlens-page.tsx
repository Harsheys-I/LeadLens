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
import { LeadCharts, type LeadChartFilter } from '@/components/charts/lead-charts.tsx'
import { PerfCharts } from '@/components/charts/perf-charts.tsx'
import { MetricTable } from '@/components/metric-table.tsx'
import { applyLeadFilters, commentQualityLabel, EMPTY_LEAD_FILTERS, leadFilterChoices, summarizeLeads, type LeadFilters, type LeadRow } from '@/lib/lead-kpis.ts'
import { FilterDrawer, FiltersButton, type FilterField } from '@/components/filter-drawer.tsx'
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
  const [filters, setFilters] = useState<LeadFilters>(EMPTY_LEAD_FILTERS)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [errorSearch, setErrorSearch] = useState('')

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

  const choices = leadFilterChoices(results)
  const filteredResults = applyLeadFilters(results, filters)
  const summary = summarizeLeads(filteredResults)
  const filtersActive = leadFiltersActive(filters)
  const scoreRows = summary.scorecard.map((row) => ({
    name: row.name,
    leads: row.leads.toLocaleString(),
    correct: row.correct.toLocaleString(),
    errors: row.errors.toLocaleString(),
    accuracy: `${row.accuracyPct.toFixed(1)}%`,
    rating: row.rating,
    critical: row.critical.toLocaleString(),
    medium: row.medium.toLocaleString(),
  }))
  const kpis = [
    ['Total leads', summary.total.toLocaleString()],
    ['Total errors', summary.errors.toLocaleString()],
    ['Accuracy', `${(summary.accuracy * 100).toFixed(1)}%`],
    ['Critical', summary.critical.toLocaleString()],
    ['Medium', summary.medium.toLocaleString()],
    ['Best TeleCaller', summary.bestTelecaller],
    ['Lowest TeleCaller', summary.lowestTelecaller],
  ]
  const rings = [
    activityRing('Accuracy', summary.clean, summary.total || 1, RING.rose, 168, 'clean'),
    activityRing('No error', summary.clean, summary.total || 1, RING.lime, 124, 'leads'),
    activityRing('Not critical', summary.notCritical, summary.total || 1, RING.cyan, 80, 'leads'),
  ]
  const scoreColumns = [
    { key: 'name', label: 'TeleCaller' },
    { key: 'leads', label: 'Leads' },
    { key: 'correct', label: 'Correct' },
    { key: 'errors', label: 'Errors' },
    { key: 'accuracy', label: 'Accuracy %' },
    { key: 'rating', label: 'Rating', className: 'tracking-wide text-emerald-400' },
    { key: 'critical', label: 'Critical' },
    { key: 'medium', label: 'Medium' },
  ]
  const errorColumns = [
    { key: 'project', label: 'Project' },
    { key: 'mobile', label: 'Mobile' },
    { key: 'telecaller', label: 'TeleCaller' },
    { key: 'errorType', label: 'Error type' },
    { key: 'details', label: 'Details' },
    { key: 'action', label: 'Action' },
    { key: 'severity', label: 'Severity' },
  ]
  const filteredErrors = summary.rows.filter((row) => row.errorFlag).map(errorRecord).filter((row) => rowMatchesSearch(row, errorSearch))
  const errorNote = `${filtersActive ? `${leadFilterNote(filters)} · ` : ''}${filteredErrors.length.toLocaleString()} error row(s)`
  const leadFields: FilterField[] = [
    { key: 'telecallers', label: 'TeleCaller', options: choices.telecallers.map(option) },
    { key: 'projects', label: 'Project', options: choices.projects.map(option) },
    { key: 'severities', label: 'Severity', options: choices.severities.map(option) },
    { key: 'errorTypes', label: 'Error Type', options: choices.errorTypes.map(option) },
    { key: 'overdueBuckets', label: 'Overdue (days)', options: choices.overdueBuckets.map(option) },
    { key: 'commentQualityBuckets', label: 'Comment quality', options: choices.commentQualityBuckets },
  ]
  const tabs: TabItem[] = [
    { id: 'summary', title: 'Summary', color: 'bg-rose-500 hover:bg-rose-600', cardContent: null },
    { id: 'performance', title: 'Performance', color: 'bg-lime-500 hover:bg-lime-600', cardContent: null },
    { id: 'graphs', title: 'Graphs', color: 'bg-cyan-500 hover:bg-cyan-600', cardContent: null },
    { id: 'errors', title: 'Detailed error report', color: 'bg-zinc-800 hover:bg-zinc-900', cardContent: null },
  ]
  return (
    <div className="space-y-4">
      <FiltersButton active={filtersActive} onClick={() => setFiltersOpen(true)} />
      <FilterDrawer
        open={filtersOpen}
        description="Same filters as the LeadLens panel. None selected means all."
        fields={leadFields}
        values={{
          telecallers: filters.telecallers,
          projects: filters.projects,
          severities: filters.severities,
          errorTypes: filters.errorTypes,
          overdueBuckets: filters.overdueBuckets,
          commentQualityBuckets: filters.commentQualityBuckets,
        }}
        dates={{ from: filters.dateFrom, to: filters.dateTo }}
        onClose={() => setFiltersOpen(false)}
        onApply={(next, dates) => {
          setFilters({
            telecallers: next.telecallers || [],
            projects: next.projects || [],
            severities: next.severities || [],
            errorTypes: next.errorTypes || [],
            overdueBuckets: next.overdueBuckets || [],
            commentQualityBuckets: next.commentQualityBuckets || [],
            dateFrom: dates?.from || '',
            dateTo: dates?.to || '',
          })
        }}
      />
      <SmoothTab items={tabs} selected={panel} onChange={setPanel} className="w-full max-w-none">
        {panel === 'summary' ? (
          <div className="space-y-4">
            <ActivityRings title={title} data={rings} />
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {kpis.map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">{label}</p>
                  <p className="mt-1 text-lg font-semibold text-[var(--ink)]">{value}</p>
                </div>
              ))}
            </div>
            <MetricTable title="TeleCaller Performance" columns={scoreColumns} rows={scoreRows} />
          </div>
        ) : null}
        {panel === 'performance' ? <MetricTable title="TeleCaller Performance" columns={scoreColumns} rows={scoreRows} /> : null}
        {panel === 'graphs' ? (
          <LeadCharts
            results={filteredResults}
            onFilter={(filter) => {
              setFilters((current) => applyChartFilter(current, filter))
              setErrorSearch('')
              setPanel('errors')
            }}
          />
        ) : null}
        {panel === 'errors' ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <label className="flex min-w-[16rem] flex-1 flex-col gap-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                Search all
                <input
                  type="search"
                  value={errorSearch}
                  placeholder="Search all fields…"
                  className="rounded-xl border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-sm font-normal normal-case tracking-normal text-[var(--ink)]"
                  onChange={(event) => setErrorSearch(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm text-[var(--ink)]"
                onClick={() => {
                  setFilters(EMPTY_LEAD_FILTERS)
                  setErrorSearch('')
                }}
              >
                Clear
              </button>
            </div>
            <MetricTable title="Detailed Error Report" note={errorNote} columns={errorColumns} rows={filteredErrors} />
          </div>
        ) : null}
      </SmoothTab>
    </div>
  )
}

function rowMatchesSearch(row: Record<string, string | number>, query: string) {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!tokens.length) return true
  const haystack = Object.values(row).join('\n').toLowerCase()
  return tokens.every((token) => haystack.includes(token))
}

function option(value: string) {
  return { value, label: value }
}

function leadFiltersActive(filters: LeadFilters) {
  return Boolean(
    filters.telecallers.length
    || filters.projects.length
    || filters.severities.length
    || filters.errorTypes.length
    || filters.overdueBuckets.length
    || filters.commentQualityBuckets.length
    || filters.dateFrom
    || filters.dateTo,
  )
}

function leadFilterNote(filters: LeadFilters) {
  const parts = [
    ...filters.telecallers,
    ...filters.projects,
    ...filters.severities,
    ...filters.errorTypes,
    ...filters.overdueBuckets.map((bucket) => `Overdue ${bucket}`),
    ...filters.commentQualityBuckets.map((bucket) => commentQualityLabel(bucket)),
  ]
  if (filters.dateFrom || filters.dateTo) parts.push(`${filters.dateFrom || '…'}–${filters.dateTo || '…'}`)
  return parts.join(' · ') || 'Filtered'
}

function applyChartFilter(current: LeadFilters, filter: LeadChartFilter): LeadFilters {
  if (filter.kind === 'telecaller') return { ...current, telecallers: [filter.telecaller] }
  if (filter.kind === 'errorType') return { ...current, errorTypes: [filter.errorType] }
  if (filter.kind === 'project') return { ...current, projects: [filter.project] }
  if (filter.kind === 'severity') return { ...current, telecallers: [filter.telecaller], severities: [filter.severity] }
  if (filter.kind === 'commentQuality') return { ...current, telecallers: [filter.telecaller], commentQualityBuckets: [filter.band] }
  return { ...current, overdueBuckets: [filter.bucket] }
}

function errorRecord(row: LeadRow) {
  return {
    project: row.project,
    mobile: row.mobile,
    telecaller: row.telecaller,
    errorType: row.errorType,
    details: row.errorDetails,
    action: row.action,
    severity: row.severity,
  }
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

const PERF_COUNT_KEYS = [
  'totalLeads',
  'activeLeads',
  'totalCalls',
  'draftLeads',
  'notFollowupLeads',
  'siteVisited',
  'siteVisitScheduled',
  'siteVisitPending',
  'siteVisitCancelled',
  'notInterested',
  'overdue',
] as const

type PerfCountKey = (typeof PERF_COUNT_KEYS)[number]
type PerfSummary = Partial<Record<PerfCountKey, number>>

type PerfMeta = {
  dateMin?: string
  dateMax?: string
  reportDays: number
  viewAll: boolean
}

function PerfView() {
  const [summary, setSummary] = useState<PerfSummary | null>(null)
  const [meta, setMeta] = useState<PerfMeta>({ reportDays: 0, viewAll: false })
  const [byTelecaller, setByTelecaller] = useState<Record<string, PerfSummary>>({})
  const [byProject, setByProject] = useState<Record<string, PerfSummary>>({})
  const [bySource, setBySource] = useState<Record<string, PerfSummary>>({})
  const [state, setState] = useState<'load' | 'empty' | 'ready'>('load')
  const [perfFilters, setPerfFilters] = useState({ telecallers: [] as string[], projects: [] as string[], sources: [] as string[] })
  const [filtersOpen, setFiltersOpen] = useState(false)

  useEffect(() => {
    PerfDashboardApi.combined()
      .then((data) => {
        const next = (data.summary || {}) as PerfSummary
        const total = Number(next.totalLeads || 0)
        setSummary(next)
        setMeta({
          dateMin: typeof data.date_min === 'string' ? data.date_min : undefined,
          dateMax: typeof data.date_max === 'string' ? data.date_max : undefined,
          reportDays: perfReportDays(data),
          viewAll: Boolean(data.view_all),
        })
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
  const teleMap = pickBuckets(byTelecaller, perfFilters.telecallers)
  const projectMap = pickBuckets(byProject, perfFilters.projects)
  const sourceMap = pickBuckets(bySource, perfFilters.sources)
  const rolled = perfFilters.telecallers.length
    ? sumPerf(teleMap)
    : perfFilters.projects.length
      ? sumPerf(projectMap)
      : perfFilters.sources.length
        ? sumPerf(sourceMap)
        : summary
  const total = Number(rolled.totalLeads || 0) || 1
  const visited = Number(rolled.siteVisited || 0)
  const follow = Math.max(0, total - Number(rolled.notFollowupLeads || 0))
  const active = Number(rolled.activeLeads || 0)
  const rings = [
    activityRing('Site visited', visited, total, RING.rose, 168, 'leads'),
    activityRing('Follow-up', follow, total, RING.lime, 124, 'leads'),
    activityRing('Active leads', active, total, RING.cyan, 80, 'leads'),
  ]
  const dim = (map: Record<string, PerfSummary>) => Object.entries(map).map(([name, row]) => [name, `${row.siteVisited || 0} visited · ${row.totalLeads || 0} leads`])
  const charts = <PerfCharts byTelecaller={teleMap} />
  const period = perfPeriodLabel(meta.dateMin, meta.dateMax)
  const totalsTitle = meta.viewAll ? 'All TeleCallers · totals' : 'Totals'
  const tabs: TabItem[] = [
    {
      id: 'summary',
      title: 'Summary',
      color: 'bg-rose-500',
      cardContent: (
        <div className="h-full space-y-4 overflow-auto">
          <ActivityRings title="Telecalling Performance" data={rings} />
          <PerfTotalsList title={totalsTitle} period={period} summary={rolled} reportDays={meta.reportDays} />
        </div>
      ),
    },
    { id: 'tele', title: 'By Telecaller', color: 'bg-lime-500', cardContent: <ScoreList rows={dim(teleMap)} /> },
    { id: 'project', title: 'Project', color: 'bg-cyan-500', cardContent: <ScoreList rows={dim(projectMap)} /> },
    { id: 'source', title: 'Source', color: 'bg-amber-500', cardContent: <ScoreList rows={dim(sourceMap)} /> },
  ]
  const perfActive = Boolean(perfFilters.telecallers.length || perfFilters.projects.length || perfFilters.sources.length)
  return (
    <div className="space-y-4">
      <FiltersButton active={perfActive} onClick={() => setFiltersOpen(true)} />
      <FilterDrawer
        open={filtersOpen}
        description="Empty means all. TeleCaller, Project, and Source match the performance panel."
        fields={[
          { key: 'telecallers', label: 'TeleCaller', options: Object.keys(byTelecaller).sort().map(option) },
          { key: 'projects', label: 'Project', options: Object.keys(byProject).sort().map(option) },
          { key: 'sources', label: 'Source', options: Object.keys(bySource).sort().map(option) },
        ]}
        values={perfFilters}
        onClose={() => setFiltersOpen(false)}
        onApply={(next) => setPerfFilters({
          telecallers: next.telecallers || [],
          projects: next.projects || [],
          sources: next.sources || [],
        })}
      />
      {charts}
      <SmoothTab items={tabs} defaultTabId="summary" className="w-full max-w-none" stageClassName="h-auto min-h-[36rem]" />
    </div>
  )
}

function pickBuckets(map: Record<string, PerfSummary>, selected: string[]) {
  if (!selected.length) return map
  const out: Record<string, PerfSummary> = {}
  for (const name of selected) {
    if (map[name]) out[name] = map[name]
  }
  return out
}

function sumPerf(map: Record<string, PerfSummary>): PerfSummary {
  const totals: PerfSummary = {}
  for (const key of PERF_COUNT_KEYS) totals[key] = 0
  for (const row of Object.values(map)) {
    for (const key of PERF_COUNT_KEYS) totals[key] = (totals[key] || 0) + Number(row[key] || 0)
  }
  return totals
}

const PERF_TOTAL_ROWS: { key: PerfCountKey | 'avgCallsPerDay' | 'totalLeadsVsSiteVisitedPct'; label: string }[] = [
  { key: 'totalLeads', label: 'Total Leads' },
  { key: 'activeLeads', label: 'Active Leads' },
  { key: 'totalCalls', label: 'Total Calls' },
  { key: 'avgCallsPerDay', label: 'Avg Calls per Day' },
  { key: 'draftLeads', label: 'Draft Leads' },
  { key: 'notFollowupLeads', label: 'Not Follow-up Leads' },
  { key: 'siteVisited', label: 'Site Visited' },
  { key: 'siteVisitScheduled', label: 'Site Visit Scheduled' },
  { key: 'siteVisitPending', label: 'Site Visit Pending' },
  { key: 'siteVisitCancelled', label: 'Site Visit Cancelled' },
  { key: 'notInterested', label: 'Not Interested' },
  { key: 'totalLeadsVsSiteVisitedPct', label: 'Total Leads vs Site Visited' },
  { key: 'overdue', label: 'Overdue Leads' },
]

function perfReportDays(data: { reportDays?: unknown; report_days?: unknown; date_min?: unknown; date_max?: unknown }) {
  const direct = Number(data.reportDays || data.report_days || 0)
  if (direct > 0) return direct
  const min = parsePerfDate(data.date_min)
  const max = parsePerfDate(data.date_max)
  if (!min || !max) return 0
  const start = new Date(min)
  const end = new Date(max)
  start.setHours(0, 0, 0, 0)
  end.setHours(0, 0, 0, 0)
  return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1
}

function parsePerfDate(value: unknown) {
  if (typeof value !== 'string' || !value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function perfPeriodLabel(dateMin?: string, dateMax?: string) {
  if (!dateMin && !dateMax) return ''
  const fmt = (iso?: string) => {
    const parsed = parsePerfDate(iso)
    if (!parsed) return '—'
    return parsed.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  }
  return `Report period (from History Lead Update Date): ${fmt(dateMin)} – ${fmt(dateMax)}`
}

function perfTotalValue(summary: PerfSummary, key: (typeof PERF_TOTAL_ROWS)[number]['key'], reportDays: number) {
  if (key === 'avgCallsPerDay') {
    const days = Number(reportDays) || 0
    if (days <= 0) return '—'
    return String(Math.round(Number(summary.totalCalls || 0) / days))
  }
  if (key === 'totalLeadsVsSiteVisitedPct') {
    const total = Number(summary.totalLeads || 0)
    if (total <= 0) return '—'
    const value = Math.round((Number(summary.siteVisited || 0) / total) * 1000) / 10
    return `${value.toFixed(value % 1 === 0 ? 0 : 1)}%`
  }
  return String(Number(summary[key] || 0))
}

function PerfTotalsList({ title, period, summary, reportDays }: { title: string; period: string; summary: PerfSummary; reportDays: number }) {
  return (
    <section className="rounded-xl border border-[var(--line)] bg-[var(--panel)] px-4 py-3 text-sm">
      {period ? <p className="mb-3 text-xs text-[var(--muted)]">{period}</p> : null}
      <h3 className="mb-2 text-sm font-semibold text-emerald-400">{title}</h3>
      <dl>
        {PERF_TOTAL_ROWS.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-4 border-t border-[var(--line)] py-2 first:border-t-0">
            <dt className="text-[var(--ink)]">{row.label}</dt>
            <dd className="font-medium tabular-nums text-emerald-300">{perfTotalValue(summary, row.key, reportDays)}</dd>
          </div>
        ))}
      </dl>
    </section>
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
