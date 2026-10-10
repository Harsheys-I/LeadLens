/**
 * Scoring copied from web-app/SEO/app.js (computeCoreWebVitals + buildSinglePageAuditObj).
 * Thresholds and weights are unchanged.
 */

export type RawPage = {
  status?: number
  final_url?: string
  elapsed?: number
  size_bytes?: number
  title?: string
  meta_desc?: string
  meta_descriptions?: string[]
  canonical?: string
  canonicals?: string[]
  canonical_match?: boolean
  h1s?: string[]
  h2s?: string[]
  h3_count?: number
  word_count?: number
  json_ld_types?: string[]
  schema_types?: string[]
  images_count?: number
  images?: unknown[]
  images_missing_alt?: number
  internal_outlinks_count?: number
  scripts_count?: number
  styles_count?: number
  meta_robots?: string
  og?: Record<string, string>
  overall_score?: number
  category_scores?: CategoryScores
  cwv?: Cwv
  issues?: AuditIssue[]
  recommendations?: string[]
  positives?: string[]
  url?: string
}

export type AuditIssue = { type: string; category: string; msg: string }
export type CategoryScores = {
  technical: number
  onpage: number
  schema: number
  media: number
  security: number
  cwv: number
}
export type Cwv = {
  score: number
  lcp: string
  lcpStatus: string
  inp: string
  inpStatus: string
  cls: string
  clsStatus: string
  ttfb: string
  ttfbStatus: string
}

export type ScoredPage = RawPage & {
  url: string
  overall_score: number
  category_scores: CategoryScores
  cwv: Cwv
  issues: AuditIssue[]
  recommendations: string[]
  positives: string[]
  title: string
  word_count: number
  images_total: number
  images_missing_alt: number
  schemas: string[]
  internal_links_count: number
  external_links_count: number
}

export function isGuruPunvaaniiDomain(urlStr: string) {
  if (!urlStr || typeof urlStr !== 'string') return false
  let cleanUrl = urlStr.trim()
  if (!cleanUrl) return false
  if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) cleanUrl = `https://${cleanUrl}`
  try {
    const host = new URL(cleanUrl).hostname.toLowerCase()
    return host === 'gurupunvaanii.com' || host === 'www.gurupunvaanii.com' || host.endsWith('.gurupunvaanii.com')
  } catch {
    return false
  }
}

function computeCoreWebVitals(htmlSize: number, domCount: number, wordCount: number, imagesMissingAlt: number, hasSsl: boolean): Cwv {
  void wordCount
  void hasSsl
  const lcp = Math.max(0.8, (htmlSize / 350000) * 1.8 + (domCount / 1200) * 0.6).toFixed(2)
  const inp = Math.min(380, Math.max(45, Math.round(domCount * 0.08 + htmlSize / 25000)))
  const cls = (imagesMissingAlt > 0 ? imagesMissingAlt * 0.025 + 0.04 : 0.02).toFixed(3)
  const ttfb = Math.max(65, Math.round(htmlSize / 8000 + 75))
  const lcpNum = Number(lcp)
  const clsNum = Number(cls)
  const lcpStatus = lcpNum <= 2.5 ? 'GOOD' : lcpNum <= 4.0 ? 'NEEDS IMPROVEMENT' : 'POOR'
  const inpStatus = inp <= 200 ? 'GOOD' : 'NEEDS IMPROVEMENT'
  const clsStatus = clsNum <= 0.1 ? 'GOOD' : 'POOR'
  const ttfbStatus = ttfb <= 800 ? 'GOOD' : 'POOR'
  let cwvScore = 100
  if (lcpStatus === 'POOR') cwvScore -= 30
  else if (lcpStatus === 'NEEDS IMPROVEMENT') cwvScore -= 15
  if (inpStatus !== 'GOOD') cwvScore -= 15
  if (clsStatus !== 'GOOD') cwvScore -= 15
  if (ttfbStatus !== 'GOOD') cwvScore -= 10
  return {
    score: Math.max(30, cwvScore),
    lcp: `${lcp}s`,
    lcpStatus,
    inp: `${inp}ms`,
    inpStatus,
    cls,
    clsStatus,
    ttfb: `${ttfb}ms`,
    ttfbStatus,
  }
}

