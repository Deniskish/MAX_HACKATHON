// Vite обслуживает интерфейс, а запросы /api/ передаёт своему backend.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// The trailing slash keeps shared /api-server/*.ts modules on Vite's module server.
export default defineConfig({
  plugins: [react()],
  server: { host: '0.0.0.0', port: 3000, proxy: { '/api/': 'http://localhost:3002' } },
});
