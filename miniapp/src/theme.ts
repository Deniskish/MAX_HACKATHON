import { useSyncExternalStore } from 'react';

const preference = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
function readTheme(): 'dark' | 'light' {
  return preference ? preference.matches ? 'dark' : 'light' : 'dark';
}
function subscribe(onChange: () => void) {
  if (!preference) return () => {};
  preference.addEventListener('change', onChange);
  // Recheck after returning from the phone's settings or restoring a WebView.
  window.addEventListener('pageshow', onChange);
  document.addEventListener('visibilitychange', onChange);
  return () => {
    preference.removeEventListener('change', onChange);
    window.removeEventListener('pageshow', onChange);
    document.removeEventListener('visibilitychange', onChange);
  };
}
export function useSystemTheme() {
  return useSyncExternalStore(subscribe, readTheme, () => 'dark' as const);
}
