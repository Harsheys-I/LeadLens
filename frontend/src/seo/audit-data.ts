import raw from './audit-raw.json'
import { buildSinglePageAuditObj, type RawPage, type ScoredPage } from '@/seo/score.ts'

type AuditFile = {
  pages?: Record<string, RawPage>
  total_crawled?: number
  redirect_tests?: Record<string, { status?: number; location?: string | null }>
  images_summary?: { total?: number; missing_alt?: number }
}

const embedded = raw as unknown as AuditFile

function asPageMap(pages: unknown): Array<[string, RawPage]> {
  if (!pages) return []
  if (Array.isArray(pages)) {
    return pages.map((page, index) => {
      const row = page as RawPage
      return [row.url || row.final_url || `page-${index}`, row] as [string, RawPage]
    })
  }
  if (typeof pages === 'object') return Object.entries(pages as Record<string, RawPage>)
  return []
}

export function loadAuditPages(): Array<[string, RawPage]> {
  try {
    const saved = localStorage.getItem('GURU_LATEST_AUDIT_DATA')
    if (saved) {
      const parsed = JSON.parse(saved) as { pages?: unknown }
      const rows = asPageMap(parsed.pages)
      if (rows.length) return rows
    }
  } catch {
    /* keep the embedded crawl */
  }
  return asPageMap(embedded.pages)
}

export function scoreAuditPages(rows = loadAuditPages()): ScoredPage[] {
  return rows.map(([url, page]) => {
    if (page.overall_score != null && page.category_scores && page.cwv && page.issues) {
      return { ...page, url: page.url || url } as ScoredPage
    }
    return buildSinglePageAuditObj(url, page)
  })
}

export function mean(values: number[]) {
  if (!values.length) return 0
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

export function auditMeta() {
  return {
    totalCrawled: embedded.total_crawled ?? Object.keys(embedded.pages || {}).length,
    redirects: embedded.redirect_tests || {},
    images: embedded.images_summary || null,
  }
}
