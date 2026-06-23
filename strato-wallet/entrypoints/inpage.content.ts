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
  "data:image/svg+xml;base64," +
  btoa(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>" +
      "<rect width='32' height='32' rx='6' fill='#001B70'/>" +
      "<text x='16' y='22' text-anchor='middle' fill='white' font-size='16' font-family='sans-serif'>S</text></svg>"
  );

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
