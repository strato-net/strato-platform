// Side panel: the same wallet UI as the popup, but it stays open after you
// interact with the page (Chrome's side panel). Reuses the popup's App.
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "../popup/App";
import { KEEPALIVE_PORT } from "@/src/messaging/protocol";
import "../popup/style.css";

// Keep the service worker (and unlocked keyring) alive while the panel is open.
browser.runtime.connect({ name: KEEPALIVE_PORT });

// Apply the saved theme before first paint.
try {
  if (localStorage.getItem("strato-theme") === "dark") {
    document.documentElement.classList.add("dark");
  }
} catch {
  /* localStorage unavailable */
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
