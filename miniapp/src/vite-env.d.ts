/// <reference types="vite/client" />
// Описываем только те возможности MAX Bridge, которыми пользуется приложение.

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  WebApp?: {
    ready: () => void;
    initData?: string;
    initDataUnsafe?: { start_param?: string };
    downloadFile?: (url: string, name: string) => void;
  };
  maxBridge?: {
    getUserId: () => string | null;
  };
}
