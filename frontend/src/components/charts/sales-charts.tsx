import { useMemo } from 'react'
import { GroupedBars, ProjectMonthHeat, ShareRing } from './gpp-charts'

const COLOR_LEADS = '#1f5d45'
const COLOR_VISITS = '#c4a35a'
const COLOR_BOOKED = '#5b7c99'
const COLOR_DECLARATION = '#2a6f7a'
const COLOR_CANCELED = '#a65d57'
const STATUS_DEMAND = 'Demand Letter'
const STATUS_CANCEL = 'Cancel'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

type MonthMap = Record<string, number>
type Bucket = { total?: number; byMonth?: MonthMap; byProject?: Record<string, { total?: number; byMonth?: MonthMap }> }
export type SalesSheet = {
  byMonth?: MonthMap
  byProject?: Record<string, Bucket>
  bySource?: Record<string, Bucket>
  byStatus?: Record<string, Bucket>
  totals?: { grand?: number }
  leadDeclaration?: { total?: number; byMonth?: MonthMap }
}
export type SalesPayload = { leads?: SalesSheet; visits?: SalesSheet; booked?: SalesSheet }

const METRICS = [
  { key: 'leads', label: 'Leads' },
  { key: 'visits', label: 'Visits' },
  { key: 'salesDeclaration', label: 'Sales Declaration' },
  { key: 'booked', label: 'Booked' },
  { key: 'canceled', label: 'Canceled' },
] as const

type MetricKey = (typeof METRICS)[number]['key']

export type SalesFilters = {
  projects: string[]
  sources: string[]
  statuses: string[]
  years: string[]
  yearMonths: string[]
  metrics: MetricKey[]
  scaleMode: 'relative' | 'absolute'
}

export const SALES_METRICS = METRICS

function formatMonth(ym: string) {
  if (!/^\d{6}$/.test(ym)) return ym
  const month = Number(ym.slice(4, 6))
  return `${MONTHS[month - 1] || ym.slice(4)} ${ym.slice(0, 4)}`
}

function monthCount(map: MonthMap | undefined, month: string) {
  return Number(map?.[month] || 0)
}

function bucketMonth(bucket: Bucket | undefined, month: string) {
  return monthCount(bucket?.byMonth, month)
}

function keysOf(map: Record<string, Bucket> | undefined) {
  return Object.keys(map || {})
}

