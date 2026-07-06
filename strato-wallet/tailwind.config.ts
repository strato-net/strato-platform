import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./entrypoints/**/*.{ts,tsx,html}", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        strato: {
          DEFAULT: "#001B70",
          fg: "#ffffff",
          accent: "#3454D1",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
