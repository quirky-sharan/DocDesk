import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Names the server and the browser must agree on live in one file above
      // this root (see shared/README.md), so neither can drift from the other.
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  build: {
    // three.js is one large chunk by nature; it only loads when a 3D view is
    // about to appear, so its size doesn't affect the first page load.
    chunkSizeWarningLimit: 1100,
    // No source maps in what gets published: they are the original source,
    // comments and all, for anyone who opens the browser's developer tools.
    sourcemap: false,
  },
  server: {
    port: 5173,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    },
    // The dev server only serves files under its root; shared/ sits beside it.
    fs: { allow: ['..'] },
    proxy: {
      // Proxy API calls to Express during development
      '/api': {
        // By address rather than name: the API listens on 127.0.0.1 only, and
        // "localhost" can mean the IPv6 loopback, where nothing is listening.
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
      },
    },
  },
});
