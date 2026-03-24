/**
 * Vite config for the plan-mode plugin's federated UI (remote).
 *
 * Runs its own dev server on port 5180. The host (Sero on 5173)
 * auto-discovers this via the sero.app.devPort manifest field.
 *
 * IMPORTANT: @sero-ai/app-runtime must NOT be aliased here — the MF
 * plugin must intercept that import so the host's singleton is used
 * at runtime. Resolution happens via node_modules symlink chain.
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { federation } from '@module-federation/vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'ui',
  base: process.env.NODE_ENV === 'production' ? './' : '/',
  plugins: [
    react(),
    tailwindcss(),
    federation({
      name: 'sero_planmode',
      filename: 'remoteEntry.js',
      dts: false,
      manifest: true,
      exposes: {
        './PlanMode': './ui/PlanMode.tsx',
      },
      shared: {
        react: { singleton: true },
        'react/': { singleton: true },
        'react-dom': { singleton: true },
        'react-dom/': { singleton: true },
      },
    }),
  ],
  server: {
    port: 5180,
    strictPort: true,
    origin: 'http://localhost:5180',
  },
  optimizeDeps: {
    exclude: ['@sero-ai/app-runtime'],
    include: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'],
  },
  build: {
    target: 'esnext',
    outDir: '../dist/ui',
    emptyOutDir: true,
  },
});
