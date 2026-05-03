// src/lib/axios.ts
import axios from "axios";
import { toast } from "@/hooks/use-toast";
import { getErrorTitle } from "./errorConfig";
import { getCsrfToken } from "./csrf";
import { redirectToLogin } from "./auth";

const api = axios.create({
  baseURL: "/api",
  withCredentials: true,
});

let _walletAddress: string | null = null;
export function setConnectedWalletAddress(addr: string | null) {
  _walletAddress = addr;
}

type WalletSignFn = (unsignedTx: any) => Promise<string>;
let _walletSignFn: WalletSignFn | null = null;
export function setWalletSigner(fn: WalletSignFn | null) {
  _walletSignFn = fn;
}

function parseSignature(sig: string): { r: string; s: string; v: string } {
  const raw = sig.replace(/^0x/, "");
  return {
    r: raw.slice(0, 64),
    s: raw.slice(64, 128),
    v: raw.slice(128, 130),
  };
}

function buildSignedTx(unsignedData: any, sig: { r: string; s: string; v: string }): any {
  return {
    nonce: unsignedData.nonce,
    gasLimit: unsignedData.gasLimit,
    to: unsignedData.to,
    funcName: unsignedData.functionName,
    args: unsignedData.args,
    network: unsignedData.network,
    r: sig.r,
    s: sig.s,
    v: sig.v,
    txVersion: 1,
  };
}

