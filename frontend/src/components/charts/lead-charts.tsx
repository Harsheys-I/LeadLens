import { leadChartSeries } from '@/lib/lead-kpis.ts'
import { MetricTable } from '@/components/metric-table.tsx'
import { GroupedBars, ShareRing, SolidPie } from './gpp-charts'

export type LeadChartFilter =
  | { kind: 'telecaller'; telecaller: string; subtitle: string }
  | { kind: 'errorType'; errorType: string; subtitle: string }
  | { kind: 'project'; project: string; subtitle: string }
  | { kind: 'severity'; telecaller: string; severity: string; subtitle: string }
  | { kind: 'commentQuality'; telecaller: string; band: string; subtitle: string }
  | { kind: 'overdue'; bucket: string; subtitle: string }

const CQ_KEYS: Record<string, string> = {
  Bad: '0-2',
  Average: '3-4',
  Good: '5-6',
  'Very good': '7-8',
  Excellent: '9-10',
}

export function LeadCharts({
  results,
  onFilter,
}: {
  results: Array<Record<string, unknown>>
  onFilter?: (filter: LeadChartFilter) => void
}) {
  const series = leadChartSeries(results)
  const tele = (category: string) => onFilter?.({ kind: 'telecaller', telecaller: category, subtitle: category })
  return (
    <div className="space-y-4 p-2">
      <GroupedBars
        title="TeleCaller Accuracy %"
        data={series.accuracy}
        series={[{ key: 'value', label: 'Accuracy %', color: 'var(--chart-bar)' }]}
        onSegment={(category) => tele(category)}
      />
      <MetricTable
        title="Accuracy"
        columns={[{ key: 'name', label: 'TeleCaller' }, { key: 'value', label: 'Accuracy %' }]}
        rows={series.accuracy.map((row) => ({ name: row.name, value: `${row.value}%` }))}
      />
      <GroupedBars
        title="Errors by TeleCaller"
        data={series.errors}
        series={[{ key: 'value', label: 'Errors', color: 'var(--red)' }]}
        onSegment={(category) => tele(category)}
      />
      <MetricTable
        title="Errors by TeleCaller"
        columns={[{ key: 'name', label: 'TeleCaller' }, { key: 'value', label: 'Errors' }]}
        rows={series.errors}
      />
      <ShareRing
        title="Error types"
        slices={series.errorTypes}
        onSegment={(label) => onFilter?.({ kind: 'errorType', errorType: label, subtitle: label })}
      />
      <MetricTable
        title="Error type distribution"
        columns={[{ key: 'label', label: 'Error type' }, { key: 'value', label: 'Count' }]}
        rows={series.errorTypes}
      />
      <GroupedBars
        title="Project-wise errors"
        data={series.projects}
        series={[{ key: 'value', label: 'Errors', color: 'var(--chart-2)' }]}
        onSegment={(category) => onFilter?.({ kind: 'project', project: category, subtitle: category })}
      />
      <MetricTable
        title="Project-wise errors"
        columns={[{ key: 'name', label: 'Project' }, { key: 'value', label: 'Errors' }]}
        rows={series.projects}
      />
      <GroupedBars
        title="Severity"
        data={series.severity}
        series={[
          { key: 'Critical', label: 'Critical', color: 'var(--red)' },
          { key: 'Medium', label: 'Medium', color: 'var(--amber)' },
        ]}
        onSegment={(category, seriesLabel) => onFilter?.({
          kind: 'severity',
          telecaller: category,
          severity: seriesLabel,
          subtitle: `${category} · ${seriesLabel}`,
        })}
      />
      <MetricTable
        title="Severity"
        columns={[
          { key: 'name', label: 'TeleCaller' },
          { key: 'Critical', label: 'Critical' },
          { key: 'Medium', label: 'Medium' },
        ]}
        rows={series.severity}
      />
      <GroupedBars
        title="Comment quality"
        data={series.commentQuality}
        series={series.commentQualityBands.map((band) => ({ key: band.label, label: band.label, color: band.color }))}
        onSegment={(category, seriesLabel) => onFilter?.({
          kind: 'commentQuality',
          telecaller: category,
          band: CQ_KEYS[seriesLabel] || seriesLabel,
          subtitle: `${category} · ${seriesLabel}`,
        })}
      />
      <MetricTable
        title="Comment quality"
        columns={[
          { key: 'name', label: 'TeleCaller' },
          ...series.commentQualityBands.map((band) => ({ key: band.label, label: band.label })),
        ]}
        rows={series.commentQuality}
      />
      <SolidPie
        title="Overdue days"
        slices={series.overdue}
        onSegment={(label) => onFilter?.({ kind: 'overdue', bucket: label, subtitle: `Overdue ${label}` })}
      />
      <MetricTable
        title="Overdue days"
        note="1–5, 5–20, 20–50, 50–100, 100+ · Lost/Beyond Budget excluded"
        columns={[{ key: 'label', label: 'Bucket' }, { key: 'value', label: 'Leads' }]}
        rows={series.overdue}
      />
    </div>
  )
}
