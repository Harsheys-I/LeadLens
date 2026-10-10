import { GroupedBars } from './gpp-charts'

type PerfRow = {
  totalLeads?: number
  siteVisited?: number
  activeLeads?: number
  notFollowupLeads?: number
  pie?: Record<string, number>
}

const STATUS = [
  ['notInterested', 'Not Interested'],
  ['siteVisitScheduled', 'Site Visit Scheduled'],
  ['siteVisitPending', 'Site Visit Pending'],
  ['siteVisitCancelled', 'Site Visit Cancelled'],
  ['siteVisited', 'Site Visited'],
  ['overdue', 'Overdue'],
] as const

const STATUS_COLORS = ['var(--chart-7)', 'var(--chart-6)', 'var(--amber)', 'var(--red)', 'var(--chart-bar)', 'var(--chart-4)']

export function PerfCharts({ byTelecaller }: { byTelecaller: Record<string, PerfRow> }) {
  const names = Object.keys(byTelecaller)
  if (!names.length) return null
  const bars = names.map((name) => ({
    name,
    leads: Number(byTelecaller[name]?.totalLeads || 0),
    visited: Number(byTelecaller[name]?.siteVisited || 0),
  }))
  const hasPie = names.some((name) => byTelecaller[name]?.pie)
  const stacked = names.map((name) => {
    const row: Record<string, string | number> = { name }
    const pie = byTelecaller[name]?.pie
    if (pie) {
      for (const [key, label] of STATUS) row[label] = Number(pie[key] || 0)
    } else {
      row['Site Visited'] = Number(byTelecaller[name]?.siteVisited || 0)
      row.Active = Number(byTelecaller[name]?.activeLeads || 0)
      row['Not follow-up'] = Number(byTelecaller[name]?.notFollowupLeads || 0)
    }
    return row
  })
  const stackedSeries = hasPie
    ? STATUS.map(([, label], index) => ({ key: label, label, color: STATUS_COLORS[index] || 'var(--chart-1)' }))
    : [
        { key: 'Site Visited', label: 'Site Visited', color: 'var(--chart-bar)' },
        { key: 'Active', label: 'Active', color: 'var(--chart-6)' },
        { key: 'Not follow-up', label: 'Not follow-up', color: 'var(--amber)' },
      ]
  return (
    <div className="space-y-4">
      <GroupedBars title="Performance" data={bars} series={[
        { key: 'leads', label: 'Leads', color: 'var(--chart-bar)' },
        { key: 'visited', label: 'Site visited', color: 'var(--chart-6)' },
      ]} />
      <GroupedBars title="Status" data={stacked} series={stackedSeries} stacked />
    </div>
  )
}

