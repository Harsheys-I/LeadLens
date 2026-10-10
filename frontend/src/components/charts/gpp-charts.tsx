import { type ReactNode, useState } from 'react'
import { Bar } from './bar'
import { BarChart } from './bar-chart'
import { BarXAxis } from './bar-x-axis'
import { ChartTooltip } from './tooltip/chart-tooltip'
import { Grid } from './grid'
import {
  HeatmapCells,
  HeatmapChart,
  type HeatmapColumn,
  HeatmapLegend,
  HeatmapTooltip,
  HeatmapXAxis,
} from './heatmap'
import { PieCenter } from './pie-center'
import { PieChart } from './pie-chart'
import { PieSlice } from './pie-slice'
import { Ring } from './ring'
import { RingCenter } from './ring-center'
import { RingChart } from './ring-chart'
import { YAxis } from './y-axis'

export const PINE_LIGHT = ['#e8f0e4', '#c5ddc4', '#7eaf86', '#3f8c68', '#1f5d45'] as const
export const PINE_DARK = ['#0e2a20', '#1b4a34', '#2f6b52', '#4a9a6e', '#7dcea6'] as const

export function pineRamp() {
  if (typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark') return PINE_DARK
  return PINE_LIGHT
}

export function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="relative isolate space-y-2 overflow-hidden rounded-2xl border border-zinc-200 p-3 dark:border-zinc-800">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  )
}

