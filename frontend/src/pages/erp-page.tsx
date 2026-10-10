import { useEffect, useState } from 'react'
import { Database, LineChart, Timer } from 'lucide-react'
import { ActivityRings } from '@/components/ui/activity-rings.tsx'
import Loader from '@/components/ui/loader.tsx'
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
}

export default function ErpPage() {
  return <Ops />
}

function Ops() {
  const [bucket1, setBucket1] = useState(true)
  const [perf, setPerf] = useState(true)
  const [sales, setSales] = useState(true)
  const [dry, setDry] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [job, setJob] = useState<JobMeta | null>(null)
  const [running, setRunning] = useState(false)

  async function refresh() {
    const data = await ErpSyncApi.status()
    const next = (data.job || null) as JobMeta | null
    const progress = (data.progress || {}) as { running?: boolean; audited?: number; total?: number; elapsed_seconds?: number; status?: string }
    setJob(next ? { ...next, audited: progress.audited ?? next.audited ?? next.result_count, total: progress.total ?? next.total ?? next.lead_count, elapsed_seconds: progress.elapsed_seconds ?? next.elapsed_seconds } : null)
    setRunning(Boolean(progress.running) || progress.status === 'auditing' || next?.status === 'auditing')
  }

  useEffect(() => {
    let stop = false
    const pull = () => { refresh().catch(() => {}) }
    pull()
    const timer = window.setInterval(() => { if (!stop) pull() }, 4000)
    return () => { stop = true; window.clearInterval(timer) }
  }, [])

  const audited = Number(job?.audited || 0)
  const total = Number(job?.total || 0)

  return (
    <div className="space-y-6">
      <SpotlightCards
        eyebrow="Pipelines"
        heading="Dispatch"
        items={[
          { icon: Database, title: 'Bucket 1', description: 'Lead audit workbook through GitHub Actions.', color: '#FF2D55' },
          { icon: Timer, title: 'Performance', description: 'Telecalling performance publish.', color: '#A3F900' },
          { icon: LineChart, title: 'Sales Graph', description: 'Leads, visits, and booked.', color: '#04C7DD' },
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
      {busy ? <p className="text-sm text-zinc-500">Dispatching the sync.</p> : null}
      <div className="flex flex-wrap gap-2">
        <SlideTextButton
          type="button"
          text="Dispatch sync"
          hoverText="Run now"
          disabled={busy}
          onClick={() => {
            const jobs = [bucket1 ? 'bucket1' : '', perf ? 'perf' : '', sales ? 'sales' : ''].filter(Boolean)
            if (!jobs.length) { setMessage('Select at least one pipeline.'); return }
            setBusy(true)
            setMessage('Dispatching GitHub Actions…')
            ErpSyncApi.trigger({ jobs, dry_run: dry })
              .then(async (data) => {
                setMessage(String(data.message || `Dispatched: ${jobs.join(', ')}`))
                await refresh()
              })
              .catch((err: unknown) => setMessage(err instanceof Error ? err.message : 'Dispatch failed'))
              .finally(() => setBusy(false))
          }}
        />
        <SlideTextButton
          type="button"
          variant="ghost"
          text="Cancel"
          hoverText="Stop audit"
          onClick={() => {
            setMessage('Stopping…')
            api('audit/cancel', { method: 'POST', body: {} })
              .then((data) => setMessage(String(data.message || 'Audit stopped')))
              .catch((err: unknown) => setMessage(err instanceof Error ? err.message : 'Could not stop'))
          }}
        />
      </div>
      {message ? <p className="text-sm">{message}</p> : null}
      {job?.status ? <p className="text-xs text-zinc-500">Job {job.status}</p> : null}
    </div>
  )
}
