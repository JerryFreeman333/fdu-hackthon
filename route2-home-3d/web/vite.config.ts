import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 5174,
    open: false
  },
  build: {
    chunkSizeWarningLimit: 2000
  }
});