import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served under /dashboard on the tracking stack's nginx (which strips the
// prefix before proxying to the static server).
export default defineConfig({
  base: '/dashboard/',
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/tracking-api': {
        target: 'http://localhost:3010',
        changeOrigin: true,
      },
    },
  },
});