async function pollTxResult(hashes: string[], timeout = 60000, interval = 3000): Promise<any[]> {
  const start = Date.now();
  while (true) {
    const { data: results } = await api.post("/rpc/results", hashes);
    const allDone = results.every((r: any) => r?.status !== "Pending");
    if (allDone) return results;
    if (Date.now() - start >= timeout) return results;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

async function signAndSubmitUnsignedTxs(unsignedTxs: any[]): Promise<{
  status: string;
  hash: string;
  /** All on-chain hashes for the batch, in submission order. Lets callers
   *  pick the meaningful tx (e.g. the second in an approve+action pair). */
  hashes: string[];
  /** Per-tx status objects from /api/rpc/results, in the same order as `hashes`. */
  results: any[];
}> {
  if (!_walletSignFn) {
    // Most common cause: the user clicked submit before wagmi finished
    // resolving the wallet client (account.isConnected fired but
    // useWalletClient() hadn't returned yet). UserContext gates on
    // walletSignerReady to prevent this; surface a clear error if we
    // somehow get here anyway.
    throw new Error(
      "Wallet signer not ready. Reconnect your wallet and try again, " +
        "or wait a moment for the wallet client to initialize.",
    );
  }

  const hashes: string[] = [];
  for (let i = 0; i < unsignedTxs.length; i++) {
    const tx = unsignedTxs[i];
    let signature: string;
    try {
      signature = await _walletSignFn(tx);
    } catch (err: any) {
      // User rejection is the typical case here -- give a focused message
      // rather than the raw provider error.
      const msg = err?.shortMessage || err?.message || String(err);
      throw new Error(`Wallet signature failed for tx ${i + 1} of ${unsignedTxs.length}: ${msg}`);
    }
    const sig = parseSignature(signature);
    const signedTx = buildSignedTx(tx.data, sig);
    const submittedHash = await api.post("/rpc/submit", signedTx);
    hashes.push(typeof submittedHash.data === "string" ? submittedHash.data : tx.hash);
  }

  const results = await pollTxResult(hashes);
  const failed = results.find((r: any) => r?.status === "Failure");
  if (failed) {
    throw new Error(failed.txResult?.message || failed.message || "Transaction failed");
  }
  // Return the LAST tx as the "primary" status/hash. For the approve+action
  // pattern (e.g. approve then requestWithdrawalProof), the action is what
  // the caller cares about; approve is just a setup step.
  const lastIdx = hashes.length - 1;
  return {
    status: results[lastIdx]?.status || "Success",
    hash: hashes[lastIdx],
    hashes,
    results,
  };
}

api.interceptors.request.use(
  (config) => {
    if (_walletAddress) {
      config.headers["X-Wallet-Address"] = _walletAddress;
    }

    const method = (config.method || "get").toLowerCase();
    const needsCsrf = ["post", "put", "delete", "patch"].includes(method);

    if (needsCsrf) {
      const csrfToken = getCsrfToken();
      if (csrfToken) {
        config.headers["X-CSRF-Token"] = csrfToken;
      } else {
        console.warn("CSRF token not found. Request may fail.");
      }
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Helper: Extract error message from backend response
function extractApiErrorMessage(error: any): string {
  // For 500+ errors, never show the raw server message
  const status = error?.response?.status;
  if (!status || status >= 500) {
    const errorData = error?.response?.data;
    const rawMessage = errorData?.error?.message || errorData?.error || errorData?.message || error?.message || "unknown";
    console.warn(`[Msg Sanitized] Status: ${status || "N/A"}, Original message: "${rawMessage}"`);
    return "Something went wrong. Please try again later.";
  }

  // Handle different error response structures
  const errorData = error?.response?.data;

  // If error is an object with message property
  if (errorData?.error && typeof errorData.error === 'object' && errorData.error.message) {
    return errorData.error.message;
  }
  
  // If error is a direct string
  if (typeof errorData?.error === 'string') {
    return errorData.error;
  }
  
  // If message is at top level
  if (typeof errorData?.message === 'string') {
    return errorData.message;
  }
  
  // Fallback to generic error message
  return error?.message || "An unexpected error occurred.";
}

// Response interceptor to catch 401, 403 (CSRF), and show global toast for all APIs
api.interceptors.response.use(
  async (response) => {
    if (response.data?._unsigned && response.data?._unsignedTxs) {
      // Visible breadcrumb so we can confirm the interceptor is reached;
      // if you don't see this in the console for an external-signing
      // response, the new axios.ts module isn't loaded (Vite cache).
      console.info(
        `[unsigned-tx] intercepted ${response.data._unsignedTxs.length} unsigned tx(s); ` +
          `wallet signer ${_walletSignFn ? "ready" : "MISSING"}`,
      );
      try {
        const result = await signAndSubmitUnsignedTxs(response.data._unsignedTxs);
        response.data = { ...response.data, ...result, _unsigned: undefined, _unsignedTxs: undefined };
      } catch (err: any) {
        // signAndSubmitUnsignedTxs throws for: missing wallet signer, user
        // rejection, /rpc/submit failure, or tx revert. Without this
        // surface, the caller's promise just rejects silently and the page
        // looks frozen. Toast + console log makes the failure visible.
        const msg = err?.message || String(err) || "Unknown signing error";
        console.error("[unsigned-tx] sign/submit failed:", err);
        toast({
          title: "Could not submit STRATO transaction",
          description: msg,
          variant: "destructive",
        });
        throw err;
      }
    }
    return response;
  },
  (error) => {
    // Skip error handling for aborted/canceled requests
    if (error.name === 'AbortError' || error.name === 'CanceledError' || error.code === 'ERR_CANCELED') {
      return Promise.reject(error);
    }
    
    const url = error?.config?.url || "";
    
    // Handle CSRF validation errors (403 with CSRF message)
    if (error.response?.status === 403) {
      const errorMessage = extractApiErrorMessage(error);
      if (typeof errorMessage === "string" && errorMessage.includes("CSRF protection")) {
        toast({
          title: "Security Validation Failed",
          description: "Please refresh the page and try again.",
          variant: "destructive",
        });
        return Promise.reject(error);
      }
    }
    
    // For 401 errors, redirect to login (session expired)
    if (error.response?.status === 401) {
      toast({
        title: "Session Expired",
        description: "Reauthenticating the user...",
      });
      setTimeout(() => {
        redirectToLogin();
      }, 1500);
      return Promise.reject(error);
    }
    
    // Show toast for all other API errors
    const errorMessage = extractApiErrorMessage(error);
    const errorTitle = getErrorTitle(url);
    toast({
      title: errorTitle,
      description: typeof errorMessage === "string"
        ? errorMessage
        : "An unexpected error occurred.",
      variant: "destructive",
    });
    
    return Promise.reject(error);
  }
);

export { api, axios };
