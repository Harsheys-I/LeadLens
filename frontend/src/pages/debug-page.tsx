import { useEffect, useMemo, useState } from 'react'
import SlideTextButton from '@/components/ui/slide-text-button.tsx'
import Loader from '@/components/ui/loader.tsx'
import { SettingsApi } from '@/lib/api.ts'
import { apiBase } from '@/lib/app-base.ts'
import { composeDebugPrompt, normalizeActiveErrorTypes } from '@/lib/debug-prompt.ts'
import { LAB_ERROR_TYPES } from '@/lib/debug-prompts.ts'
import { useView } from '@/lib/use-view.ts'

type ResultRow = { id: string; q: string; e: string; o: string; r: string }

const inputClass = 'w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100'

export default function DebugPage() {
  const { view, select } = useView(['run', 'settings'], 'run')
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    SettingsApi.getDebug()
      .then((data) => {
        const next = data.settings && typeof data.settings === 'object' ? data.settings as Record<string, unknown> : {}
        setSettings(next)
      })
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : 'Could not load debug settings'))
  }, [])

  if (!settings && !loadError) return <Loader size="md" title="Opening Debug" subtitle="Loading your data" />

  return (
    <div className="space-y-4">
      <div className="flex w-full gap-1 rounded-xl border border-zinc-200 bg-white p-1 dark:border-zinc-700 dark:bg-zinc-950" role="tablist">
        {(['run', 'settings'] as const).map((id) => {
          const on = view === id
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={on}
              className={on
                ? 'flex-1 rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-white dark:text-[#17211d]'
                : 'flex-1 rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'}
              onClick={() => select(id)}
            >
              {id === 'run' ? 'Run' : 'Settings'}
            </button>
          )
        })}
      </div>
      {loadError ? <p className="text-sm text-red-700 dark:text-red-300">{loadError}</p> : null}
      {view === 'run'
        ? <RunView settings={settings || {}} />
        : <SettingsView settings={settings || {}} onSaved={setSettings} />}
    </div>
  )
}

