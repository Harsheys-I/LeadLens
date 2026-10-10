import { useEffect, useState } from 'react'
import { Database, LineChart, Timer } from 'lucide-react'
import { ActivityRings } from '@/components/ui/activity-rings.tsx'
import SlideTextButton from '@/components/ui/slide-text-button.tsx'
import SpotlightCards from '@/components/ui/spotlight-cards.tsx'
import { api, ErpSyncApi } from '@/lib/api.ts'
import { activityRing, RING } from '@/lib/rings.ts'

type JobMeta = {
  status?: string
  audited?: number
  total?: number
  lead_count?: number
  result_count?: number
  elapsed_seconds?: number
  source_file?: string
  error?: string
  started_at?: string
}

type UploadRow = {
  kind?: string
  status?: string
  audited?: number
  lead_count?: number
  row_count?: number
  source_file?: string
  uploaded_by?: string
  started_at?: string
  published_at?: string
  elapsed_seconds?: number
  estimated_cost?: number | string
  error?: string
  batch_size?: number
  concurrency?: number
  usage?: { input?: number; cached?: number; output?: number }
}

type RunStamp = { label?: string; at_ist?: string }
type GhaLatest = { conclusion?: string; status?: string; updated_at?: string; created_at?: string; run_number?: number; id?: number; url?: string }

type ErpStatus = {
  job?: JobMeta | null
  progress?: {
    running?: boolean
    audited?: number
    total?: number
    elapsed_seconds?: number
    status?: string
    estimated_cost?: number
    usage?: { input?: number; cached?: number; output?: number }
    throttle?: { concurrency?: number; target_concurrency?: number; batch_size?: number; rate_limited?: number; paused_until?: string; retry_queue?: number; errored_leads?: number; slowed?: boolean }
  }
  gha?: {
    configured?: boolean
    error?: string
    latest?: GhaLatest | null
    active?: boolean
    last_dispatch?: DispatchMeta
    next_runs?: Record<string, RunStamp>
  }
  next_runs?: Record<string, RunStamp>
  last_dispatch?: DispatchMeta
  api_uploads?: UploadRow[]
}

type DispatchMeta = { jobs?: string[]; dispatched_at?: string; dry_run?: boolean }

function formatIst(iso?: string) {
  if (!iso) return '—'
  const d = new Date(String(iso))
  if (Number.isNaN(d.getTime())) return String(iso)
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const get = (type: string) => parts.find((p) => p.type === type)?.value || ''
  return `${get('day')} ${get('month').replace(/\./g, '')} ${get('year')}, ${get('hour')}:${get('minute')}:${get('second')} IST`
}

