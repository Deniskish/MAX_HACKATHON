import { useSyncExternalStore } from 'react';

const preference = window.matchMedia('(prefers-color-scheme: dark)');
function readTheme(): 'dark' | 'light' {
  return preference.matches ? 'dark' : 'light';
}
function subscribe(onChange: () => void) {
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
  return useSyncExternalStore(subscribe, readTheme);
}