function topKeys(map: Record<string, Bucket> | undefined, limit: number) {
  return keysOf(map)
    .map((name) => ({
      name,
      total: Object.values(map?.[name]?.byMonth || {}).reduce((sum, value) => sum + (Number(value) || 0), 0) || Number(map?.[name]?.total || 0),
    }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((row) => row.name)
}

export function SalesCharts({ payload, filters }: { payload: SalesPayload; filters?: SalesFilters }) {
  const on: Record<MetricKey, boolean> = {
    leads: !filters?.metrics.length || filters.metrics.includes('leads'),
    visits: !filters?.metrics.length || filters.metrics.includes('visits'),
    salesDeclaration: !filters?.metrics.length || filters.metrics.includes('salesDeclaration'),
    booked: !filters?.metrics.length || filters.metrics.includes('booked'),
    canceled: !filters?.metrics.length || filters.metrics.includes('canceled'),
  }
  const model = useMemo(() => buildModel(payload, filters), [payload, filters])
  const visible = (key: MetricKey) => on[key]
  const axis = filters?.scaleMode === 'absolute' ? 'left' : undefined

  const heroSeries = [
    visible('leads') ? { key: 'leads', label: 'Leads', color: COLOR_LEADS, yAxisId: axis || 'left' } : null,
    visible('visits') ? { key: 'visits', label: 'Visits', color: COLOR_VISITS, yAxisId: axis || 'left' } : null,
    visible('salesDeclaration') ? { key: 'declaration', label: 'Sales Declaration', color: COLOR_DECLARATION, yAxisId: axis || 'right' } : null,
    visible('booked') ? { key: 'booked', label: 'Booked', color: COLOR_BOOKED, yAxisId: axis || 'right' } : null,
    visible('canceled') ? { key: 'canceled', label: 'Canceled', color: COLOR_CANCELED, yAxisId: axis || 'right' } : null,
  ].filter((item) => item != null)

  const statusSeries = [
    visible('booked') ? { key: 'Booked', label: 'Booked', color: COLOR_BOOKED } : null,
    visible('canceled') ? { key: 'Canceled', label: 'Canceled', color: COLOR_CANCELED } : null,
  ].filter((item) => item != null)

  return (
    <div className="space-y-4">
      <GroupedBars title="Leads vs Visits vs Booked by month" data={model.months} series={heroSeries} xKey="month" scrollable />
      <GroupedBars title="Leads vs Visits vs Booked by project" data={model.projects} series={heroSeries} scrollable />
      <div className="grid gap-4 lg:grid-cols-3">
        {visible('leads') ? <ShareRing title="Leads share by project" slices={model.leadShare} scale="peak" /> : null}
        {visible('visits') ? <ShareRing title="Visits share by project" slices={model.visitShare} scale="peak" /> : null}
        {visible('booked') ? <ShareRing title="Booked share by project" slices={model.bookedShare} scale="peak" /> : null}
      </div>
      {statusSeries.length ? <GroupedBars title="Booked · status stacked by month" data={model.statusMonths} series={statusSeries} xKey="month" stacked scrollable /> : null}
      {visible('leads') ? (
        <ProjectMonthHeat title="Leads · Project × Month" projects={model.heatProjects} months={model.monthKeys} valueAt={(project, month) => bucketMonth(payload.leads?.byProject?.[project], month)} formatMonth={formatMonth} />
      ) : null}
      {visible('visits') ? (
        <ProjectMonthHeat title="Visits · Project × Month" projects={model.heatProjects} months={model.monthKeys} valueAt={(project, month) => bucketMonth(payload.visits?.byProject?.[project], month)} formatMonth={formatMonth} />
      ) : null}
      {visible('booked') ? (
        <ProjectMonthHeat title="Booked · Project × Month" projects={model.heatProjects} months={model.monthKeys} valueAt={(project, month) => bucketMonth(payload.booked?.byProject?.[project], month)} formatMonth={formatMonth} />
      ) : null}
    </div>
  )
}

function activeSet(selected: string[] | undefined, all: string[]) {
  if (!selected?.length || selected.length >= all.length) return null
  return new Set(selected)
}

function buildModel(payload: SalesPayload, filters?: SalesFilters) {
  const leads = payload.leads
  const visits = payload.visits
  const booked = payload.booked
  const allMonths = [...new Set([
    ...Object.keys(leads?.byMonth || {}),
    ...Object.keys(visits?.byMonth || {}),
    ...Object.keys(booked?.byMonth || {}),
    ...Object.keys(booked?.leadDeclaration?.byMonth || {}),
  ])].sort()
  const allYears = [...new Set(allMonths.map((month) => month.slice(0, 4)))]
  const yearSet = activeSet(filters?.years, allYears)
  const monthSet = activeSet(filters?.yearMonths, allMonths)
  const monthKeys = allMonths.filter((month) => {
    if (yearSet && !yearSet.has(month.slice(0, 4))) return false
    if (monthSet && !monthSet.has(month)) return false
    return true
  })
  const allProjects = [...new Set([...keysOf(leads?.byProject), ...keysOf(visits?.byProject), ...keysOf(booked?.byProject)])]
  const projectSet = activeSet(filters?.projects, allProjects)
  const allSources = [...new Set([...keysOf(leads?.bySource), ...keysOf(visits?.bySource), ...keysOf(booked?.bySource)])]
  const sourceSet = activeSet(filters?.sources, allSources)
  const allStatuses = Object.keys(booked?.byStatus || {})
  const statusSet = activeSet(filters?.statuses, allStatuses.length ? allStatuses : [STATUS_DEMAND, STATUS_CANCEL])
  const allowStatus = (key: string) => !statusSet || statusSet.has(key) || [...statusSet].some((item) => item.toLowerCase() === key.toLowerCase())
  const months = monthKeys.map((month) => {
    const demand = allowStatus(STATUS_DEMAND) ? bucketMonth(booked?.byStatus?.[STATUS_DEMAND], month) : 0
    const cancel = allowStatus(STATUS_CANCEL) ? bucketMonth(booked?.byStatus?.[STATUS_CANCEL], month) : 0
    const declaration = monthCount(booked?.leadDeclaration?.byMonth, month) || demand + cancel
    const leadCount = sourceSet ? sourceMonth(leads, sourceSet, month) : monthCount(leads?.byMonth, month)
    const visitCount = sourceSet ? sourceMonth(visits, sourceSet, month) : monthCount(visits?.byMonth, month)
    return {
      month: formatMonth(month),
      leads: leadCount,
      visits: visitCount,
      booked: demand || (sourceSet ? sourceMonth(booked, sourceSet, month) : monthCount(booked?.byMonth, month)),
      canceled: cancel,
      declaration,
    }
  })
  const projectNames = allProjects.filter((name) => !projectSet || projectSet.has(name)).sort((a, b) => a.localeCompare(b))
  const projects = projectNames.map((name) => {
    const demand = allowStatus(STATUS_DEMAND) ? sumMonths(booked?.byStatus?.[STATUS_DEMAND]?.byProject?.[name], monthKeys) : 0
    const cancel = allowStatus(STATUS_CANCEL) ? sumMonths(booked?.byStatus?.[STATUS_CANCEL]?.byProject?.[name], monthKeys) : 0
    const bookedTotal = sumMonths(booked?.byProject?.[name], monthKeys)
    return {
      name,
      leads: sumMonths(leads?.byProject?.[name], monthKeys),
      visits: sumMonths(visits?.byProject?.[name], monthKeys),
      booked: demand || bookedTotal,
      canceled: cancel,
      declaration: demand + cancel || bookedTotal,
    }
  })
  const heatProjects = topKeys({
    ...Object.fromEntries(projectNames.map((name) => [name, {
      total: sumBucket(leads?.byProject?.[name]) + sumBucket(visits?.byProject?.[name]) + sumBucket(booked?.byProject?.[name]),
    }])),
  }, 20)
  const share = (sheet: SalesSheet | undefined, color: string) => topKeys(sheet?.byProject, 8)
    .filter((name) => !projectSet || projectSet.has(name))
    .map((name, index) => ({
      label: name,
      value: sumMonths(sheet?.byProject?.[name], monthKeys),
      color: [color, '#3d8b6e', '#8b5a3c', '#6b4f8a', '#4a7c59', '#7a6a4f', '#3a5a7c', '#9a6b3c'][index % 8],
    }))
  const statusMonths = monthKeys.map((month) => ({
    month: formatMonth(month),
    Booked: allowStatus(STATUS_DEMAND) ? bucketMonth(booked?.byStatus?.[STATUS_DEMAND], month) : 0,
    Canceled: allowStatus(STATUS_CANCEL) ? bucketMonth(booked?.byStatus?.[STATUS_CANCEL], month) : 0,
  }))
  return {
    monthKeys,
    months,
    projects,
    heatProjects,
    leadShare: share(leads, COLOR_LEADS),
    visitShare: share(visits, COLOR_VISITS),
    bookedShare: share(booked, COLOR_BOOKED),
    statusMonths,
  }
}

function sumMonths(bucket: Bucket | undefined, months: string[]) {
  return months.reduce((sum, month) => sum + bucketMonth(bucket, month), 0)
}

function sourceMonth(sheet: SalesSheet | undefined, sources: Set<string>, month: string) {
  let total = 0
  for (const name of sources) total += bucketMonth(sheet?.bySource?.[name], month)
  return total
}

function sumBucket(bucket: Bucket | undefined) {
  if (!bucket) return 0
  const months = Object.values(bucket.byMonth || {})
  if (months.length) return months.reduce((sum, value) => sum + (Number(value) || 0), 0)
  return Number(bucket.total || 0)
}

