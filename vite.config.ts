import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: '/eclipse-wasteland/',
  plugins: [tailwindcss()],
  server: {
    port: 7810,
    strictPort: true,
  },
  build: {
    chunkSizeWarningLimit: 700,
  },
});
