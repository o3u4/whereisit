import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Dev server proxies /api to the local FastAPI backend on :8080.
// Production serves the built SPA from FastAPI on the same port (no CORS).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true, // reachable from LAN devices during development
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})
