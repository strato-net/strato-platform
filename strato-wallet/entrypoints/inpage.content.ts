// Inpage provider — registered as a MAIN-world content script so the browser
// injects it directly into the page at document_start. This is more reliable
// than appending a <script> tag (which strict page CSPs can silently block and
// which races dApp discovery code). It defines the EIP-1193 provider, announces
// it via EIP-6963, and exposes a small window.strato helper. No extension APIs
// and no secrets live here — it talks only via window.postMessage to the
// ISOLATED-world relay (content.ts).

import { defineContentScript } from "wxt/sandbox";
import {
  CONTENT_TARGET,
  INPAGE_TARGET,
  isRpcResponse,
  type InpageMessage,
  type RpcRequest,
} from "@/src/messaging/protocol";

// A stable, randomly-generated UUID identifying this provider for EIP-6963.
const PROVIDER_UUID = "b6f6c0de-57a2-4c2f-9e2a-5747a70a57a0";
const PROVIDER_RDNS = "net.blockapps.strato.wallet";

const ICON =
  "data:image/png;base64,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";

type Handler = (...args: any[]) => void;

class StratoProvider {
  readonly isStrato = true;
  private nextId = 1;
  private pending = new Map<number | string, { resolve: (v: any) => void; reject: (e: any) => void }>();
  private listeners = new Map<string, Set<Handler>>();

  constructor() {
    window.addEventListener("message", (event: MessageEvent) => {
      if (event.source !== window) return;
      const msg = event.data as InpageMessage | undefined;
      if (!msg || msg.target !== INPAGE_TARGET) return;
      const payload = msg.payload;
      if (isRpcResponse(payload)) {
        const entry = this.pending.get(payload.id);
        if (!entry) return;
        this.pending.delete(payload.id);
        if ("error" in payload) entry.reject(Object.assign(new Error(payload.error.message), payload.error));
        else entry.resolve(payload.result);
      } else {
        // provider push event (accountsChanged, chainChanged, …)
        this.emit(payload.event, payload.data);
      }
    });
  }

  request = ({ method, params }: { method: string; params?: unknown[] }): Promise<unknown> => {
    const id = this.nextId++;
    const req: RpcRequest = { id, method, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      // Same-window relay; "*" because the page origin may be opaque ("null" on
      // file://). The content-script listener filters by event.source === window.
      window.postMessage({ target: CONTENT_TARGET, payload: req }, "*");
    });
  };

  // Minimal EIP-1193 event emitter.
  on(event: string, handler: Handler): this {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
    return this;
  }
  removeListener(event: string, handler: Handler): this {
    this.listeners.get(event)?.delete(handler);
    return this;
  }
  private emit(event: string, data: unknown) {
    this.listeners.get(event)?.forEach((h) => {
      try {
        h(data);
      } catch {
        /* ignore listener errors */
      }
    });
  }

  // Legacy convenience used by some older dApps.
  async enable() {
    return this.request({ method: "eth_requestAccounts" });
  }
}

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  world: "MAIN",
  main() {
    const provider = new StratoProvider();

    // EIP-6963 discovery: announce ourselves and re-announce on request.
    // NOTE: the announced name must NOT be exactly "STRATO Wallet" — smd-ui's
    // in-app vault connector uses that name and identifies itself by name match,
    // so an identical name makes smd-ui misclassify this external extension as
    // its in-app connector (wedging its Connect button).
    const info = Object.freeze({
      uuid: PROVIDER_UUID,
      name: "STRATO",
      icon: ICON,
      rdns: PROVIDER_RDNS,
    });
    const announce = () =>
      window.dispatchEvent(
        new CustomEvent("eip6963:announceProvider", {
          detail: Object.freeze({ info, provider }),
        })
      );
    window.addEventListener("eip6963:requestProvider", announce);
    announce();

    // Coexist with other wallets: only claim window.ethereum if it's free.
    try {
      if (!(window as any).ethereum) {
        (window as any).ethereum = provider;
      }
    } catch {
      /* some pages lock window.ethereum; EIP-6963 still works */
    }

    // STRATO-native helpers.
    (window as any).strato = {
      provider,
      request: provider.request,
      /** Build/sign/submit a STRATO BLOC transaction (contract/function/transfer). */
      sendBlocTransaction: (params: unknown) =>
        provider.request({ method: "strato_sendBlocTransaction", params: [params] }),
    };
  },
});
