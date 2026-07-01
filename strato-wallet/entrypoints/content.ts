// Content script (ISOLATED world): a pure relay. The EIP-1193 provider itself is
// injected separately as a MAIN-world content script (inpage.content.ts); this
// script shuttles each dApp JSON-RPC request to the background service worker and
// posts the response back to the page. It never touches keys or the password.
//
// Each request uses a one-off runtime.sendMessage rather than a long-lived port:
// in MV3 the service worker is frequently torn down when idle, which silently
// kills a persistent port (the next postMessage throws and is dropped → no
// response). A fresh sendMessage reliably wakes the worker for every request.

import { defineContentScript } from "wxt/sandbox";
import {
  CONTENT_TARGET,
  INPAGE_TARGET,
  RpcErrors,
  type InpageMessage,
  type PageMessage,
  type RpcResponse,
} from "@/src/messaging/protocol";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  main() {
    // background -> page provider events (accountsChanged, chainChanged, …)
    browser.runtime.onMessage.addListener((msg: unknown) => {
      const m = msg as InpageMessage | undefined;
      if (m && m.target === INPAGE_TARGET) window.postMessage(m, "*");
    });

    window.addEventListener("message", async (event: MessageEvent) => {
      if (event.source !== window) return;
      const msg = event.data as PageMessage | undefined;
      if (!msg || msg.target !== CONTENT_TARGET) return;
      const req = msg.payload;

      let response: RpcResponse;
      try {
        response = (await browser.runtime.sendMessage({
          kind: "rpc",
          payload: req,
        })) as RpcResponse;
        // If no listener responded (worker race), surface a retryable error.
        if (!response) {
          response = { id: req.id, error: RpcErrors.disconnected };
        }
      } catch (e) {
        response = {
          id: req.id,
          error: { code: RpcErrors.internal.code, message: (e as Error).message },
        };
      }
      // Same-window relay; "*" because the page origin may be opaque (file://).
      window.postMessage({ target: INPAGE_TARGET, payload: response }, "*");
    });
  },
});
