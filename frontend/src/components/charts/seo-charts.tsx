import { curveCatmullRom } from '@visx/curve'
import { useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api.ts'
import type { ScoredPage } from '@/seo/score.ts'
import { Area } from './area'
import { ChartCard, GroupedBars, ShareRing, SolidPie } from './gpp-charts'
import { ChartTooltip } from './tooltip/chart-tooltip'
import { ComposedChart } from './composed-chart'
import { Grid } from './grid'
import { Line } from './line'
import { XAxis } from './x-axis'
import { YAxis } from './y-axis'

const PILLARS = [
  ['technical', 'Technical SEO'],
  ['onpage', 'On-Page SEO'],
  ['schema', 'Schema Markup'],
  ['media', 'Media & Images'],
  ['security', 'Security & HTTPS'],
  ['cwv', 'Core Web Vitals'],
] as const

export function SeoAuditCharts({ pages }: { pages: ScoredPage[] }) {
  const model = useMemo(() => buildAuditCharts(pages), [pages])
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SolidPie title="Indexability" slices={model.indexability} />
      <GroupedBars title="Pillars" data={model.pillars} series={[{ key: 'value', label: 'Score', color: 'var(--chart-1)' }]} />
      <ShareRing title="Priority" slices={model.priority} />
      <GroupedBars title="Titles" data={model.titles} series={[{ key: 'value', label: 'Pages', color: 'var(--chart-2)' }]} />
      <ShareRing title="Image alt" slices={model.images} />
    </div>
  )
}

export function SeoTrafficCharts() {
  const [state, setState] = useState<'load' | 'ready' | 'empty' | 'error'>('load')
  const [message, setMessage] = useState('')
  const [trend, setTrend] = useState<Array<{ date: string; clicks: number; impressions: number }>>([])
  const [channels, setChannels] = useState<Array<{ name: string; value: number }>>([])

  useEffect(() => {
    let stop = false
    Promise.allSettled([api('gsc'), api('ga4')]).then((results) => {
      if (stop) return
      const gsc = results[0].status === 'fulfilled' ? results[0].value : null
      const ga4 = results[1].status === 'fulfilled' ? results[1].value : null
      const daily = Array.isArray(gsc?.daily_trends) ? gsc.daily_trends as Array<Record<string, unknown>> : []
      const nextTrend = daily.map((row) => ({
        date: String(row.date || row.day || ''),
        clicks: Number(row.clicks || 0),
        impressions: Math.round(Number(row.impressions || 0) / 100),
      })).filter((row) => row.date)
      const channelRows = Array.isArray(ga4?.channels) ? ga4.channels as Array<Record<string, unknown>> : []
      const nextChannels = channelRows.map((row) => ({
        name: String(row.channel || 'Channel'),
        value: Number(row.sessions || 0),
      })).filter((row) => row.value > 0)
      setTrend(nextTrend)
      setChannels(nextChannels)
      if (!nextTrend.length && !nextChannels.length) {
        const failed = results.every((item) => item.status === 'rejected')
        setState(failed ? 'error' : 'empty')
        setMessage(failed ? 'Search Console and Analytics did not respond.' : 'No traffic rows in the latest response.')
        return
      }
      setState('ready')
    })
    return () => { stop = true }
  }, [])

  if (state === 'load') return <p className="text-sm text-[var(--muted)]">Loading Search Console and Analytics.</p>
  if (state === 'error' || state === 'empty') return <p className="text-sm text-[var(--muted)]">{message}</p>
  return (
    <div className="space-y-4">
      {trend.length ? (
        <ChartCard title="Organic traffic">
          <div className="h-72 w-full">
            <ComposedChart data={trend} xDataKey="date">
              <Grid />
              <XAxis />
              <YAxis />
              <ChartTooltip />
              <Area dataKey="clicks" fill="var(--chart-6)" fillOpacity={0.12} stroke="var(--chart-6)" curve={curveCatmullRom.alpha(0.42)} />
              <Line dataKey="impressions" stroke="var(--chart-3)" curve={curveCatmullRom.alpha(0.42)} dashFromIndex={0} dashArray="6,4" />
            </ComposedChart>
          </div>
          <p className="text-xs text-[var(--muted)]">Clicks and impressions / 100.</p>
        </ChartCard>
      ) : <p className="text-sm text-[var(--muted)]">No Search Console trend in this response.</p>}
      <GroupedBars title="Channels" data={channels} series={[{ key: 'value', label: 'Sessions', color: 'var(--chart-6)' }]} />
    </div>
  )
}

function buildAuditCharts(pages: ScoredPage[]) {
  let indexable = 0
  let soft = 0
  let redirect = 0
  let blocked = 0
  let imagesOk = 0
  let imagesMissing = 0
  const priority = { P0: 0, P1: 0, P2: 0, P3: 0 }
  const titles = { Optimal: 0, Short: 0, Long: 0, Missing: 0 }
  const pillarSums = Object.fromEntries(PILLARS.map(([key]) => [key, 0])) as Record<string, number>
  for (const page of pages) {
    const status = Number(page.status || 200)
    const robots = String(page.meta_robots || '')
    if (/noindex|disallow/i.test(robots)) blocked += 1
    else if (status >= 300 && status < 400 || page.canonical_match === false) redirect += 1
    else if (status === 404 || status >= 500) soft += 1
    else indexable += 1
    const titleLen = (page.title || '').trim().length
    if (!titleLen) titles.Missing += 1
    else if (titleLen < 30) titles.Short += 1
    else if (titleLen > 65) titles.Long += 1
    else titles.Optimal += 1
    imagesOk += Math.max(0, page.images_total - page.images_missing_alt)
    imagesMissing += page.images_missing_alt
    for (const issue of page.issues || []) {
      if (issue.type in priority) priority[issue.type as keyof typeof priority] += 1
    }
    for (const [key] of PILLARS) pillarSums[key] += Number(page.category_scores?.[key] || 0)
  }
  const count = pages.length || 1
  return {
    indexability: [
      { label: 'Indexable', value: indexable, color: 'var(--chart-3)' },
      { label: 'Soft-404 / errors', value: soft, color: 'var(--red)' },
      { label: 'Redirects / non-canonical', value: redirect, color: 'var(--amber)' },
      { label: 'Blocked', value: blocked, color: 'var(--chart-7)' },
    ],
    pillars: PILLARS.map(([key, name]) => ({ name, value: Math.round((pillarSums[key] / count) * 10) / 10 })),
    priority: [
      { label: 'P0', value: priority.P0, color: 'var(--red)' },
      { label: 'P1', value: priority.P1, color: 'var(--amber)' },
      { label: 'P2', value: priority.P2, color: 'var(--chart-6)' },
      { label: 'P3', value: priority.P3, color: 'var(--chart-3)' },
    ],
    titles: [
      { name: 'Optimal', value: titles.Optimal },
      { name: 'Too short', value: titles.Short },
      { name: 'Too long', value: titles.Long },
      { name: 'Missing', value: titles.Missing },
    ].filter((row) => row.value > 0),
    images: [
      { label: 'Optimized alt', value: imagesOk, color: 'var(--chart-3)' },
      { label: 'Missing alt', value: imagesMissing, color: 'var(--red)' },
    ],
  }
}
