import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

const publicApiTarget =
  process.env.API_PROXY_TARGET ?? 'https://baseball-oracle.vercel.app'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        baseball: resolve(import.meta.dirname, 'index.html'),
        football: resolve(import.meta.dirname, 'football/index.html'),
      },
    },
  },
  server: {
    proxy: {
      '/api/health': publicApiTarget,
      '/api/players': publicApiTarget,
      '/api/v1/player-signals': publicApiTarget,
      '/api/model-status': publicApiTarget,
    },
  },
})
