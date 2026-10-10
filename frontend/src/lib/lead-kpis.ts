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
  mobile: string
  errorLabels: string[]
  errorType: string
  severity: string
  errorFlag: number
  errorDetails: string
  action: string
  status: string
  commentQuality: number | null
  overdueDays: number | null
  registration: Date | null
}

function accuracyRating(accuracy: number) {
  const pctValue = Math.max(0, Math.min(100, (Number(accuracy) || 0) * 100))
  const filled = Math.min(5, Math.max(0, Math.round(pctValue / 20)))
  return `${'★'.repeat(filled)}${'☆'.repeat(5 - filled)}`
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
      mobile: clean(row.mobile),
      errorLabels: labels,
      errorType: labels.length ? labels.join(' | ') : 'None',
      severity: mapSeverity(row.errorSeverity, labels),
      errorFlag,
      errorDetails: clean(row.observation),
      action: clean(row.recommendation),
      status: clean(row.status),
      commentQuality: Number.isFinite(quality) ? quality : null,
      overdueDays: closed || !Number.isFinite(overdue) ? null : Math.round(overdue),
      registration: parseLooseDate(row.registration),
    }
  })
}

function parseLooseDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return startOfDay(value)
  const text = String(value ?? '').trim()
  if (!text) return null
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) {
    const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
    return Number.isNaN(date.valueOf()) ? null : date
  }
  const date = new Date(text)
  return Number.isNaN(date.valueOf()) ? null : startOfDay(date)
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export type LeadFilters = {
  telecallers: string[]
  projects: string[]
  severities: string[]
  errorTypes: string[]
  overdueBuckets: string[]
  commentQualityBuckets: string[]
  dateFrom: string
  dateTo: string
}

export const EMPTY_LEAD_FILTERS: LeadFilters = {
  telecallers: [],
  projects: [],
  severities: [],
  errorTypes: [],
  overdueBuckets: [],
  commentQualityBuckets: [],
  dateFrom: '',
  dateTo: '',
}

const CQ_LABELS: Record<string, string> = {
  '0-2': 'Bad',
  '3-4': 'Average',
  '5-6': 'Good',
  '7-8': 'Very good',
  '9-10': 'Excellent',
}

export function commentQualityLabel(key: string) {
  return CQ_LABELS[key] || key
}

export function leadFilterChoices(results: Array<Record<string, unknown>>) {
  const rows = mapLeadRows(results)
  const unique = (values: string[]) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b))
  const labels: string[] = []
  for (const row of rows) labels.push(...row.errorLabels)
  return {
    telecallers: unique(rows.map((row) => row.telecaller)),
    projects: unique(rows.map((row) => row.project || '(No project)')),
    severities: ['Critical', 'Medium'],
    errorTypes: unique(labels),
    overdueBuckets: [...OVERDUE_BUCKETS],
    commentQualityBuckets: Object.entries(CQ_LABELS).map(([value, label]) => ({ value, label })),
  }
}

function listed(values: string[]) {
  return values.map((value) => value.trim()).filter((value) => value && !/^all$/i.test(value))
}

/** Same inclusion rules as dashboard-metrics.js applyFilters. Empty lists mean all. */
export function applyLeadFilters(results: Array<Record<string, unknown>>, filters: LeadFilters) {
  const rows = mapLeadRows(results)
  const telecallers = listed(filters.telecallers)
  const projects = listed(filters.projects)
  const severities = listed(filters.severities)
  const errorTypes = listed(filters.errorTypes)
  const overdueBuckets = listed(filters.overdueBuckets)
  const commentQualityBuckets = listed(filters.commentQualityBuckets)
  const dateFrom = parseLooseDate(filters.dateFrom)
  const dateTo = parseLooseDate(filters.dateTo)
  return results.filter((_, index) => {
    const row = rows[index]
    if (telecallers.length && !telecallers.includes(row.telecaller)) return false
    if (projects.length && !projects.includes(row.project || '(No project)')) return false
    if (severities.length && !severities.includes(row.severity)) return false
    if (errorTypes.length && !errorTypes.some((label) => row.errorLabels.includes(label) || row.errorType === label)) return false
    if (overdueBuckets.length) {
      const bucket = overdueBucket(row.overdueDays)
      if (!bucket || !overdueBuckets.includes(bucket)) return false
    }
    if (commentQualityBuckets.length) {
      const bucket = commentQualityKey(row.commentQuality)
      if (!bucket || !commentQualityBuckets.includes(bucket)) return false
    }
    if (dateFrom || dateTo) {
      if (!row.registration) return false
      if (dateFrom && row.registration < dateFrom) return false
      if (dateTo && row.registration > dateTo) return false
    }
    return true
  })
}

export function summarizeLeads(results: Array<Record<string, unknown>>) {
  const rows = mapLeadRows(results)
  const total = rows.length
  const errors = rows.reduce((sum, row) => sum + row.errorFlag, 0)
  const critical = rows.filter((row) => row.severity === 'Critical').length
  const medium = rows.filter((row) => row.severity === 'Medium').length
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
      const correct = Math.max(0, bucket.leads - bucket.errors)
      return { ...bucket, correct, accuracy: acc, accuracyPct: acc * 100, rating: accuracyRating(acc) }
    })
    .sort((a, b) => b.accuracy - a.accuracy || a.name.localeCompare(b.name))
  const withLeads = scorecard.filter((row) => row.leads > 0)
  const bestTelecaller = withLeads[0]?.name || 'N/A'
  const lowestTelecaller = withLeads.length
    ? withLeads.reduce((worst, row) => (row.accuracy < worst.accuracy ? row : worst)).name
    : 'N/A'
  return { rows, total, errors, critical, medium, clean, notCritical, accuracy, scorecard, bestTelecaller, lowestTelecaller }
}

const OVERDUE_BUCKETS = ['1-5', '5-20', '20-50', '50-100', '100+'] as const
const CQ_BUCKETS = [
  { key: '0-2', label: 'Bad', color: 'var(--red)' },
  { key: '3-4', label: 'Average', color: 'var(--amber)' },
  { key: '5-6', label: 'Good', color: '#c9a227' },
  { key: '7-8', label: 'Very good', color: '#3f8c68' },
  { key: '9-10', label: 'Excellent', color: 'var(--chart-bar)' },
] as const

export function overdueBucket(days: number | null) {
  if (days == null || !Number.isFinite(days) || days < 1) return null
  if (days <= 5) return '1-5'
  if (days <= 20) return '5-20'
  if (days <= 50) return '20-50'
  if (days <= 100) return '50-100'
  return '100+'
}

export function commentQualityKey(score: number | null) {
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
