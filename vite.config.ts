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
    // three.js 引擎拆独立 vendor chunk：业务改动不失效引擎缓存，且主包不再超限
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/ }],
        },
      },
    },
  },
});