function formatElapsed(sec?: number) {
  const s = Math.max(0, Math.floor(Number(sec) || 0))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

function ghaLine(gha?: ErpStatus['gha']) {
  if (!gha?.configured) return 'GitHub PAT not configured — set github.token in api/config.local.php (Actions: write + Contents: read).'
  if (gha.error) return `GHA status error: ${gha.error}`
  const latest = gha.latest
  if (!latest) return 'No workflow runs yet.'
  const when = formatIst(latest.updated_at || latest.created_at)
  const conc = latest.conclusion || latest.status || '—'
  const link = latest.url ? ` · ${latest.url}` : ''
  return `Latest run #${latest.run_number || latest.id}: ${conc} · ${when}${link}`
}

function pickUpload(rows: UploadRow[] | undefined, kinds: string[]) {
  const want = new Set(kinds)
  return (rows || []).find((row) => want.has(String(row.kind || 'bucket1'))) || null
}

function pipelineStatus(status: ErpStatus | null, kind: 'bucket1' | 'perf' | 'sales') {
  if (!status) return 'Loading…'
  if (kind === 'bucket1') {
    const prog = status.progress || {}
    const job = status.job || {}
    const upload = pickUpload(status.api_uploads, ['bucket1'])
    if (prog.running || prog.status === 'auditing' || job.status === 'auditing') {
      const done = Number(prog.audited ?? job.audited ?? 0).toLocaleString()
      const all = Number(prog.total ?? job.total ?? 0)
      return `Last run · auditing ${done}/${all ? all.toLocaleString() : '…'}`
    }
    const raw = String(upload?.status || job.status || '').toLowerCase()
    const gha = String(status.gha?.latest?.conclusion || status.gha?.latest?.status || '').toLowerCase()
    if (raw.includes('fail') || gha === 'failure' || upload?.error || job.error) {
      return `Failed${upload?.error || job.error ? ` · ${upload?.error || job.error}` : ''}`
    }
    if (raw.includes('publish') || upload?.published_at) {
      return `Published · ${formatIst(upload?.published_at || upload?.started_at)}`
    }
    if (raw || gha) {
      const label = upload?.status || job.status || status.gha?.latest?.conclusion || status.gha?.latest?.status
      return `Last run · ${label}`
    }
    return 'Idle'
  }
  const upload = pickUpload(status.api_uploads, kind === 'perf' ? ['performance'] : ['sales', 'sales_graph'])
  if (!upload) return 'Idle'
  const raw = String(upload.status || '').toLowerCase()
  if (raw.includes('fail') || upload.error) return `Failed${upload.error ? ` · ${upload.error}` : ''}`
  if (raw.includes('publish') || upload.published_at) {
    return `Published · ${formatIst(upload.published_at || upload.started_at)}`
  }
  if (raw) return `Last run · ${upload.status}`
  return 'Idle'
}

function linesFor(status: ErpStatus, kind: 'bucket1' | 'perf' | 'sales') {
  const gha = status.gha || {}
  const next = status.next_runs?.[kind] || gha.next_runs?.[kind]
  const lines = [`Next scheduled: ${next?.label || next?.at_ist || '—'}`]
  if (kind === 'bucket1') {
    const prog = status.progress || {}
    const job = status.job || {}
    const upload = pickUpload(status.api_uploads, ['bucket1'])
    lines.push('Audit defaults: batch 20 · parallel 4')
    if (gha.latest) lines.push(`GHA: ${gha.latest.conclusion || gha.latest.status} · ${formatIst(gha.latest.updated_at || gha.latest.created_at)}`)
    const uploadHasRun = upload && (upload.usage || upload.estimated_cost != null || upload.elapsed_seconds != null || upload.audited != null)
    if (uploadHasRun && !(prog.running && Number(prog.audited || 0) > 0 && !upload.usage)) {
      lines.push(`Upload log: ${upload.status || '—'} · ${Number(upload.audited ?? 0).toLocaleString()}/${upload.lead_count ? Number(upload.lead_count).toLocaleString() : '…'} · ${upload.source_file || ''}`)
      if (upload.error) lines.push(`Error: ${upload.error}`)
    } else if (prog.running || prog.status === 'auditing') {
      lines.push(`Audit: ${Number(prog.audited ?? job.audited ?? 0).toLocaleString()}/${Number(prog.total ?? job.total ?? 0) ? Number(prog.total ?? job.total ?? 0).toLocaleString() : '…'} (${prog.status})`)
      lines.push(`Elapsed: ${formatElapsed(prog.elapsed_seconds)}`)
    } else if (job.status) {
      lines.push(`Last job: ${job.status}${job.source_file ? ` · ${job.source_file}` : ''}`)
      if (job.error) lines.push(`Error: ${job.error}`)
    } else {
      lines.push('No Lead Audit run yet.')
    }
  } else if (kind === 'perf') {
    const upload = pickUpload(status.api_uploads, ['performance'])
    if (upload) {
      lines.push(`Last: ${upload.status} · ${formatIst(upload.published_at || upload.started_at)}`)
      lines.push(`${upload.lead_count || 0} TeleCallers · ${upload.source_file || ''}`)
      if (upload.error) lines.push(`Error: ${upload.error}`)
    } else lines.push('No Performance upload yet.')
  } else {
    lines.push('Note: Sales Graph cURLs are placeholders until configured in automation.')
    const upload = pickUpload(status.api_uploads, ['sales', 'sales_graph'])
    if (upload) {
      lines.push(`Last: ${upload.status} · ${formatIst(upload.published_at || upload.started_at)}`)
      lines.push(`${upload.source_file || ''}`)
      if (upload.error) lines.push(`Error: ${upload.error}`)
    } else lines.push('No Sales Graph upload yet.')
  }
  return lines
}

export default function ErpPage() {
  const [bucket1, setBucket1] = useState(true)
  const [perf, setPerf] = useState(true)
  const [sales, setSales] = useState(true)
  const [dry, setDry] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [messageError, setMessageError] = useState(false)
  const [status, setStatus] = useState<ErpStatus | null>(null)

  async function refresh() {
    const data = (await ErpSyncApi.status()) as ErpStatus
    setStatus(data)
  }

  useEffect(() => {
    let stop = false
    const pull = () => { refresh().catch((err: unknown) => {
      if (stop) return
      setMessageError(true)
      setMessage(err instanceof Error ? err.message : 'Could not load ERP Sync status')
    }) }
    pull()
    const timer = window.setInterval(() => { if (!stop) pull() }, 4000)
    return () => { stop = true; window.clearInterval(timer) }
  }, [])

  const job = status?.job || null
  const progress = status?.progress || {}
  const running = Boolean(progress.running) || progress.status === 'auditing' || job?.status === 'auditing'
  const audited = Number(progress.audited ?? job?.audited ?? job?.result_count ?? 0)
  const total = Number(progress.total ?? job?.total ?? job?.lead_count ?? 0)
  const dispatch = status?.last_dispatch || status?.gha?.last_dispatch

  function note(text: string, isError = false) {
    setMessage(text)
    setMessageError(isError)
  }

  async function dispatchSync() {
    const jobs = [bucket1 ? 'bucket1' : '', perf ? 'perf' : '', sales ? 'sales' : ''].filter(Boolean)
    if (!jobs.length) {
      note('Select at least one pipeline.', true)
      return
    }
    setBusy(true)
    note('Dispatching GitHub Actions…')
    try {
      const data = await ErpSyncApi.trigger({ jobs, dry_run: dry })
      const text = String(data.message || `Dispatched: ${jobs.join(', ')}`)
      const failed = data.ok === false || Boolean(data.error)
      note(failed ? String(data.error || text) : text, failed)
      await refresh()
    } catch (err: unknown) {
      note(err instanceof Error ? err.message : 'Dispatch failed', true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <SpotlightCards
        eyebrow="Pipelines"
        heading="Dispatch"
        items={[
          {
            icon: Database,
            title: 'Bucket 1',
            description: 'Lead audit workbook through GitHub Actions.',
            color: '#FF2D55',
            selected: bucket1,
            status: pipelineStatus(status, 'bucket1'),
            onClick: () => setBucket1((on) => !on),
          },
          {
            icon: Timer,
            title: 'Performance',
            description: 'Telecalling performance publish.',
            color: '#A3F900',
            selected: perf,
            status: pipelineStatus(status, 'perf'),
            onClick: () => setPerf((on) => !on),
          },
          {
            icon: LineChart,
            title: 'Sales Graph',
            description: 'Leads, visits, and booked.',
            color: '#04C7DD',
            selected: sales,
            status: pipelineStatus(status, 'sales'),
            onClick: () => setSales((on) => !on),
          },
        ]}
      />
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={bucket1} onChange={(e) => setBucket1(e.target.checked)} /> Bucket 1</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={perf} onChange={(e) => setPerf(e.target.checked)} /> Performance</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={sales} onChange={(e) => setSales(e.target.checked)} /> Sales Graph</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={dry} onChange={(e) => setDry(e.target.checked)} /> Dry run</label>
      </div>
      {running ? (
        <ActivityRings
          title={job?.source_file || 'ERP run'}
          data={[
            activityRing('Progress', audited, total || 1, RING.rose, 168, '%'),
            activityRing('Leads', total, Math.max(total, 1), RING.lime, 124, 'leads'),
            activityRing('Audited', audited, Math.max(total, audited, 1), RING.cyan, 80, 'calls'),
          ]}
        />
      ) : null}
      <div className="flex flex-wrap gap-2">
        <SlideTextButton
          type="button"
          text={busy ? 'Dispatching…' : 'Dispatch sync'}
          hoverText="Run now"
          disabled={busy}
          onClick={() => { void dispatchSync() }}
        />
        <SlideTextButton
          type="button"
          variant="ghost"
          text="Cancel"
          hoverText="Stop audit"
          onClick={() => {
            note('Stopping…')
            api('audit/cancel', { method: 'POST', body: {} })
              .then((data) => note(String(data.message || 'Audit stopped'), data.ok === false))
              .catch((err: unknown) => note(err instanceof Error ? err.message : 'Could not stop', true))
          }}
        />
      </div>
      {message ? (
        <p className={messageError ? 'text-sm font-medium text-red-400' : 'text-sm text-[var(--ink)]'} role="status">
          {message}
        </p>
      ) : null}
      <section className="space-y-3 rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5 text-sm text-[var(--ink)]">
        <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">Job status</h2>
        <p className="whitespace-pre-wrap">{status ? ghaLine(status.gha) : 'Loading GitHub Actions status…'}</p>
        {dispatch?.dispatched_at ? (
          <p>Last dispatch: {(dispatch.jobs || []).join(', ') || '—'} · {formatIst(dispatch.dispatched_at)}{dispatch.dry_run ? ' · dry run' : ''}</p>
        ) : null}
        {job?.status ? <p>Job {job.status}{job.source_file ? ` · ${job.source_file}` : ''}</p> : <p className="text-[var(--muted)]">No job yet.</p>}
      </section>
      <div className="grid gap-3 md:grid-cols-3">
        {([
          ['Bucket 1', 'bucket1'],
          ['Performance', 'perf'],
          ['Sales Graph', 'sales'],
        ] as const).map(([title, kind]) => (
          <section key={kind} className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5 text-sm">
            <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">{title}</h2>
            <p className="mt-3 whitespace-pre-wrap text-[var(--ink)]">{status ? linesFor(status, kind).join('\n') : 'Loading…'}</p>
          </section>
        ))}
      </div>
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5 text-sm">
        <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">Upload log</h2>
        <div className="mt-3 space-y-2 text-[var(--ink)]">
          {(status?.api_uploads || []).length ? (status?.api_uploads || []).map((row, index) => (
            <p key={`${row.started_at || index}-${row.kind || ''}`}>
              {formatIst(row.started_at)} · {row.kind || 'bucket1'} · {row.source_file || 'file'} · {row.status || 'unknown'}
              {row.error ? ` — ${row.error}` : ''}
            </p>
          )) : <p className="text-[var(--muted)]">No API uploads yet.</p>}
        </div>
      </section>
    </div>
  )
}
