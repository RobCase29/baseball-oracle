import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const publicApiTarget =
  process.env.API_PROXY_TARGET ?? 'https://baseball-oracle.vercel.app'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/health': publicApiTarget,
      '/api/players': publicApiTarget,
    },
  },
})
