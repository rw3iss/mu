import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'path';

export default defineConfig({
  plugins: [preact()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@mu/shared': resolve(__dirname, '../shared/src'),
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: `@use "${resolve(__dirname, 'src/styles/_variables.scss').replace(/\\/g, '/')}" as *; @use "${resolve(__dirname, 'src/styles/_mixins.scss').replace(/\\/g, '/')}" as *;`,
      },
    },
    modules: { localsConvention: 'camelCase' },
  },
  build: { outDir: 'dist', sourcemap: true },
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:4000',
      '/ws': { target: 'ws://localhost:4000', ws: true },
    },
  },
});
