import axios from "axios";
import { toast } from "sonner";
import { getCsrfToken } from "./csrf";

// Callers that surface API errors themselves (e.g. the transaction modals) set
// this to keep the global "Request failed" toast from doubling up.
declare module "axios" {
  export interface AxiosRequestConfig {
    skipErrorToast?: boolean;
  }
}

// Single axios instance for SMD read/write REST calls. Callers pass full paths
// built from env.ts base URLs (BLOC_URL, STRATO_URL, CIRRUS_URL, APEX_URL).
// On-chain transactions are sent through wagmi/viem, not this client.
export const api = axios.create({
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const method = (config.method || "get").toLowerCase();
  if (["post", "put", "delete", "patch"].includes(method)) {
    const csrf = getCsrfToken();
    if (csrf) config.headers["X-CSRF-Token"] = csrf;
  }
  return config;
});

/**
 * Pull the most useful message out of an API error. Bloc/STRATO error bodies
 * are usually JSON-encoded strings — e.g. a 422 carries the VM's contract
 * execution error — so prefer the response body over axios's generic
 * "Request failed with status code NNN".
 */
export function extractErrorMessage(error: any): string {
  const data = error?.response?.data;
  if (typeof data === "string" && data.trim() && !data.trim().startsWith("<")) {
    return data.trim();
  }
  if (data?.error && typeof data.error === "object" && data.error.message) return data.error.message;
  if (typeof data?.error === "string") return data.error;
  if (typeof data?.message === "string") return data.message;
  if (!error?.response?.status || error.response.status >= 500) {
    return "Something went wrong. Please try again later.";
  }
  return error?.message || "An unexpected error occurred.";
}

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.code === "ERR_CANCELED" || error.name === "CanceledError") {
      return Promise.reject(error);
    }
    const message = extractErrorMessage(error);
    // Put the body message where every `catch` looks for it; axios's own
    // message is just "Request failed with status code NNN".
    if (error instanceof Error && message) error.message = message;
    // 401 just means "not authenticated" — the SMD supports guest browsing, so do
    // NOT force a Keycloak login here. UserContext owns the auth lifecycle (it
    // detects session expiry on its periodic probe and drops to the guest landing).
    // Reject silently so guest data calls fail into empty states without a toast.
    if (error.response?.status === 401) {
      return Promise.reject(error);
    }
    if (!error.config?.skipErrorToast) {
      toast.error("Request failed", {
        description: message.length > 300 ? `${message.slice(0, 300)}…` : message,
      });
    }
    return Promise.reject(error);
  }
);
