import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// The SMD is served under /smd/ behind the platform nginx (nginx-packager -> smd:3002).
// In dev, proxy the STRATO platform endpoints to a running node so the UI can talk to
// bloc / strato-api / cirrus / apex / rpc / vault without CORS. Override the target with
// STRATO_NODE_URL (e.g. STRATO_NODE_URL=https://my-node npm run dev).
const NODE_TARGET = process.env.STRATO_NODE_URL || "http://localhost:8080";

const proxyPaths = [
  "/bloc",
  "/strato-api",
  "/strato",
  "/cirrus",
  "/apex-api",
  "/apex-ws",
  "/rpc",
  "/vault",
  "/api",
  "/auth",
  "/login",
];

export default defineConfig(() => ({
  base: "/smd/",
  server: {
    host: "::",
    port: 3002,
    allowedHosts: ["smd", "localhost", ".localhost", "127.0.0.1"],
    proxy: Object.fromEntries(
      proxyPaths.map((p) => [
        p,
        {
          target: NODE_TARGET,
          changeOrigin: true,
          secure: false,
          ws: p === "/apex-ws",
        },
      ])
    ),
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