function RunView({ settings }: { settings: Record<string, unknown> }) {
  const prompt = useMemo(() => composeDebugPrompt(settings), [settings])
  const [csvName, setCsvName] = useState('')
  const [rows, setRows] = useState<Array<Record<string, string>>>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [results, setResults] = useState<ResultRow[]>([])

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Saved prompt</h2>
        <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-xl border border-zinc-200 bg-white p-3 text-xs leading-relaxed text-zinc-800 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200">{prompt}</pre>
      </section>
      <label className="block text-sm text-zinc-800 dark:text-zinc-200">
        Call CSV
        <input
          type="file"
          accept=".csv,text/csv"
          className="mt-1 block w-full text-sm text-zinc-800 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-900 file:px-3 file:py-1.5 file:text-sm file:text-white dark:text-zinc-200 dark:file:bg-white dark:file:text-[#17211d]"
          onChange={async (event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (!file) return
            const text = await file.text()
            const parsed = parseCsv(text)
            setCsvName(file.name)
            setRows(parsed)
            setResults([])
            setMessage(parsed.length ? `${file.name} · ${parsed.length} row(s)` : 'No data rows in that CSV.')
          }}
        />
      </label>
      <SlideTextButton
        type="button"
        text="Run prompt"
        hoverText={busy ? 'Running' : 'Send batch'}
        disabled={busy || !rows.length}
        onClick={() => {
          void (async () => {
            setBusy(true)
            setMessage(`Running ${csvName || 'CSV'}…`)
            try {
              const next = await runDebugBatch(settings, rows)
              setResults(next)
              setMessage(`${next.length} result(s)`)
            } catch (err) {
              setMessage(err instanceof Error ? err.message : 'Run failed')
            } finally {
              setBusy(false)
            }
          })()
        }}
      />
      {message ? <p className="text-sm text-zinc-700 dark:text-zinc-300">{message}</p> : null}
      {results.length ? (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-700">
          <table className="w-full min-w-[40rem] text-left text-sm text-zinc-900 dark:text-zinc-100">
            <thead className="bg-zinc-50 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
              <tr>
                {['id', 'q', 'e', 'o', 'r'].map((col) => <th key={col} className="px-3 py-2 font-medium">{col}</th>)}
              </tr>
            </thead>
            <tbody>
              {results.map((row) => (
                <tr key={row.id} className="border-t border-zinc-200 align-top dark:border-zinc-800">
                  <td className="px-3 py-2">{row.id}</td>
                  <td className="px-3 py-2">{row.q}</td>
                  <td className="px-3 py-2">{row.e}</td>
                  <td className="px-3 py-2">{row.o}</td>
                  <td className="px-3 py-2">{row.r}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}

function SettingsView({ settings, onSaved }: { settings: Record<string, unknown>; onSaved: (next: Record<string, unknown>) => void }) {
  const incoming = settings.errorPrompts && typeof settings.errorPrompts === 'object'
    ? settings.errorPrompts as Record<string, string>
    : {}
  const [prompts, setPrompts] = useState<Record<string, string>>(() => {
    const next: Record<string, string> = {}
    for (const label of LAB_ERROR_TYPES) next[label] = String(incoming[label] ?? '')
    return next
  })
  const [active, setActive] = useState<string[]>(() => normalizeActiveErrorTypes(settings.activeErrorTypes))
  const [focus, setFocus] = useState(() => String(settings.focusErrorType || active[0] || LAB_ERROR_TYPES[0]))
  const [keyLine, setKeyLine] = useState('Checking key…')
  const [apiKey, setApiKey] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    SettingsApi.openaiKeyStatus()
      .then((key) => {
        const on = key.configured === true || key.configured === 1 || key.configured === 'true'
        setKeyLine(on ? `Key on${key.masked ? ` · ${key.masked}` : ''}` : 'No key')
      })
      .catch(() => setKeyLine('No key'))
  }, [])

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-700 dark:text-zinc-300">Provider key · {keyLine}</p>
      <form
        className="grid max-w-lg gap-2"
        onSubmit={async (event) => {
          event.preventDefault()
          setMessage('Saving key…')
          try {
            await SettingsApi.saveOpenaiKey(apiKey.trim())
            setApiKey('')
            setKeyLine('Key on')
            setMessage('Server key saved.')
          } catch (err) {
            setMessage(err instanceof Error ? err.message : 'Could not save the key')
          }
        }}
      >
        <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} type="password" placeholder="OpenAI API key" className={inputClass} />
        <div className="flex gap-2">
          <SlideTextButton type="submit" text="Save" hoverText="Store key" />
          <SlideTextButton
            type="button"
            variant="ghost"
            text="Cancel"
            hoverText="Clear key"
            onClick={() => {
              void SettingsApi.clearOpenaiKey()
                .then(() => { setKeyLine('No key'); setMessage('Server key cleared.') })
                .catch((err: unknown) => setMessage(err instanceof Error ? err.message : 'Could not clear'))
            }}
          />
        </div>
      </form>
      <form
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault()
          const next = {
            ...settings,
            errorPrompts: prompts,
            activeErrorTypes: active.length ? active : [LAB_ERROR_TYPES[0]],
            focusErrorType: active.includes(focus) ? focus : (active[0] || LAB_ERROR_TYPES[0]),
          }
          setMessage('Saving prompts…')
          try {
            await SettingsApi.saveDebug(next)
            onSaved(next)
            setMessage('Debug prompts saved.')
          } catch (err) {
            setMessage(err instanceof Error ? err.message : 'Could not save prompts')
          }
        }}
      >
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Active errors</legend>
          {LAB_ERROR_TYPES.map((label) => (
            <label key={label} className="flex items-start gap-2 text-sm text-zinc-800 dark:text-zinc-200">
              <input
                type="checkbox"
                className="mt-1"
                checked={active.includes(label)}
                onChange={(event) => {
                  setActive((current) => {
                    const next = event.target.checked ? [...current, label] : current.filter((item) => item !== label)
                    return next.length ? next : [LAB_ERROR_TYPES[0]]
                  })
                }}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        <label className="block max-w-lg text-sm text-zinc-800 dark:text-zinc-200">
          Focus
          <select value={focus} onChange={(e) => setFocus(e.target.value)} className={`mt-1 ${inputClass}`}>
            {LAB_ERROR_TYPES.map((label) => <option key={label} value={label}>{label}</option>)}
          </select>
        </label>
        {LAB_ERROR_TYPES.map((label) => (
          <label key={label} className="block text-sm text-zinc-800 dark:text-zinc-200">
            {label}
            <textarea
              value={prompts[label] || ''}
              onChange={(e) => setPrompts((current) => ({ ...current, [label]: e.target.value }))}
              rows={8}
              className={`mt-1 font-mono ${inputClass}`}
            />
          </label>
        ))}
        <SlideTextButton type="submit" text="Save prompts" hoverText="Store settings" />
      </form>
      {message ? <p className="text-sm text-zinc-700 dark:text-zinc-300">{message}</p> : null}
    </div>
  )
}

function parseCsv(text: string) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim())
  if (!lines.length) return []
  const headers = splitCsvLine(lines[0]).map((cell) => cell.trim().toLowerCase())
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line)
    const row: Record<string, string> = {}
    headers.forEach((header, index) => { row[header] = cells[index] ?? '' })
    return row
  }).filter((row) => Object.values(row).some((value) => value.trim()))
}

