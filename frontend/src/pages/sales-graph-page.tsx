import { useEffect, useState } from 'react'
import { ActivityRings } from '@/components/ui/activity-rings.tsx'
import Loader from '@/components/ui/loader.tsx'
import MouseEffectCard from '@/components/ui/mouse-effect-card.tsx'
import { SalesCharts } from '@/components/charts/sales-charts.tsx'
import { SalesGraphApi } from '@/lib/api.ts'
import { activityRing, RING } from '@/lib/rings.ts'

type MonthMap = Record<string, number>
type Sheet = { byMonth?: MonthMap; totals?: { grand?: number }; leadDeclaration?: { total?: number; byMonth?: MonthMap } }

function grand(sheet: Sheet | undefined, preferDeclaration = false) {
  if (!sheet) return 0
  if (preferDeclaration && sheet.leadDeclaration?.total) return Number(sheet.leadDeclaration.total) || 0
  if (sheet.totals?.grand) return Number(sheet.totals.grand) || 0
  const map = preferDeclaration ? sheet.leadDeclaration?.byMonth || sheet.byMonth : sheet.byMonth
  return Object.values(map || {}).reduce((sum, value) => sum + (Number(value) || 0), 0)
}

function monthsOf(payload: { leads?: Sheet; visits?: Sheet; booked?: Sheet }) {
  const keys = new Set<string>()
  for (const sheet of [payload.leads, payload.visits, payload.booked]) {
    Object.keys(sheet?.byMonth || {}).forEach((key) => keys.add(key))
    Object.keys(sheet?.leadDeclaration?.byMonth || {}).forEach((key) => keys.add(key))
  }
  return [...keys].sort()
}

function series(map: MonthMap | undefined, months: string[]) {
  return months.map((month) => Number(map?.[month] || 0))
}

export default function SalesGraphPage() {
  return <Dashboard />
}

function Dashboard() {
  const [state, setState] = useState<'load' | 'empty' | 'ready'>('load')
  const [payload, setPayload] = useState<{ leads?: Sheet; visits?: Sheet; booked?: Sheet; title?: string } | null>(null)

  useEffect(() => {
    SalesGraphApi.latest()
      .then((data) => {
        const next = (data.payload || data.graph || data) as { leads?: Sheet; visits?: Sheet; booked?: Sheet }
        const leads = grand(next.leads)
        const visits = grand(next.visits)
        const booked = grand(next.booked, true)
        if (!leads && !visits && !booked) {
          setState('empty')
          return
        }
        setPayload(next)
        setState('ready')
      })
      .catch(() => setState('empty'))
  }, [])

  if (state === 'load') return <Loader size="md" title="Opening Sales Graph" subtitle="Loading your data" />
  if (state === 'empty' || !payload) {
    return (
      <MouseEffectCard
        topText="Sales Graph"
        topSubtext="ERP"
        title="No published graph"
        subtitle="ERP Sync publishes Leads, Visits, and Booked."
        primaryCtaText="Refresh"
        onPrimaryCtaClick={() => location.reload()}
        footerText="Rings use the largest of the three counts as the target."
      />
    )
  }
  const leads = grand(payload.leads)
  const visits = grand(payload.visits)
  const booked = grand(payload.booked, true)
  const largest = Math.max(leads, visits, booked, 1)
  return (
    <div className="space-y-6">
      <ActivityRings
        title="Leads, visits, booked"
        data={[
          activityRing('Leads', leads, largest, RING.cyan, 168, ''),
          activityRing('Visits', visits, largest, RING.lime, 124, ''),
          activityRing('Booked', booked, largest, RING.rose, 80, ''),
        ]}
      />
      <SalesCharts payload={payload} />
    </div>
  )
}
