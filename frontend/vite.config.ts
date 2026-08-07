import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../src'),
    },
  },
  server: {
    proxy: {
      '/runs': 'http://localhost:8787',
      '/trips': 'http://localhost:8787',
      // Without this the session cookie is set on the Vite origin by a request
      // that never reached the API, and sign-in silently does nothing in dev.
      '/auth': 'http://localhost:8787',
    },
    fs: {
      allow: ['.', '..'],
    },
  },
})
