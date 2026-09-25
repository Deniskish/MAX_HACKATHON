// Подключаем тему MAX и запускаем React. Данные запуска нужны только для навигации.
import { StrictMode, useEffect, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { MaxUI } from '@maxhub/max-ui';
import '@maxhub/max-ui/dist/styles.css';
import '@fontsource-variable/manrope';
import App from './App';
import { installViewportSizing } from './viewport';
import './index.css';
const bridgeScript = document.createElement('script');
bridgeScript.src = 'https://st.max.ru/js/max-web-app.js';
bridgeScript.onload = () => {
  window.WebApp?.ready();
  window.dispatchEvent(new Event('opora:max-ready'));
};
document.head.appendChild(bridgeScript);
const darkMode = window.matchMedia('(prefers-color-scheme: dark)');
const subscribeTheme = (listener: () => void) => {
  darkMode.addEventListener('change', listener);
  return () => darkMode.removeEventListener('change', listener);
};
function ThemedApp() {
  const dark = useSyncExternalStore(subscribeTheme, () => darkMode.matches);
  useEffect(installViewportSizing, []);
  return <MaxUI colorScheme={dark ? 'dark' : 'light'} className="opora-theme"><App /></MaxUI>;
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemedApp />
  </StrictMode>,
);
