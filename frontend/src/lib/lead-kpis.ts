/** Same error labels and accuracy ratio as dashboard-export.js / dashboard-metrics.js. */

const HIGH_SEVERITY_ERRORS = new Set([
  'Follow-up Missed',
  'Customer Requirement Empty',
  'Customer Comment Quality Not Appropriate',
])

function clean(value: unknown) {
  const n = String(value ?? '').trim().toLowerCase()
  if (['', 'nan', 'none', 'nat', 'undefined', 'null'].includes(n)) return ''
  return String(value).trim()
}

function splitErrorLabels(errorTypes: unknown) {
  const raw = clean(errorTypes)
  if (!raw || /^none$/i.test(raw)) return []
  return raw
    .split(/\s*\|\s*|\s*,\s*/)
    .map((part) => part.trim())
    .filter((part) => Boolean(part) && !/^none$/i.test(part) && !/\bTAT\b/i.test(part))
}

function mapSeverity(errorSeverity: unknown, errorLabels: string[]) {
  const sev = String(errorSeverity || '').toUpperCase()
  if (sev === 'HIGH') return 'Critical'
  if (sev === 'MEDIUM') return 'Medium'
  if (sev === 'NONE' || !errorLabels.length) return ''
  return errorLabels.some((label) => HIGH_SEVERITY_ERRORS.has(label)) ? 'Critical' : 'Medium'
}

export type LeadRow = {
  telecaller: string
  project: string
  errorLabels: string[]
  severity: string
  errorFlag: number
  errorDetails: string
  status: string
  commentQuality: number | null
  overdueDays: number | null
}

export function mapLeadRows(results: Array<Record<string, unknown>>): LeadRow[] {
  return results.map((row) => {
    const labels = splitErrorLabels(row.errorTypes)
    const errorFlag = labels.length ? 1 : 0
    const quality = Number(row.commentQuality)
    const overdue = Number(row.overdueDays ?? row.overdue)
    const closed = /lost|beyond budget/i.test(clean(row.status))
    return {
      telecaller: clean(row.telecaller) || 'Unknown',
      project: clean(row.project),
      errorLabels: labels,
      severity: mapSeverity(row.errorSeverity, labels),
      errorFlag,
      errorDetails: clean(row.observation),
      status: clean(row.status),
      commentQuality: Number.isFinite(quality) ? quality : null,
      overdueDays: closed || !Number.isFinite(overdue) ? null : Math.round(overdue),
    }
  })
}

export function summarizeLeads(results: Array<Record<string, unknown>>) {
  const rows = mapLeadRows(results)
  const total = rows.length
  const errors = rows.reduce((sum, row) => sum + row.errorFlag, 0)
  const critical = rows.filter((row) => row.severity === 'Critical').length
  const clean = Math.max(0, total - errors)
  const notCritical = Math.max(0, total - critical)
  const accuracy = total ? Math.max(0, 1 - errors / total) : 0
  const byTele = new Map<string, { name: string; leads: number; errors: number; critical: number; medium: number }>()
  for (const row of rows) {
    const bucket = byTele.get(row.telecaller) || { name: row.telecaller, leads: 0, errors: 0, critical: 0, medium: 0 }
    bucket.leads += 1
    bucket.errors += row.errorFlag
    if (row.severity === 'Critical') bucket.critical += 1
    if (row.severity === 'Medium') bucket.medium += 1
    byTele.set(row.telecaller, bucket)
  }
  const scorecard = [...byTele.values()]
    .map((bucket) => {
      const acc = bucket.leads ? Math.max(0, 1 - bucket.errors / bucket.leads) : 0
      return { ...bucket, accuracy: acc }
    })
    .sort((a, b) => b.accuracy - a.accuracy || a.name.localeCompare(b.name))
  return { rows, total, errors, critical, clean, notCritical, accuracy, scorecard }
}

const OVERDUE_BUCKETS = ['1-5', '5-20', '20-50', '50-100', '100+'] as const
const CQ_BUCKETS = [
  { key: '0-2', label: 'Bad', color: 'var(--red)' },
  { key: '3-4', label: 'Average', color: 'var(--amber)' },
  { key: '5-6', label: 'Good', color: '#c9a227' },
  { key: '7-8', label: 'Very good', color: '#3f8c68' },
  { key: '9-10', label: 'Excellent', color: 'var(--chart-bar)' },
] as const

function overdueBucket(days: number | null) {
  if (days == null || !Number.isFinite(days) || days < 1) return null
  if (days <= 5) return '1-5'
  if (days <= 20) return '5-20'
  if (days <= 50) return '20-50'
  if (days <= 100) return '50-100'
  return '100+'
}

function commentQualityKey(score: number | null) {
  if (score == null || !Number.isFinite(score)) return null
  if (score <= 2) return '0-2'
  if (score <= 4) return '3-4'
  if (score <= 6) return '5-6'
  if (score <= 8) return '7-8'
  return '9-10'
}

export function leadChartSeries(results: Array<Record<string, unknown>>) {
  const summary = summarizeLeads(results)
  const rows = summary.rows
  const names = summary.scorecard.map((row) => row.name)
  const errorTypes = new Map<string, number>()
  const projects = new Map<string, number>()
  const overdue = new Map<string, number>(OVERDUE_BUCKETS.map((label) => [label, 0]))
  const quality = new Map<string, Map<string, number>>()
  for (const row of rows) {
    const qualityKey = commentQualityKey(row.commentQuality)
    if (qualityKey) {
      const bucket = quality.get(row.telecaller) || new Map<string, number>()
      bucket.set(qualityKey, (bucket.get(qualityKey) || 0) + 1)
      quality.set(row.telecaller, bucket)
    }
    const overdueKey = overdueBucket(row.overdueDays)
    if (overdueKey) overdue.set(overdueKey, (overdue.get(overdueKey) || 0) + 1)
    if (row.errorFlag) {
      const project = row.project || '(No project)'
      projects.set(project, (projects.get(project) || 0) + 1)
      const labels = row.errorLabels.length ? row.errorLabels : []
      for (const label of labels) errorTypes.set(label, (errorTypes.get(label) || 0) + 1)
    }
  }
  const ranked = (map: Map<string, number>) => [...map.entries()].filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return {
    accuracy: names.map((name, index) => ({ name, value: Math.round(summary.scorecard[index].accuracy * 1000) / 10 })),
    errors: names.map((name, index) => ({ name, value: summary.scorecard[index].errors })),
    projects: ranked(projects).map(([name, value]) => ({ name, value })),
    severity: names.map((name, index) => ({
      name,
      Critical: summary.scorecard[index].critical,
      Medium: summary.scorecard[index].medium,
    })),
    commentQuality: names.map((name) => {
      const bucket = quality.get(name)
      const row: Record<string, string | number> = { name }
      for (const band of CQ_BUCKETS) row[band.label] = bucket?.get(band.key) || 0
      return row
    }),
    commentQualityBands: CQ_BUCKETS.map((band) => ({ label: band.label, color: band.color })),
    overdue: OVERDUE_BUCKETS.map((label) => ({ label, value: overdue.get(label) || 0 })).filter((slice) => slice.value > 0),
    errorTypes: ranked(errorTypes).map(([label, value]) => ({ label, value })),
  }
}
