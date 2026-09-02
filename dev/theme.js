export const THEME_STORAGE_KEY = 'leadlens.theme';
export const THEME_OPTIONS = ['system', 'light', 'dark'];

export function getThemePreference(){
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return THEME_OPTIONS.includes(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function resolveTheme(preference){
  if (preference === 'light') return 'light';
  if (preference === 'dark') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function updateThemeColorMeta(resolved){
  const color = resolved === 'dark' ? '#0f2d22' : '#12372a';
  let meta = document.querySelector('meta[name="theme-color"]:not([media])');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.append(meta);
  }
  meta.content = color;
}

export function applyThemePreference(preference){
  const resolved = resolveTheme(preference);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePref = preference;
  updateThemeColorMeta(resolved);
}

export function setThemePreference(preference){
  const next = THEME_OPTIONS.includes(preference) ? preference : 'system';
  try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch { /* private mode */ }
  applyThemePreference(next);
  syncThemeControls(next);
}

export function syncThemeControls(preference = getThemePreference()){
  document.querySelectorAll('[data-theme-select]').forEach(select => {
    select.value = preference;
  });
}

let systemListenerBound = false;

export function initTheme(){
  const preference = getThemePreference();
  applyThemePreference(preference);
  syncThemeControls(preference);

  if (!systemListenerBound) {
    systemListenerBound = true;
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (getThemePreference() === 'system') applyThemePreference('system');
    });
  }

  document.querySelectorAll('[data-theme-select]').forEach(select => {
    if (select.dataset.themeBound) return;
    select.dataset.themeBound = '1';
    select.addEventListener('change', () => setThemePreference(select.value));
  });
}
