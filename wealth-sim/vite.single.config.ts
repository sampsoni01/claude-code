import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Single-file build used to publish the app as one self-contained page.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist-single', rollupOptions: { output: { inlineDynamicImports: true } }, modulePreload: { polyfill: false } },
});
