import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createApiMiddleware } from './api-handler.mjs'

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [
    react(),
    {
      name: 'lionet-own-index-api',
      configureServer(server) {
        server.middlewares.use('/api', createApiMiddleware('/api'))
      }
    }
  ]
})
