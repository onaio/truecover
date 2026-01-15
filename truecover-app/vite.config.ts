// ABOUTME: Vite configuration for React app with Vitest testing.
// ABOUTME: Includes dev server proxy config and test setup.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3050,
    proxy: {
      '/api/prediction': {
        target: 'http://localhost:8084',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/prediction/, '/'),
      },
      '/api': {
        target: 'http://localhost:8083',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '/'),
      },
    },
  },
  build: {
    outDir: 'build',
  },
  test: {
    globals: false,
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
  },
})
