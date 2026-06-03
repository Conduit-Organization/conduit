import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The engine (src/web/server.ts) runs the buyer + seller + agent on :8788 and exposes /api/*.
// In dev we serve the React app with HMR on :5173 and proxy /api to the engine.
// For production, `vite build` emits ./dist, which the engine serves directly (open :8788).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8788', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
