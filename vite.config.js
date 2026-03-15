import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    rollupOptions: {
      // Essentia WASM files are loaded at runtime from /public/models/ — not bundled
      external: [/^\/models\//],
    },
  },
  server: {
    port: 5173,
  },
  assetsInclude: ['**/*.wasm'],
})
