import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "@rainbow-me/rainbowkit/styles.css";
import { loadBackendConfig } from "./lib/env.ts";

void loadBackendConfig().finally(() => {
  createRoot(document.getElementById("root")!).render(<App />);
});
