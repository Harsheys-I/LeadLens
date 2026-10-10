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
