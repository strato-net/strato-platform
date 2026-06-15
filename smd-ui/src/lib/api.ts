import axios from "axios";
import { toast } from "sonner";
import { getCsrfToken } from "./csrf";
import { redirectToLogin } from "./auth";

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

function extractErrorMessage(error: any): string {
  const status = error?.response?.status;
  if (!status || status >= 500) {
    return "Something went wrong. Please try again later.";
  }
  const data = error?.response?.data;
  if (data?.error && typeof data.error === "object" && data.error.message) return data.error.message;
  if (typeof data?.error === "string") return data.error;
  if (typeof data?.message === "string") return data.message;
  return error?.message || "An unexpected error occurred.";
}

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.code === "ERR_CANCELED" || error.name === "CanceledError") {
      return Promise.reject(error);
    }
    if (error.response?.status === 401) {
      toast.error("Session expired", { description: "Reauthenticating…" });
      setTimeout(() => redirectToLogin(), 1500);
      return Promise.reject(error);
    }
    toast.error("Request failed", { description: extractErrorMessage(error) });
    return Promise.reject(error);
  }
);
