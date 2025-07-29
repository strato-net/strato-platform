import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { visualizer } from "rollup-plugin-visualizer";

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
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // React core
          'react-vendor': ['react', 'react-dom'],
          
          // Web3 and blockchain
          'web3-vendor': ['wagmi', '@rainbow-me/rainbowkit', 'ethers', 'viem'],
          
          // UI libraries
          'ui-vendor': [
            'antd', 
            '@ant-design/icons',
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-select',
            '@radix-ui/react-tabs',
            '@radix-ui/react-toast',
            '@radix-ui/react-tooltip'
          ],
          
          // Form and validation
          'form-vendor': ['react-hook-form', '@hookform/resolvers', 'zod'],
          
          // Utilities
          'utils-vendor': ['lodash', 'date-fns', 'clsx', 'tailwind-merge'],
          
          // Charts and data visualization
          'charts-vendor': ['recharts'],
          
          // Query and state management
          'query-vendor': ['@tanstack/react-query'],
          
          // Router
          'router-vendor': ['react-router-dom'],
        }
      }
    },
    chunkSizeWarningLimit: 1000, // Increase warning limit to 1MB
  },
  plugins: [
    react(),
    mode === 'development' &&
    componentTagger(),
    visualizer({
      filename: 'dist/stats.html',
      open: true,
      gzipSize: true,
      brotliSize: true,
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
