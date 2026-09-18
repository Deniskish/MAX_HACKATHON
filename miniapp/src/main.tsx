// Подключаем тему MAX и запускаем React. Данные запуска нужны только для навигации.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MaxUI } from '@maxhub/max-ui';
import '@maxhub/max-ui/dist/styles.css';
import '@fontsource-variable/manrope';
import App from './App';
import './index.css';
const bridgeScript = document.createElement('script');
bridgeScript.src = 'https://st.max.ru/js/max-web-app.js';
bridgeScript.onload = () => {
  window.WebApp?.ready();
  window.dispatchEvent(new Event('opora:max-ready'));
};
document.head.appendChild(bridgeScript);
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MaxUI colorScheme="light" className="opora-theme">
      <App />
    </MaxUI>
  </StrictMode>,
);
