import { useMemo, useState } from 'react'
import { FileJson, Gauge, Link2, MapPinned, ScanSearch, Shield, Sparkles } from 'lucide-react'
import { ActivityRings } from '@/components/ui/activity-rings.tsx'
import Loader from '@/components/ui/loader.tsx'
import SlideTextButton from '@/components/ui/slide-text-button.tsx'
import SpotlightCards from '@/components/ui/spotlight-cards.tsx'
import SmoothTab from '@/components/ui/smooth-tab.tsx'
import { activityRing, RING } from '@/lib/rings.ts'
import { useView } from '@/lib/use-view.ts'
import { SeoAuditCharts, SeoTrafficCharts } from '@/components/charts/seo-charts.tsx'
import { auditMeta, mean, scoreAuditPages } from '@/seo/audit-data.ts'
import { buildSinglePageAuditObj, isGuruPunvaaniiDomain, type RawPage, type ScoredPage } from '@/seo/score.ts'

const VIEWS = ['scanner', 'overview', 'technical', 'on-page', 'schema', 'off-page', 'performance', 'local', 'traffic', 'roadmap']

const SEO_TABS = [
  ['scanner', 'Scanner'],
  ['overview', 'Overview'],
  ['technical', 'Technical'],
  ['on-page', 'On-page'],
  ['schema', 'Schema'],
  ['off-page', 'Off-page'],
  ['performance', 'Vitals'],
  ['local', 'Silos'],
  ['traffic', 'Traffic'],
  ['roadmap', 'Plan'],
] as const

export default function SeoPage() {
  const { view, select } = useView(VIEWS, 'scanner')
  const pages = useMemo(() => scoreAuditPages(), [])
  return (
    <SmoothTab
      items={SEO_TABS.map(([id, title]) => ({ id, title, color: 'bg-zinc-900 dark:bg-white' }))}
      selected={view}
      onChange={select}
    >
      {view === 'scanner' ? <Scanner /> : null}
      {view === 'overview' ? <Overview pages={pages} /> : null}
      {view === 'technical' ? <IssueTable pages={pages} category="Technical SEO" title="Technical SEO" /> : null}
      {view === 'on-page' ? <IssueTable pages={pages} category="On-Page SEO" title="On-Page SEO" /> : null}
      {view === 'schema' ? <SchemaView pages={pages} /> : null}
      {view === 'off-page' ? <OffPage pages={pages} /> : null}
      {view === 'performance' ? <Performance pages={pages} /> : null}
      {view === 'local' ? <Local pages={pages} /> : null}
      {view === 'traffic' ? <Traffic pages={pages} /> : null}
      {view === 'roadmap' ? <Roadmap pages={pages} /> : null}
    </SmoothTab>
  )
}

function Scanner() {
  const [url, setUrl] = useState('https://gurupunvaanii.com/')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [page, setPage] = useState<ScoredPage | null>(null)

  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault()
        const target = url.trim()
        if (!isGuruPunvaaniiDomain(target)) {
          setPage(null)
          setMessage('Invalid domain. Audits stay on gurupunvaanii.com.')
          return
        }
        setBusy(true)
        setMessage('Scanning…')
        const endpoints = ['/api/audit', 'http://localhost:8080/api/audit']
        let live: Record<string, unknown> | null = null
        for (const endpoint of endpoints) {
          try {
            const res = await fetch(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: target }),
            })
            if (res.ok) {
              live = await res.json() as Record<string, unknown>
              break
            }
          } catch {
            /* try the next scanner, then the embedded crawl */
          }
        }
        const embedded = scoreAuditPages().find((row) => row.url === target || row.final_url === target)
        const scored = live ? buildSinglePageAuditObj(target, live as RawPage) : embedded || null
        setPage(scored)
        setBusy(false)
        setMessage(scored ? `Scored ${scored.url}` : 'No crawl row for that URL.')
      }}
    >
      <label className="block text-sm">
        URL or sitemap
        <input value={url} onChange={(e) => setUrl(e.target.value)} className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950" />
      </label>
      <SlideTextButton type="submit" text="Run audit" hoverText="Scan URL" disabled={busy} />
      {busy ? <p className="text-sm text-zinc-500">Scanning gurupunvaanii.com.</p> : null}
      {message ? <p className="text-sm">{message}</p> : null}
      {page ? <p className="text-sm">Overall {page.overall_score} · technical {page.category_scores.technical} · CWV {page.category_scores.cwv}</p> : null}
    </form>
  )
}