function splitCsvLine(line: string) {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (quoted && char === '"' && line[i + 1] === '"') {
      current += '"'
      i += 1
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === ',' && !quoted) {
      cells.push(current)
      current = ''
    } else {
      current += char
    }
  }
  cells.push(current)
  return cells
}

function pick(row: Record<string, string>, names: string[]) {
  for (const name of names) {
    if (row[name] != null && row[name] !== '') return row[name]
  }
  return ''
}

async function runDebugBatch(settings: Record<string, unknown>, rows: Array<Record<string, string>>) {
  const active = normalizeActiveErrorTypes(settings.activeErrorTypes)
  const prompts = settings.errorPrompts && typeof settings.errorPrompts === 'object'
    ? settings.errorPrompts as Record<string, string>
    : {}
  const missing = active.filter((label) => !String(prompts[label] ?? '').trim())
  if (missing.length) throw new Error(`Fill prompts for: ${missing.join('; ')}`)
  const system = composeDebugPrompt(settings)
  const model = String(settings.model || 'gpt-4o-mini')
  const leadInput = rows.map((row, index) => {
    const id = pick(row, ['id', 'lead id', 'leadid']) || String(index + 1)
    const item: Record<string, string> = { id }
    const fields: Array<[string, string[]]> = [
      ['s', ['s', 'status', 'lead status']],
      ['c', ['c', 'comments', 'comment']],
      ['rq', ['rq', 'requirement', 'customer requirement']],
      ['k', ['k', 'connected']],
      ['n', ['n', 'next followup', 'next followup date']],
      ['u', ['u', 'update', 'lead update']],
      ['b', ['b', 'budget', 'estimated budget']],
    ]
    for (const [key, names] of fields) {
      const value = pick(row, names)
      if (value) item[key] = value
    }
    return item
  })
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['a'],
    properties: {
      a: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'q', 'e', 'i', 'o', 'r'],
          properties: {
            id: { type: 'string' },
            q: { type: 'integer', minimum: 0, maximum: 10 },
            e: { type: 'array', items: { type: 'string', enum: active } },
            i: { type: 'integer', enum: [0, 1] },
            o: { type: 'string' },
            r: { type: 'string' },
          },
        },
      },
    },
  }
  const maxTokens = Math.max(500, leadInput.length * 140)
  const reasoning = /(^|[^a-z])(gpt-5|o1|o3|o4)([.-]|$)/i.test(model) && !model.toLowerCase().includes('gpt-5-chat')
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `Audit ${leadInput.length} call(s). Echo each id. c=full history — assess cumulative buying intent; 1–5 RNR/Busy/Unreachable are neutral and do not cancel prior interest; interest cancels only on ACTIVE rejection or 8+ consecutive RNRs. For each id, o must explain WHY each e label was raised.\n${JSON.stringify({ L: leadInput })}` },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'll_audit', strict: true, schema } },
  }
  if (reasoning) body.max_completion_tokens = maxTokens
  else {
    body.max_tokens = maxTokens
    body.temperature = 0
  }
  const response = await fetch(`${apiBase()}openai/chat/completions`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    let detail = ''
    try {
      const errJson = await response.json() as { error?: { message?: string } | string }
      detail = typeof errJson.error === 'string' ? errJson.error : errJson.error?.message || ''
    } catch { /* ignore */ }
    throw new Error(`OpenAI ${response.status}: ${detail || response.statusText}`)
  }
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('OpenAI returned no audit content.')
  const parsed = JSON.parse(content) as { a?: Array<Record<string, unknown>> }
  if (!Array.isArray(parsed.a)) throw new Error('OpenAI response did not contain results array.')
  const allowed = new Set(active)
  return parsed.a.map((item) => {
    const labels = Array.isArray(item.e)
      ? item.e.map((token) => String(token || '').trim()).filter((label) => allowed.has(label))
      : []
    return {
      id: String(item.id ?? ''),
      q: String(item.q ?? ''),
      e: labels.length ? labels.join(', ') : 'None',
      o: String(item.o ?? ''),
      r: String(item.r ?? ''),
    }
  })
}
