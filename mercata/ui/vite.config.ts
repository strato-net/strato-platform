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
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React libraries
          'react-vendor': ['react', 'react-dom'],
          
          // Router
          'router': ['react-router-dom'],
          
          // UI Libraries
          'ui-core': ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu', '@radix-ui/react-tabs'],
          'ui-extended': ['@radix-ui/react-accordion', '@radix-ui/react-alert-dialog', '@radix-ui/react-avatar'],
          
          // Blockchain libraries (heavy)
          'blockchain': ['ethers', 'viem', 'wagmi', '@rainbow-me/rainbowkit'],
          
          // Charts (heavy)
          'charts': ['recharts'],
          
          // Ant Design (heavy)
          'antd': ['antd', '@ant-design/icons'],
          
          // Forms
          'forms': ['react-hook-form', '@hookform/resolvers', 'zod'],
          
          // Utilities
          'utils': ['lodash', 'date-fns', 'axios'],
          
          // Query
          'query': ['@tanstack/react-query'],
        }
      }
    },
    // Optimize chunks
    chunkSizeWarningLimit: 1000,
  },
}));
