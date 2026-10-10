export const THEME_STORAGE_KEY = 'leadlens.theme'
export const THEME_OPTIONS = ['system', 'light', 'dark'] as const
export type ThemePreference = (typeof THEME_OPTIONS)[number]
export type ResolvedTheme = 'light' | 'dark'

export function getThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    return THEME_OPTIONS.includes(stored as ThemePreference) ? (stored as ThemePreference) : 'system'
  } catch {
    return 'system'
  }
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === 'light') return 'light'
  if (preference === 'dark') return 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyThemePreference(preference: ThemePreference) {
  const resolved = resolveTheme(preference)
  document.documentElement.dataset.theme = resolved
  document.documentElement.dataset.themePref = preference
}

export function setThemePreference(preference: ThemePreference) {
  const next = THEME_OPTIONS.includes(preference) ? preference : 'system'
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next)
  } catch {
    /* private mode */
  }
  applyThemePreference(next)
}

let systemListenerBound = false

export function initTheme() {
  applyThemePreference(getThemePreference())
  if (!systemListenerBound) {
    systemListenerBound = true
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (getThemePreference() === 'system') applyThemePreference('system')
    })
  }
}
