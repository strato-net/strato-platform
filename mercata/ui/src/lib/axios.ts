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

let _appAuthenticated = false;
export function setAppAuthenticated(authenticated: boolean) {
  _appAuthenticated = authenticated;
}

type WalletSignFn = (unsignedTx: any) => Promise<string>;
let _walletSignFn: WalletSignFn | null = null;
export function setWalletSigner(fn: WalletSignFn | null) {
  _walletSignFn = fn;
}

export type WalletTxProgressStatus =
  | "signing"
  | "submitting"
  | "submitted"
  | "confirming"
  | "completed"
  | "failed";

export interface WalletTxProgressEvent {
  index: number;
  total: number;
  status: WalletTxProgressStatus;
  functionName?: string;
  hash?: string;
  error?: string;
}

export type WalletTxProgressHandler = (event: WalletTxProgressEvent) => void;

const WALLET_SIGNING_NETWORK = "STRATO";

function normalizeUnsignedTxForWallet(unsignedTx: any): any {
  return {
    ...unsignedTx,
    data: {
      ...unsignedTx.data,
      network: WALLET_SIGNING_NETWORK,
    },
  };
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

async function pollTxResult(
  hashes: string[],
  timeout = 60000,
  interval = 3000,
  onProgress?: WalletTxProgressHandler
): Promise<any[]> {
  const start = Date.now();
  while (true) {
    const { data: results } = await api.post("/rpc/results", hashes);
    results.forEach((result: any, index: number) => {
      if (result?.status === "Pending") {
        onProgress?.({ index, total: hashes.length, status: "confirming", hash: hashes[index] });
      }
    });
    const allDone = results.every((r: any) => r?.status !== "Pending");
    if (allDone) return results;
    if (Date.now() - start >= timeout) return results;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

async function signAndSubmitUnsignedTxs(
  unsignedTxs: any[],
  onProgress?: WalletTxProgressHandler
): Promise<{ status: string; hash: string }> {
  if (!_walletSignFn) throw new Error("No wallet signer available");

  const hashes: string[] = [];
  for (let index = 0; index < unsignedTxs.length; index++) {
    const tx = unsignedTxs[index];
    const txForWallet = normalizeUnsignedTxForWallet(tx);
    const functionName = txForWallet.data?.functionName;

    try {
      onProgress?.({ index, total: unsignedTxs.length, status: "signing", functionName, hash: tx.hash });
      const signature = await _walletSignFn(txForWallet);
      const sig = parseSignature(signature);
      const signedTx = buildSignedTx(txForWallet.data, sig);

      onProgress?.({ index, total: unsignedTxs.length, status: "submitting", functionName, hash: tx.hash });
      const submittedHash = await api.post("/rpc/submit", signedTx);
      const hash = typeof submittedHash.data === "string" ? submittedHash.data : tx.hash;
      hashes.push(hash);
      onProgress?.({ index, total: unsignedTxs.length, status: "submitted", functionName, hash });
    } catch (error) {
      onProgress?.({
        index,
        total: unsignedTxs.length,
        status: "failed",
        functionName,
        hash: tx.hash,
        error: error instanceof Error ? error.message : "Transaction failed",
      });
      throw error;
    }
  }

  const results = await pollTxResult(hashes, 60000, 3000, onProgress);
  const failed = results.find((r: any) => r?.status === "Failure");
  if (failed) {
    const failedIndex = results.indexOf(failed);
    onProgress?.({
      index: failedIndex,
      total: hashes.length,
      status: "failed",
      hash: hashes[failedIndex],
      error: failed.txResult?.message || failed.message || "Transaction failed",
    });
    throw new Error(failed.txResult?.message || failed.message || "Transaction failed");
  }
  const pendingIndex = results.findIndex((r: any) => r?.status === "Pending");
  if (pendingIndex >= 0) {
    onProgress?.({
      index: pendingIndex,
      total: hashes.length,
      status: "failed",
      hash: hashes[pendingIndex],
      error: "Timed out waiting for transaction confirmation",
    });
    return { status: "Pending", hash: hashes[0] };
  }
  results.forEach((result: any, index: number) => {
    onProgress?.({
      index,
      total: hashes.length,
      status: "completed",
      hash: hashes[index],
      error: result?.status === "Failure" ? result.txResult?.message || result.message : undefined,
    });
  });
  return { status: results[0]?.status || "Success", hash: hashes[0] };
}

api.interceptors.request.use(
  (config) => {
    const walletAuth = (config as any).walletAuth;
    const shouldSendWalletAddress =
      walletAuth === true || (walletAuth !== false && !_appAuthenticated);

    if (_walletAddress && shouldSendWalletAddress) {
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
      const onProgress = (response.config as any).walletTxProgress as WalletTxProgressHandler | undefined;
      const result = await signAndSubmitUnsignedTxs(response.data._unsignedTxs, onProgress);
      response.data = { ...response.data, ...result, _unsigned: undefined, _unsignedTxs: undefined };
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
