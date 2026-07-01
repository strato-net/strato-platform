// Shared message shapes for page <-> background communication.
//
// The inpage script (page MAIN world) talks to the content script via
// window.postMessage, and the content script relays to the background service
// worker over a chrome.runtime port. The dApp `origin` is stamped by the content
// script and is never trusted from page-supplied data.

export const INPAGE_TARGET = "strato-wallet:inpage";
export const CONTENT_TARGET = "strato-wallet:content";
// Long-lived port held by the popup UI purely to keep the MV3 service worker
// alive (and its in-memory keyring + pending approvals) while any wallet window
// is open.
export const KEEPALIVE_PORT = "strato-wallet-keepalive";

/** A JSON-RPC-style request coming from a dApp. */
export interface RpcRequest {
  id: number | string;
  method: string;
  params?: unknown[];
}

export interface RpcSuccess {
  id: number | string;
  result: unknown;
}

export interface RpcFailure {
  id: number | string;
  error: { code: number; message: string; data?: unknown };
}

export type RpcResponse = RpcSuccess | RpcFailure;

/** page -> content -> background */
export interface PageMessage {
  target: typeof CONTENT_TARGET;
  payload: RpcRequest;
}

/** content -> background (one-off runtime.sendMessage; reliably wakes the SW). */
export interface RpcEnvelope {
  kind: "rpc";
  payload: RpcRequest;
}

export function isRpcEnvelope(m: unknown): m is RpcEnvelope {
  return !!m && typeof m === "object" && (m as RpcEnvelope).kind === "rpc";
}

/** background -> content -> page (response or push event) */
export interface InpageMessage {
  target: typeof INPAGE_TARGET;
  payload: RpcResponse | ProviderEvent;
}

/** EIP-1193 push events relayed to the page (accountsChanged, chainChanged, …). */
export interface ProviderEvent {
  event: string;
  data: unknown;
}

export function isRpcResponse(p: RpcResponse | ProviderEvent): p is RpcResponse {
  return "id" in p;
}

// Standard EIP-1193 / JSON-RPC error codes.
export const RpcErrors = {
  userRejected: { code: 4001, message: "User rejected the request" },
  unauthorized: { code: 4100, message: "Unauthorized" },
  unsupportedMethod: { code: 4200, message: "Unsupported method" },
  disconnected: { code: 4900, message: "Disconnected" },
  locked: { code: 4100, message: "Wallet is locked" },
  internal: { code: -32603, message: "Internal error" },
  invalidParams: { code: -32602, message: "Invalid params" },
} as const;

export class RpcError extends Error {
  code: number;
  data?: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.code = code;
    this.data = data;
  }
  static from(e: { code: number; message: string }, data?: unknown) {
    return new RpcError(e.code, e.message, data);
  }
}
