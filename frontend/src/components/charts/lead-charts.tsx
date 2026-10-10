import { leadChartSeries } from '@/lib/lead-kpis.ts'
import { GroupedBars, ShareRing, SolidPie } from './gpp-charts'

export function LeadCharts({ results }: { results: Array<Record<string, unknown>> }) {
  const series = leadChartSeries(results)
  return (
    <div className="space-y-4 p-2">
      <GroupedBars title="Accuracy" data={series.accuracy} series={[{ key: 'value', label: 'Accuracy %', color: 'var(--chart-bar)' }]} />
      <GroupedBars title="Errors" data={series.errors} series={[{ key: 'value', label: 'Errors', color: 'var(--red)' }]} />
      <GroupedBars title="Projects" data={series.projects} series={[{ key: 'value', label: 'Errors', color: 'var(--chart-2)' }]} />
      <GroupedBars
        title="Severity"
        data={series.severity}
        series={[
          { key: 'Critical', label: 'Critical', color: 'var(--red)' },
          { key: 'Medium', label: 'Medium', color: 'var(--amber)' },
        ]}
      />
      <GroupedBars
        title="Comment quality"
        data={series.commentQuality}
        series={series.commentQualityBands.map((band) => ({ key: band.label, label: band.label, color: band.color }))}
      />
      <SolidPie title="Overdue days" slices={series.overdue} />
      <ShareRing title="Error types" slices={series.errorTypes} />
    </div>
  )
}
