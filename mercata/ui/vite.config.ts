import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";


// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    // Environment variables for bridge configuration
    'import.meta.env.VITE_SHOW_TESTNET': '"true"',
    // Safe address placeholder - replace with actual safe address from bridge service
    'import.meta.env.VITE_SAFE_ADDRESS': '"0xF53Bf6b905481beD5c43Fa83Ee3e5703f8584aB1"',
  },
  server: {
    host: "::",
    port: 8080,
    allowedHosts: [
      'ui',
      'localhost',
      '.localhost',
      '127.0.0.1'
    ],
    proxy: {
      '/api/bridge': {
        target: 'https://localhost:3003',
        changeOrigin: true,
        secure: true,
      },
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  plugins: [
    react(),
    mode === 'development' &&
    componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
