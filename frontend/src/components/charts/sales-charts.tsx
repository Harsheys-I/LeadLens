import { useMemo, useState } from 'react'
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

export function SalesCharts({ payload }: { payload: SalesPayload }) {
  const [on, setOn] = useState<Record<MetricKey, boolean>>({
    leads: true,
    visits: true,
    salesDeclaration: true,
    booked: true,
    canceled: true,
  })
  const model = useMemo(() => buildModel(payload), [payload])
  const visible = (key: MetricKey) => on[key]

  function toggle(key: MetricKey) {
    setOn((current) => ({ ...current, [key]: !current[key] }))
  }

  const heroSeries = [
    visible('leads') ? { key: 'leads', label: 'Leads', color: COLOR_LEADS, yAxisId: 'left' } : null,
    visible('visits') ? { key: 'visits', label: 'Visits', color: COLOR_VISITS, yAxisId: 'left' } : null,
    visible('salesDeclaration') ? { key: 'declaration', label: 'Sales Declaration', color: COLOR_DECLARATION, yAxisId: 'right' } : null,
    visible('booked') ? { key: 'booked', label: 'Booked', color: COLOR_BOOKED, yAxisId: 'right' } : null,
    visible('canceled') ? { key: 'canceled', label: 'Canceled', color: COLOR_CANCELED, yAxisId: 'right' } : null,
  ].filter((item) => item != null)

  const statusSeries = [
    visible('booked') ? { key: 'Booked', label: 'Booked', color: COLOR_BOOKED } : null,
    visible('canceled') ? { key: 'Canceled', label: 'Canceled', color: COLOR_CANCELED } : null,
  ].filter((item) => item != null)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {METRICS.map((metric) => (
          <button
            key={metric.key}
            type="button"
            className={`rounded-full border px-3 py-1 text-xs ${on[metric.key] ? 'border-[var(--green)] bg-[var(--accent)]' : 'border-zinc-200 text-[var(--muted)] dark:border-zinc-700'}`}
            onClick={() => toggle(metric.key)}
          >
            {metric.label}
          </button>
        ))}
      </div>
      <GroupedBars title="Leads vs Visits vs Booked by month" data={model.months} series={heroSeries} xKey="month" />
      <GroupedBars title="Leads vs Visits vs Booked by project" data={model.projects} series={heroSeries} />
      <div className="grid gap-4 lg:grid-cols-3">
        {visible('leads') ? <ShareRing title="Leads share by project" slices={model.leadShare} scale="peak" /> : null}
        {visible('visits') ? <ShareRing title="Visits share by project" slices={model.visitShare} scale="peak" /> : null}
        {visible('booked') ? <ShareRing title="Booked share by project" slices={model.bookedShare} scale="peak" /> : null}
      </div>
      {statusSeries.length ? <GroupedBars title="Booked · status stacked by month" data={model.statusMonths} series={statusSeries} xKey="month" stacked /> : null}
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

function buildModel(payload: SalesPayload) {
  const leads = payload.leads
  const visits = payload.visits
  const booked = payload.booked
  const monthKeys = [...new Set([
    ...Object.keys(leads?.byMonth || {}),
    ...Object.keys(visits?.byMonth || {}),
    ...Object.keys(booked?.byMonth || {}),
    ...Object.keys(booked?.leadDeclaration?.byMonth || {}),
  ])].sort()
  const months = monthKeys.map((month) => {
    const demand = bucketMonth(booked?.byStatus?.[STATUS_DEMAND], month)
    const cancel = bucketMonth(booked?.byStatus?.[STATUS_CANCEL], month)
    const declaration = monthCount(booked?.leadDeclaration?.byMonth, month) || demand + cancel
    return {
      month: formatMonth(month),
      leads: monthCount(leads?.byMonth, month),
      visits: monthCount(visits?.byMonth, month),
      booked: demand || monthCount(booked?.byMonth, month),
      canceled: cancel,
      declaration,
    }
  })
  const projectNames = [...new Set([...keysOf(leads?.byProject), ...keysOf(visits?.byProject), ...keysOf(booked?.byProject)])].sort((a, b) => a.localeCompare(b))
  const projects = projectNames.map((name) => {
    const demand = sumBucket(booked?.byStatus?.[STATUS_DEMAND]?.byProject?.[name])
    const cancel = sumBucket(booked?.byStatus?.[STATUS_CANCEL]?.byProject?.[name])
    const bookedTotal = sumBucket(booked?.byProject?.[name])
    return {
      name,
      leads: sumBucket(leads?.byProject?.[name]),
      visits: sumBucket(visits?.byProject?.[name]),
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
  const share = (sheet: SalesSheet | undefined, color: string) => topKeys(sheet?.byProject, 8).map((name, index) => ({
    label: name,
    value: sumBucket(sheet?.byProject?.[name]),
    color: [color, '#3d8b6e', '#8b5a3c', '#6b4f8a', '#4a7c59', '#7a6a4f', '#3a5a7c', '#9a6b3c'][index % 8],
  }))
  const statusMonths = monthKeys.map((month) => ({
    month: formatMonth(month),
    Booked: bucketMonth(booked?.byStatus?.[STATUS_DEMAND], month),
    Canceled: bucketMonth(booked?.byStatus?.[STATUS_CANCEL], month),
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

function sumBucket(bucket: Bucket | undefined) {
  if (!bucket) return 0
  const months = Object.values(bucket.byMonth || {})
  if (months.length) return months.reduce((sum, value) => sum + (Number(value) || 0), 0)
  return Number(bucket.total || 0)
}

