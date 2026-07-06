import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { KEEPALIVE_PORT } from "@/src/messaging/protocol";
import "./style.css";

// Hold a port to the background for as long as this window is open. In MV3 an
// open port keeps the service worker (and thus the unlocked keyring + pending
// approvals) alive, so an approval can't be dropped mid-flight by the worker
// being suspended.
browser.runtime.connect({ name: KEEPALIVE_PORT });

// Apply the saved theme before first paint to avoid a flash.
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