export function SliceLegend({
  items,
  onPick,
}: {
  items: Array<{ label: string; color?: string; value?: number }>
  onPick?: (label: string) => void
}) {
  if (!items.length) return null
  return (
    <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
      {items.map((item) => (
        <li key={item.label}>
          {onPick ? (
            <button type="button" className="flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-black/5 dark:hover:bg-white/10" onClick={() => onPick(item.label)}>
              <span className="size-2 rounded-full" style={{ background: item.color || 'var(--chart-1)' }} />
              <span>{item.label}{item.value != null ? ` · ${item.value}` : ''}</span>
            </button>
          ) : (
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ background: item.color || 'var(--chart-1)' }} />
              <span>{item.label}{item.value != null ? ` · ${item.value}` : ''}</span>
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

type BarSeries = { key: string; label: string; color: string; yAxisId?: string }

/** Same slot as the pre-React hero (`CATEGORY_WIDTH_PX` in sales-graph-dashboard.js). */
const CATEGORY_WIDTH_PX = 82
/** Stacked month bars: about half the grouped slot so segments stay slim. */
const STACKED_CATEGORY_WIDTH_PX = 40
const SCROLL_CHART_HEIGHT = 420

export function GroupedBars({
  title,
  data,
  series,
  xKey = 'name',
  stacked = false,
  scrollable = false,
  onSegment,
}: {
  title: string
  data: Array<Record<string, string | number>>
  series: BarSeries[]
  xKey?: string
  stacked?: boolean
  /** Fixed pixel width per category; the card scrolls instead of shrinking bars. */
  scrollable?: boolean
  onSegment?: (category: string, seriesLabel: string) => void
}) {
  if (!data.length || !series.length) return <ChartCard title={title}><p className="text-sm text-[var(--muted)]">No data for this chart.</p></ChartCard>
  const axes = [...new Set(series.map((item) => item.yAxisId || 'left'))]
  const margin = { top: 16, right: 48, bottom: 48, left: 48 }
  const categoryWidth = stacked ? STACKED_CATEGORY_WIDTH_PX : CATEGORY_WIDTH_PX
  const chartWidth = scrollable ? margin.left + margin.right + data.length * categoryWidth : undefined
  const chart = (
      <BarChart
        data={data}
        xDataKey={xKey}
        stacked={stacked}
        barGap={0.2}
        aspectRatio={chartWidth ? `${chartWidth} / ${SCROLL_CHART_HEIGHT}` : '2 / 1'}
        className={scrollable ? 'overflow-hidden' : 'min-h-[280px] overflow-hidden'}
        margin={margin}
      >
        <Grid />
        <BarXAxis />
        {axes.map((id) => (
          <YAxis key={id} yAxisId={id} orientation={id === 'right' ? 'right' : 'left'} />
        ))}
        <ChartTooltip showDatePill={false} />
        {series.map((item) => (
          <Bar
            key={item.key}
            dataKey={item.key}
            fill={item.color}
            yAxisId={item.yAxisId || 'left'}
            lineCap={4}
            onDatumClick={onSegment ? (category, seriesKey) => {
              const match = series.find((item) => item.key === seriesKey)
              onSegment(category, match?.label || seriesKey)
            } : undefined}
          />
        ))}
      </BarChart>
  )
  return (
    <ChartCard title={title}>
      {scrollable && chartWidth ? (
        <div className="overflow-x-auto">
          <div style={{ width: chartWidth, height: SCROLL_CHART_HEIGHT }}>{chart}</div>
        </div>
      ) : chart}
      <SliceLegend items={series.map((item) => ({ label: item.label, color: item.color }))} />
    </ChartCard>
  )
}

export function SolidPie({
  title,
  slices,
  onSegment,
}: {
  title: string
  slices: Array<{ label: string; value: number; color?: string }>
  onSegment?: (label: string) => void
}) {
  const data = slices.filter((slice) => slice.value > 0)
  if (!data.length) return <ChartCard title={title}><p className="text-sm text-[var(--muted)]">No data for this chart.</p></ChartCard>
  return (
    <ChartCard title={title}>
      <div className="mx-auto w-fit">
        <PieChart data={data} innerRadius={0} size={220}>
          {data.map((slice, index) => (
            <PieSlice key={slice.label} index={index} color={slice.color} onSelect={onSegment ? () => onSegment(slice.label) : undefined} />
          ))}
          <PieCenter defaultLabel={title} />
        </PieChart>
      </div>
      <SliceLegend items={data} onPick={onSegment} />
    </ChartCard>
  )
}

export function ShareRing({
  title,
  slices,
  scale = 'sum',
  onSegment,
}: {
  title: string
  slices: Array<{ label: string; value: number; color?: string }>
  /** `sum` fills the ring as a share of the total. `peak` sets the ring ceiling to the largest slice in this chart. */
  scale?: 'sum' | 'peak'
  onSegment?: (label: string) => void
}) {
  const data = slices.filter((slice) => slice.value > 0)
  const maxValue =
    (scale === 'peak'
      ? data.reduce((peak, slice) => Math.max(peak, slice.value), 0)
      : data.reduce((sum, slice) => sum + slice.value, 0)) || 1
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  if (!data.length) return <ChartCard title={title}><p className="text-sm text-[var(--muted)]">No data for this chart.</p></ChartCard>
  const hoveredLabel = hoveredIndex == null ? '' : data[hoveredIndex]?.label || ''
  return (
    <ChartCard title={title}>
      <div className="mx-auto h-[280px] w-[280px] max-w-full overflow-hidden">
        <RingChart
          data={data.map((slice) => ({ label: slice.label, value: slice.value, maxValue, color: slice.color }))}
          hoveredIndex={hoveredIndex}
          onHoverChange={setHoveredIndex}
          size={280}
        >
          {data.map((slice, index) => (
            <Ring key={slice.label} index={index} color={slice.color} onSelect={onSegment ? () => onSegment(slice.label) : undefined} />
          ))}
          <RingCenter defaultLabel="Total">
            {({ value }) => (
              <span className="font-bold tabular-nums leading-none text-[clamp(1.25rem,22cqw,1.875rem)]">
                {new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)}
              </span>
            )}
          </RingCenter>
        </RingChart>
      </div>
      <p
        className="mx-auto min-h-10 max-w-full break-words px-2 text-center text-sm leading-snug text-foreground"
        title={hoveredLabel || undefined}
      >
        {hoveredLabel || '\u00a0'}
      </p>
      <SliceLegend items={data} onPick={onSegment} />
    </ChartCard>
  )
}

export function ProjectMonthHeat({
  title,
  projects,
  months,
  valueAt,
  formatMonth,
}: {
  title: string
  projects: string[]
  months: string[]
  valueAt: (project: string, month: string) => number
  formatMonth: (month: string) => string
}) {
  if (!projects.length || !months.length) {
    return <ChartCard title={title}><p className="text-sm text-[var(--muted)]">No data for heatmap.</p></ChartCard>
  }
  let max = 0
  const data: HeatmapColumn[] = months.map((month, column) => {
    const parsed = /^\d{6}$/.test(month) ? new Date(Number(month.slice(0, 4)), Number(month.slice(4, 6)) - 1, 1) : new Date()
    return {
      bin: column,
      bins: projects.map((project, row) => {
        const count = valueAt(project, month)
        if (count > max) max = count
        return { count, bin: row, date: parsed }
      }),
    }
  })
  const ramp = pineRamp()
  const denom = max > 0 ? max : 1
  const rowPx = 26
  return (
    <ChartCard title={title}>
      <div className="flex items-start gap-3">
        <ul className="w-36 shrink-0 text-xs text-[var(--muted)]" style={{ paddingTop: 28 }}>
          {projects.map((project) => (
            <li key={project} className="truncate" title={project} style={{ height: rowPx, lineHeight: `${rowPx}px` }}>
              {project}
            </li>
          ))}
        </ul>
        <div className="min-w-0 flex-1 overflow-x-auto">
          <HeatmapChart
            data={data}
            levelColors={ramp}
            layout="fluid"
            binSize={rowPx}
            stretchColumns
            minBinWidth={36}
            gap={5}
            colorScale={(count) => {
              const value = Number(count) || 0
              if (value <= 0) return ramp[0]
              const t = Math.max(0, Math.min(1, value / denom))
              const curved = t ** 2
              return ramp[Math.min(4, Math.max(1, Math.ceil(curved * 4 - 1e-9)))]
            }}
            margin={{ top: 28, right: 4, bottom: 8, left: 4 }}
          >
            <HeatmapCells />
            <HeatmapXAxis />
            <HeatmapTooltip
              content={({ count, row, column }) => `${projects[row] || 'Project'} · ${formatMonth(months[column] || '')}: ${count}`}
            />
            <HeatmapLegend lessLabel="Less" moreLabel="More" />
          </HeatmapChart>
        </div>
      </div>
    </ChartCard>
  )
}
