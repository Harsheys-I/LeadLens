import { LAB_ERROR_TYPES, SHARED_PREAMBLE, STATUS_HISTORY_PROMPT } from '@/lib/debug-prompts.ts'

export function promptFromDebugSettings(settings: unknown) {
  const record = settings && typeof settings === 'object' ? settings as Record<string, unknown> : {}
  const focus = String(record.focusErrorType || LAB_ERROR_TYPES[0])
  const prompts = record.errorPrompts && typeof record.errorPrompts === 'object'
    ? record.errorPrompts as Record<string, string>
    : {}
  const body = String(prompts[focus] || '').trim() || STATUS_HISTORY_PROMPT
  return `${SHARED_PREAMBLE}\n\n${body}`
}

export function normalizeActiveErrorTypes(raw: unknown) {
  const allowed = new Set<string>(LAB_ERROR_TYPES)
  const list = Array.isArray(raw)
    ? raw.map((item) => String(item || '').trim()).filter((label) => allowed.has(label))
    : []
  const unique: string[] = []
  for (const label of list) {
    if (!unique.includes(label)) unique.push(label)
  }
  return unique.length ? unique : [LAB_ERROR_TYPES[0]]
}

/** Same composition as web-app/debug-engine.js composeDebugPrompt. */
export function composeDebugPrompt(settings: unknown) {
  const record = settings && typeof settings === 'object' ? settings as Record<string, unknown> : {}
  const active = normalizeActiveErrorTypes(record.activeErrorTypes)
  const prompts = record.errorPrompts && typeof record.errorPrompts === 'object'
    ? record.errorPrompts as Record<string, string>
    : {}
  const parts = [SHARED_PREAMBLE]
  for (const label of active) {
    const body = String(prompts[label] ?? '').trim()
    parts.push(`## Error focus: ${label}\n${body}`)
  }
  parts.push(`ALLOWED e labels (exact text only): ${active.join(' | ')}\nPrefer e:[] when unsure. Never invent other labels.\nFor each id, o must explain WHY every label in e was raised (evidence from s/c/rq/k).`)
  return parts.join('\n\n')
}
