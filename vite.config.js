import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const project = fileURLToPath(new URL('.', import.meta.url));

// The viewer ships prebuilt in viewer-dist/. Relative asset paths let it be served from any folder
// (the deployed history lives under /afterimage/).
export default defineConfig({
  root: project + 'src/viewer',
  base: './',
  publicDir: false,
  plugins: [react()],
  build: { outDir: project + 'viewer-dist', emptyOutDir: true, assetsDir: 'assets' },
});
