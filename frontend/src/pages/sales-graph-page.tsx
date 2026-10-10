import { useEffect, useState } from 'react'
import { ActivityRings } from '@/components/ui/activity-rings.tsx'
import Loader from '@/components/ui/loader.tsx'
import MouseEffectCard from '@/components/ui/mouse-effect-card.tsx'
import { FilterDrawer, FiltersButton } from '@/components/filter-drawer.tsx'
import { SalesCharts, SALES_METRICS, type SalesFilters, type SalesPayload, type SalesSheet } from '@/components/charts/sales-charts.tsx'
import { SalesGraphApi } from '@/lib/api.ts'
import { activityRing, RING } from '@/lib/rings.ts'

type MonthMap = Record<string, number>
type Sheet = SalesSheet & { totals?: { grand?: number }; leadDeclaration?: { total?: number; byMonth?: MonthMap } }

const EMPTY_SALES_FILTERS: SalesFilters = {
  projects: [],
  sources: [],
  statuses: [],
  years: [],
  yearMonths: [],
  metrics: [],
  scaleMode: 'relative',
}

function grand(sheet: Sheet | undefined, preferDeclaration = false) {
  if (!sheet) return 0
  if (preferDeclaration && sheet.leadDeclaration?.total) return Number(sheet.leadDeclaration.total) || 0
  if (sheet.totals?.grand) return Number(sheet.totals.grand) || 0
  const map = preferDeclaration ? sheet.leadDeclaration?.byMonth || sheet.byMonth : sheet.byMonth
  return Object.values(map || {}).reduce((sum, value) => sum + (Number(value) || 0), 0)
}

