import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        tb02: resolve(__dirname, 'testbuilds/tb02-galaxy/index.html'),
      },
    },
  },
});
