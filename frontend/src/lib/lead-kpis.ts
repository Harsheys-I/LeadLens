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
}

export function mapLeadRows(results: Array<Record<string, unknown>>): LeadRow[] {
  return results.map((row) => {
    const labels = splitErrorLabels(row.errorTypes)
    const errorFlag = labels.length ? 1 : 0
    return {
      telecaller: clean(row.telecaller) || 'Unknown',
      project: clean(row.project),
      errorLabels: labels,
      severity: mapSeverity(row.errorSeverity, labels),
      errorFlag,
      errorDetails: clean(row.observation),
      status: clean(row.status),
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
  const byTele = new Map<string, { name: string; leads: number; errors: number; critical: number }>()
  for (const row of rows) {
    const bucket = byTele.get(row.telecaller) || { name: row.telecaller, leads: 0, errors: 0, critical: 0 }
    bucket.leads += 1
    bucket.errors += row.errorFlag
    if (row.severity === 'Critical') bucket.critical += 1
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
