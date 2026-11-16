import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// Component tests only. The plain `tests/*.test.ts` files use node:test and are
// run with `node --test`; they are deliberately outside this include.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/component/**/*.test.{ts,tsx}"],
    restoreMocks: false,
  },
});