export function buildSinglePageAuditObj(url: string, p: RawPage): ScoredPage {
  const imagesTotal = p.images_count || (p.images ? p.images.length : 0)
  const imagesMissing = p.images_missing_alt || 0
  const wordCount = p.word_count || 0
  const htmlSize = p.size_bytes || 85000
  const domCount = Math.round(wordCount * 1.4) || 600
  const title = p.title || ''
  const metaDesc = p.meta_desc || (p.meta_descriptions && p.meta_descriptions[0]) || ''
  const canonical = p.canonical || (p.canonicals && p.canonicals[0]) || url
  const h1s = p.h1s || []
  const h2s = p.h2s || []
  const schemas = (p.json_ld_types || p.schema_types || []).filter((item): item is string => Boolean(item))
  const cwv = computeCoreWebVitals(htmlSize, domCount, wordCount, imagesMissing, url.startsWith('https'))
  let techScore = 100
  let onpageScore = 100
  const schemaScore = schemas.length ? 100 : 30
  const mediaScore = imagesMissing === 0 ? 100 : Math.max(40, 100 - imagesMissing * 5)
  const secScore = url.startsWith('https') ? 100 : 50
  const issues: AuditIssue[] = []
  const positives: string[] = []
  const recs: string[] = []

  if (p.canonical_match || canonical === url) {
    positives.push('Self-referencing canonical tag is correctly declared in HTML head.')
  } else {
    techScore -= 20
    issues.push({ type: 'P0', category: 'Technical SEO', msg: 'Canonical tag mismatch or missing.' })
    recs.push('Ensure self-referencing canonical tag matches final page URL.')
  }
  if (htmlSize > 500000) {
    techScore -= 10
    issues.push({ type: 'P1', category: 'Performance', msg: `Heavy HTML payload (${Math.round(htmlSize / 1024)} KB). Benchmark: <100 KB.` })
    recs.push('Optimize DOM hierarchy and compress assets.')
  } else {
    positives.push(`HTML payload is lightweight (${Math.round(htmlSize / 1024)} KB).`)
  }
  if (title && title.length >= 30 && title.length <= 65) {
    positives.push(`Optimal title tag length (${title.length} chars).`)
  } else if (!title) {
    onpageScore -= 30
    issues.push({ type: 'P0', category: 'On-Page SEO', msg: 'Missing <title> tag in <head>.' })
    recs.push('Add unique keyword-targeted title tag between 40-60 characters.')
  } else if (title.length < 30) {
    onpageScore -= 10
    issues.push({ type: 'P2', category: 'On-Page SEO', msg: `Title tag is too short (${title.length} chars).` })
  } else if (title.length > 65) {
    onpageScore -= 5
    issues.push({ type: 'P2', category: 'On-Page SEO', msg: `Title tag exceeds 65 chars (${title.length} chars) - SERP truncation risk.` })
  }
  if (metaDesc && metaDesc.length >= 70 && metaDesc.length <= 165 && !metaDesc.includes('.mp4')) {
    positives.push('Meta description is well-formed within 70-160 character benchmark.')
  } else if (!metaDesc) {
    onpageScore -= 25
    issues.push({ type: 'P1', category: 'On-Page SEO', msg: 'Missing meta description tag.' })
  } else if (metaDesc.includes('.mp4') || metaDesc.includes('http')) {
    onpageScore -= 25
    issues.push({ type: 'P0', category: 'On-Page SEO', msg: 'Corrupted meta description containing raw media URL strings.' })
    recs.push('Sanitize meta description to remove video URLs.')
  }
  if (h1s.length === 1) {
    positives.push(`Single semantic <h1> tag declared: "${h1s[0].slice(0, 35)}..."`)
    if (title && h1s[0].toLowerCase().trim() === title.toLowerCase().trim()) {
      positives.push('H1 tag aligns precisely with page title intent.')
    }
  } else if (h1s.length === 0) {
    onpageScore -= 20
    issues.push({ type: 'P1', category: 'On-Page SEO', msg: 'Missing <h1> heading tag on page.' })
    recs.push('Deploy a single <h1> heading containing primary intent.')
  } else if (h1s.length > 1) {
    onpageScore -= 10
    issues.push({ type: 'P2', category: 'On-Page SEO', msg: `Multiple <h1> headings (${h1s.length}) found on page.` })
    recs.push('Consolidate to a single <h1> and demote others to <h2>.')
  }
  if (schemas.length > 0) positives.push(`JSON-LD Schema types detected: ${schemas.join(', ')}`)
  else {
    issues.push({ type: 'P1', category: 'Structured Data', msg: 'Zero Schema.org JSON-LD structured data detected.' })
    recs.push('Deploy RealEstateAgent or SingleFamilyResidence JSON-LD markup.')
  }
  if (imagesMissing === 0) positives.push(`100% of images (${imagesTotal}) have descriptive ALT attributes.`)
  else {
    issues.push({ type: 'P1', category: 'Image SEO', msg: `${imagesMissing} out of ${imagesTotal} images are missing ALT attributes.` })
    recs.push(`Populate descriptive ALT attributes for all ${imagesMissing} images.`)
  }
  positives.push('Secured with valid HTTPS SSL protocol.')
  const overall = Math.round(techScore * 0.25 + onpageScore * 0.25 + schemaScore * 0.15 + mediaScore * 0.15 + secScore * 0.1 + cwv.score * 0.1)
  return {
    ...p,
    success: true,
    url,
    is_xml: false,
    status: p.status || 200,
    final_url: p.final_url || url,
    elapsed_ms: Math.round((p.elapsed || 0.15) * 1000),
    html_size_bytes: htmlSize,
    dom_elements: domCount,
    word_count: wordCount,
    overall_score: Math.max(15, Math.min(100, overall)),
    category_scores: {
      technical: Math.max(20, techScore),
      onpage: Math.max(20, onpageScore),
      schema: Math.max(10, schemaScore),
      media: Math.max(20, mediaScore),
      security: secScore,
      cwv: cwv.score,
    },
    cwv,
    title,
    title_len: title.length,
    meta_descriptions: metaDesc ? [metaDesc] : [],
    canonicals: [canonical],
    h1s,
    h2s: h2s.slice(0, 8),
    schemas,
    schema_types: schemas,
    images_total: imagesTotal,
    images_missing_alt: imagesMissing,
    internal_links_count: p.internal_outlinks_count || 35,
    external_links_count: 5,
    issues,
    recommendations: recs,
    positives,
  } as ScoredPage
}
