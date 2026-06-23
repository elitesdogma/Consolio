import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, Vite serves the UI on :5173 and proxies API calls to the Express
// server (default :8080). In production the Express server serves the built
// assets and the API on a single port, so this proxy is dev-only.
const API_DEV_TARGET = process.env.API_DEV_TARGET ?? 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': { target: API_DEV_TARGET, changeOrigin: true },
    },
  },
});
