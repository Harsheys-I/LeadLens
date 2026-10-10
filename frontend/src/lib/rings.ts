import type { ActivityData } from '@/components/ui/activity-rings.tsx'

export const RING = {
  rose: '#FF2D55',
  lime: '#A3F900',
  cyan: '#04C7DD',
} as const

export function activityRing(
  label: string,
  current: number,
  target: number,
  color: string,
  size: number,
  unit: string,
): ActivityData {
  const safeTarget = target > 0 ? target : 0
  const value = safeTarget > 0 ? Math.max(0, Math.min(100, Math.round((current / safeTarget) * 100))) : 0
  return {
    label,
    value,
    color,
    size,
    current: Math.round(current),
    target: Math.round(safeTarget),
    unit,
  }
}
