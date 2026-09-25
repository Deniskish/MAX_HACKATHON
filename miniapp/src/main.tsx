// Подключаем тему MAX и запускаем React. Данные запуска нужны только для навигации.
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { MaxUI } from '@maxhub/max-ui';
import '@maxhub/max-ui/dist/styles.css';
import '@fontsource-variable/manrope';
import App from './App';
import { installViewportSizing } from './viewport';
import { useSystemTheme } from './theme';
import './index.css';
const bridgeScript = document.createElement('script');
bridgeScript.src = 'https://st.max.ru/js/max-web-app.js';
bridgeScript.onload = () => {
  window.WebApp?.ready();
  window.dispatchEvent(new Event('opora:max-ready'));
};
document.head.appendChild(bridgeScript);
function ThemedApp() {
  const theme = useSystemTheme();
  useEffect(installViewportSizing, []);
  return <MaxUI colorScheme={theme} className={`opora-theme theme-${theme}`}><App /></MaxUI>;
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemedApp />
  </StrictMode>,
);
