import { useSyncExternalStore } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
export const themeStorageKey = 'opora.theme';
export function parseThemePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}
export function resolveTheme(value: ThemePreference, systemDark: boolean): 'dark' | 'light' {
  return value === 'system' ? systemDark ? 'dark' : 'light' : value;
}
const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
function storedPreference(): ThemePreference {
  try { return parseThemePreference(localStorage.getItem(themeStorageKey)); } catch { return 'system'; }
}
let preference = storedPreference();
const listeners = new Set<() => void>();
function readTheme() { return resolveTheme(preference, media?.matches ?? true); }
function readPreference() { return preference; }
function publish() {
  if (typeof document !== 'undefined') {
    const theme = readTheme();
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach(meta => {
      meta.removeAttribute('media');
      meta.content = theme === 'dark' ? '#191A1F' : '#F7F7F8';
    });
  }
  listeners.forEach(listener => listener());
}
export function setThemePreference(value: ThemePreference) {
  preference = parseThemePreference(value);
  try { localStorage.setItem(themeStorageKey, preference); } catch { /* Keep the choice for this session. */ }
  publish();
}
function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => { listeners.delete(onChange); };
}
/** Install once at app startup, not once for every themed image. */
export function installTheme() {
  const storageChanged = (event: StorageEvent) => {
    if (event.key === themeStorageKey || event.key === null) {
      preference = storedPreference(); publish();
    }
  };
  media?.addEventListener('change', publish);
  window.addEventListener('storage', storageChanged);
  window.addEventListener('pageshow', publish);
  document.addEventListener('visibilitychange', publish);
  publish();
  return () => {
    media?.removeEventListener('change', publish);
    window.removeEventListener('storage', storageChanged);
    window.removeEventListener('pageshow', publish);
    document.removeEventListener('visibilitychange', publish);
  };
}
// Existing artwork and MAX UI use the same resolved theme as the stylesheet.
export function useSystemTheme() { return useSyncExternalStore(subscribe, readTheme, () => 'dark' as const); }
export function useThemePreference() { return useSyncExternalStore(subscribe, readPreference, () => 'system' as const); }
