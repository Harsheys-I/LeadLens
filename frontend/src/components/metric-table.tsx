export type MetricColumn = { key: string; label: string; className?: string }

export function MetricTable({
  title,
  note,
  columns,
  rows,
}: {
  title?: string
  note?: string
  columns: MetricColumn[]
  rows: Array<Record<string, string | number>>
}) {
  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--panel)]">
      {title ? (
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4">
          <h3 className="text-sm font-semibold text-[var(--ink)]">{title}</h3>
          {note ? <p className="text-xs text-[var(--muted)]">{note}</p> : null}
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left text-sm text-[var(--ink)]">
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className="whitespace-nowrap border-b border-[var(--line)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]"
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((row, index) => (
              <tr key={`${String(row[columns[0]?.key] ?? index)}-${index}`} className="border-b border-[var(--line)] last:border-0">
                {columns.map((column) => (
                  <td key={column.key} className={`max-w-[16rem] truncate px-3 py-2 ${column.className || ''}`} title={String(row[column.key] ?? '')}>
                    {row[column.key] ?? ''}
                  </td>
                ))}
              </tr>
            )) : (
              <tr>
                <td className="px-3 py-4 text-[var(--muted)]" colSpan={columns.length}>No rows for the current filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