function choice(value: string) {
  return { value, label: value }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatYm(ym: string) {
  if (!/^\d{6}$/.test(ym)) return ym
  return `${MONTHS[Number(ym.slice(4, 6)) - 1] || ym.slice(4)} ${ym.slice(0, 4)}`
}

function salesOptions(payload: { leads?: Sheet; visits?: Sheet; booked?: Sheet }) {
  const names = (sheet: Sheet | undefined, key: 'byProject' | 'bySource') => Object.keys(sheet?.[key] || {})
  const projects = [...new Set([...names(payload.leads, 'byProject'), ...names(payload.visits, 'byProject'), ...names(payload.booked, 'byProject')])].sort()
  const sources = [...new Set([...names(payload.leads, 'bySource'), ...names(payload.visits, 'bySource'), ...names(payload.booked, 'bySource')])].sort()
  const statuses = Object.keys(payload.booked?.byStatus || {})
  const months = monthsOf(payload)
  const years = [...new Set(months.map((month) => month.slice(0, 4)))].sort()
  return {
    projects,
    sources,
    statuses: (statuses.length ? statuses : ['Demand Letter', 'Cancel']).map((value) => ({
      value,
      label: value.toLowerCase() === 'demand letter' ? 'Booked' : value.toLowerCase() === 'cancel' ? 'Canceled' : value,
    })),
    years,
    yearMonths: months,
  }
}

function monthsOf(payload: { leads?: Sheet; visits?: Sheet; booked?: Sheet }) {
  const keys = new Set<string>()
  for (const sheet of [payload.leads, payload.visits, payload.booked]) {
    Object.keys(sheet?.byMonth || {}).forEach((key) => keys.add(key))
    Object.keys(sheet?.leadDeclaration?.byMonth || {}).forEach((key) => keys.add(key))
  }
  return [...keys].sort()
}

export default function SalesGraphPage() {
  return <Dashboard />
}

function Dashboard() {
  const [state, setState] = useState<'load' | 'empty' | 'ready'>('load')
  const [payload, setPayload] = useState<{ leads?: Sheet; visits?: Sheet; booked?: Sheet; title?: string } | null>(null)
  const [filters, setFilters] = useState<SalesFilters>(EMPTY_SALES_FILTERS)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [scale, setScale] = useState<'relative' | 'absolute'>('relative')

  useEffect(() => {
    SalesGraphApi.latest()
      .then((data) => {
        const next = (data.payload || data.graph || data) as { leads?: Sheet; visits?: Sheet; booked?: Sheet }
        const leads = grand(next.leads)
        const visits = grand(next.visits)
        const booked = grand(next.booked, true)
        if (!leads && !visits && !booked) {
          setState('empty')
          return
        }
        setPayload(next)
        setState('ready')
      })
      .catch(() => setState('empty'))
  }, [])

  if (state === 'load') return <Loader size="md" title="Opening Sales Graph" subtitle="Loading your data" />
  if (state === 'empty' || !payload) {
    return (
      <MouseEffectCard
        topText="Sales Graph"
        topSubtext="ERP"
        title="No published graph"
        subtitle="ERP Sync publishes Leads, Visits, and Booked."
        primaryCtaText="Refresh"
        onPrimaryCtaClick={() => location.reload()}
        footerText="Rings use the largest of the three counts as the target."
      />
    )
  }
  const leads = grand(payload.leads)
  const visits = grand(payload.visits)
  const booked = grand(payload.booked, true)
  const largest = Math.max(leads, visits, booked, 1)
  const options = salesOptions(payload)
  const salesActive = Boolean(
    filters.projects.length || filters.sources.length || filters.statuses.length
    || filters.years.length || filters.yearMonths.length || filters.metrics.length
    || filters.scaleMode === 'absolute',
  )
  return (
    <div className="space-y-6">
      <FiltersButton active={salesActive} onClick={() => { setScale(filters.scaleMode); setFiltersOpen(true) }} />
      <FilterDrawer
        open={filtersOpen}
        description="Global filters for KPIs and charts. None selected means all."
        fields={[
          { key: 'projects', label: 'Project', options: options.projects.map(choice) },
          { key: 'sources', label: 'Source', options: options.sources.map(choice) },
          { key: 'statuses', label: 'Status', options: options.statuses },
          { key: 'years', label: 'Year', options: options.years.map(choice) },
          { key: 'yearMonths', label: 'Year+Month', options: options.yearMonths.map((value) => ({ value, label: formatYm(value) })) },
          { key: 'metrics', label: 'Metrics', options: SALES_METRICS.map((metric) => ({ value: metric.key, label: metric.label })) },
        ]}
        values={{
          projects: filters.projects,
          sources: filters.sources,
          statuses: filters.statuses,
          years: filters.years,
          yearMonths: filters.yearMonths,
          metrics: filters.metrics,
        }}
        extra={(
          <div className="space-y-2">
            <p className="text-sm font-semibold">Scale</p>
            <div className="flex gap-2">
              {(['relative', 'absolute'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`rounded-full border px-3 py-1 text-xs ${scale === mode ? 'border-[var(--green)] bg-[var(--accent)]' : 'border-zinc-200'}`}
                  onClick={() => setScale(mode)}
                >
                  {mode === 'relative' ? 'Relative' : 'Absolute'}
                </button>
              ))}
            </div>
            <p className="text-xs text-zinc-500">Relative: dual Y-axis. Absolute: shared Y-axis.</p>
          </div>
        )}
        onClose={() => setFiltersOpen(false)}
        onApply={(next) => {
          const metrics = (next.metrics || []).filter((item): item is SalesFilters['metrics'][number] => SALES_METRICS.some((metric) => metric.key === item))
          setFilters({
            projects: next.projects || [],
            sources: next.sources || [],
            statuses: next.statuses || [],
            years: next.years || [],
            yearMonths: next.yearMonths || [],
            metrics,
            scaleMode: scale,
          })
        }}
      />
      <ActivityRings
        title="Leads, visits, booked"
        data={[
          activityRing('Leads', leads, largest, RING.cyan, 168, ''),
          activityRing('Visits', visits, largest, RING.lime, 124, ''),
          activityRing('Booked', booked, largest, RING.rose, 80, ''),
        ]}
      />
      <SalesCharts payload={payload as SalesPayload} filters={filters} />
    </div>
  )
}