function Overview({ pages }: { pages: ScoredPage[] }) {
  const overall = mean(pages.map((page) => page.overall_score))
  const technical = mean(pages.map((page) => page.category_scores.technical))
  const cwv = mean(pages.map((page) => page.category_scores.cwv))
  const meta = auditMeta()
  const p0 = pages.reduce((sum, page) => sum + page.issues.filter((issue) => issue.type === 'P0').length, 0)
  return (
    <div className="space-y-6">
      <ActivityRings
        title="SEO health"
        data={[
          activityRing('Overall', overall, 100, RING.rose, 168, 'score'),
          activityRing('Technical', technical, 100, RING.lime, 124, 'score'),
          activityRing('CWV', cwv, 100, RING.cyan, 80, 'score'),
        ]}
      />
      <SpotlightCards
        eyebrow="Command center"
        heading={`${pages.length || meta.totalCrawled} URLs · P0 ${p0}`}
        items={[
          { icon: ScanSearch, title: 'Technical', description: `Average ${technical}`, color: '#6366f1' },
          { icon: Sparkles, title: 'On-page', description: `Average ${mean(pages.map((page) => page.category_scores.onpage))}`, color: '#f59e0b' },
          { icon: FileJson, title: 'Schema', description: `Average ${mean(pages.map((page) => page.category_scores.schema))}`, color: '#a855f7' },
          { icon: Gauge, title: 'CWV', description: `Average ${cwv}`, color: '#04C7DD' },
          { icon: Shield, title: 'Security', description: `Average ${mean(pages.map((page) => page.category_scores.security))}`, color: '#A3F900' },
          { icon: Link2, title: 'Media', description: `Average ${mean(pages.map((page) => page.category_scores.media))}`, color: '#FF2D55' },
        ]}
      />
      <SeoAuditCharts pages={pages} />
    </div>
  )
}

function IssueTable({ pages, category, title }: { pages: ScoredPage[]; category: string; title: string }) {
  const rows = pages.flatMap((page) => page.issues.filter((issue) => issue.category === category).map((issue) => ({ url: page.url, ...issue })))
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      <ul className="space-y-2 text-sm">
        {rows.slice(0, 80).map((row) => (
          <li key={`${row.url}-${row.msg}`} className="rounded-2xl border border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <span className="font-medium">{row.type}</span> {row.msg}
            <span className="mt-1 block text-xs text-zinc-500">{row.url}</span>
          </li>
        ))}
        {rows.length === 0 ? <li>No {category} issues in this crawl.</li> : null}
      </ul>
    </section>
  )
}

function SchemaView({ pages }: { pages: ScoredPage[] }) {
  return (
    <ul className="space-y-2 text-sm">
      {pages.map((page) => (
        <li key={page.url} className="rounded-2xl border border-zinc-200 px-3 py-2 dark:border-zinc-800">
          <span className="font-medium">{page.title || page.url}</span>
          <span className="mt-1 block text-zinc-500">{page.schemas.length ? page.schemas.join(', ') : 'No JSON-LD'}</span>
        </li>
      ))}
    </ul>
  )
}

function OffPage({ pages }: { pages: ScoredPage[] }) {
  return (
    <ul className="space-y-2 text-sm">
      {pages.map((page) => (
        <li key={page.url} className="flex justify-between gap-3 rounded-2xl border border-zinc-200 px-3 py-2 dark:border-zinc-800">
          <span className="truncate">{page.url}</span>
          <span>{page.internal_links_count} internal · {page.external_links_count} external</span>
        </li>
      ))}
    </ul>
  )
}

function Performance({ pages }: { pages: ScoredPage[] }) {
  return (
    <ul className="space-y-2 text-sm">
      {pages.map((page) => (
        <li key={page.url} className="rounded-2xl border border-zinc-200 px-3 py-2 dark:border-zinc-800">
          <span className="font-medium">{page.title || page.url}</span>
          <span className="mt-1 block text-zinc-500">LCP {page.cwv.lcp} {page.cwv.lcpStatus} · INP {page.cwv.inp} · CLS {page.cwv.cls} · TTFB {page.cwv.ttfb}</span>
        </li>
      ))}
    </ul>
  )
}

function Local({ pages }: { pages: ScoredPage[] }) {
  const groups = new Map<string, ScoredPage[]>()
  for (const page of pages) {
    let segment = 'home'
    try {
      const parts = new URL(page.url).pathname.split('/').filter(Boolean)
      segment = parts[0] || 'home'
    } catch {
      segment = 'home'
    }
    const list = groups.get(segment) || []
    list.push(page)
    groups.set(segment, list)
  }
  return (
    <div className="space-y-4">
      <MapPinned className="size-5 text-zinc-500" />
      {[...groups.entries()].map(([name, list]) => (
        <section key={name}>
          <h2 className="font-semibold">{name} · {list.length}</h2>
          <p className="text-sm text-zinc-500">Average {mean(list.map((page) => page.overall_score))}</p>
        </section>
      ))}
    </div>
  )
}

function Traffic({ pages }: { pages: ScoredPage[] }) {
  void pages
  return <SeoTrafficCharts />
}

function Roadmap({ pages }: { pages: ScoredPage[] }) {
  const issues = pages.flatMap((page) => page.issues.map((issue) => ({ ...issue, url: page.url })))
  const rank = (type: string) => (type === 'P0' ? 0 : type === 'P1' ? 1 : 2)
  issues.sort((a, b) => rank(a.type) - rank(b.type))
  return (
    <ol className="space-y-2 text-sm">
      {issues.slice(0, 30).map((issue, index) => (
        <li key={`${issue.url}-${issue.msg}-${index}`} className="rounded-2xl border border-zinc-200 px-3 py-2 dark:border-zinc-800">
          <span className="font-medium">{index + 1}. {issue.type}</span> {issue.msg}
          <span className="mt-1 block text-xs text-zinc-500">{issue.url}</span>
        </li>
      ))}
    </ol>
  )
}
