import { useEffect, useState, type ReactNode } from 'react'
import SmoothDrawer from '@/components/ui/smooth-drawer.tsx'

export type FilterField = {
  key: string
  label: string
  options: Array<{ value: string; label: string }>
}

export function FiltersButton({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <div className="sticky top-2 z-30 flex justify-end">
      <button
        type="button"
        className="rounded-full border border-[var(--line)] bg-[var(--panel)] px-4 py-2 text-sm font-semibold text-[var(--ink)] shadow-sm"
        onClick={onClick}
      >
        Filters{active ? ' · on' : ''}
      </button>
    </div>
  )
}

export function FilterDrawer({
  open,
  title = 'Filters',
  description = 'None selected means all. Apply to update the screen.',
  fields,
  values,
  dates,
  extra,
  onClose,
  onApply,
}: {
  open: boolean
  title?: string
  description?: string
  fields: FilterField[]
  values: Record<string, string[]>
  dates?: { from: string; to: string; fromLabel?: string; toLabel?: string }
  extra?: ReactNode
  onClose: () => void
  onApply: (next: Record<string, string[]>, dates?: { from: string; to: string }) => void
}) {
  const [draft, setDraft] = useState(values)
  const [from, setFrom] = useState(dates?.from || '')
  const [to, setTo] = useState(dates?.to || '')

  useEffect(() => {
    if (!open) return
    setDraft(values)
    setFrom(dates?.from || '')
    setTo(dates?.to || '')
  }, [open, values, dates?.from, dates?.to])

  function toggle(key: string, value: string) {
    setDraft((current) => {
      const selected = current[key] || []
      const next = selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]
      return { ...current, [key]: next }
    })
  }

  return (
    <SmoothDrawer open={open} onClose={onClose} title={title} description={description}>
      <div className="max-h-[52vh] space-y-4 overflow-y-auto pr-1">
        {extra}
        {fields.map((field) => (
          <fieldset key={field.key} className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <legend className="text-sm font-semibold">{field.label}</legend>
              <span className="flex gap-2 text-xs">
                <button type="button" className="underline" onClick={() => setDraft((current) => ({ ...current, [field.key]: field.options.map((option) => option.value) }))}>Select All</button>
                <button type="button" className="underline" onClick={() => setDraft((current) => ({ ...current, [field.key]: [] }))}>Select None</button>
              </span>
            </div>
            <div className="max-h-36 space-y-1 overflow-y-auto rounded-xl border border-zinc-200 p-2 dark:border-zinc-700">
              {field.options.length ? field.options.map((option) => (
                <label key={option.value} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={(draft[field.key] || []).includes(option.value)}
                    onChange={() => toggle(field.key, option.value)}
                  />
                  <span>{option.label}</span>
                </label>
              )) : <p className="text-sm text-zinc-500">No values</p>}
            </div>
          </fieldset>
        ))}
        {dates ? (
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-semibold">{dates.fromLabel || 'Reg. from'}</span>
              <input type="date" className="rounded-xl border border-zinc-200 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-950" value={from} onChange={(event) => setFrom(event.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-semibold">{dates.toLabel || 'Reg. to'}</span>
              <input type="date" className="rounded-xl border border-zinc-200 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-950" value={to} onChange={(event) => setTo(event.target.value)} />
            </label>
          </div>
        ) : null}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          className="h-11 flex-1 rounded-xl bg-zinc-900 text-sm font-semibold text-white dark:bg-white dark:text-zinc-900"
          onClick={() => {
            onApply(draft, dates ? { from, to } : undefined)
            onClose()
          }}
        >
          Apply
        </button>
        <button type="button" className="h-11 flex-1 rounded-xl border border-zinc-200 text-sm dark:border-zinc-700" onClick={onClose}>
          Close
        </button>
      </div>
    </SmoothDrawer>
  )
}
