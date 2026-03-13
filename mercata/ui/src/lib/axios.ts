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

// Request interceptor to add CSRF token to state-changing requests
api.interceptors.request.use(
  (config) => {
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

// URLs that are expected to fail for non-authenticated users (should not redirect to login)
const GUEST_SAFE_URLS = [
  '/user/me',
  // DepositsGuestPage
  '/tokens/v2/earning-assets/public',
  '/bridge/networkConfigs',
  '/bridge/bridgeableTokens',
  '/bridge/depositActions',
  '/bridge/withdrawalSummary',
  '/bridge/balance',
  '/bridge/transactions/withdrawal',
  // Borrow page
  '/lending/collateral/public',
  '/lending/loans',
  '/cdp/vaults',
  '/cdp/assets',
  // StratoStats page
  '/tokens/stats',
  '/cdp/stats',
  '/cdp/interest',
  '/lending/interest',
  '/protocol-fees/revenue',
  // Advanced page - Mint tab - Liquidations sub-tab
  '/cdp/liquidatable',
  '/cdp/config',
  '/cdp/admin/global-paused',
  // Advanced page - Lending tab
  '/lending/liquidity/public',
  // Advanced page - Swap tab
  '/swap-pools',
  // Metal Forge page
  '/metal-forge/configs',
  // Advanced page - Safety tab
  '/lending/safety/info',
  '/lending/safety/info/public',
  // Rewards page
  '/rewards/pending',
  '/rewards/overview',
  '/rewards/activities',
  // ActivityFeed page
  '/events',
  // Transfer page
  '/tokens/transferable',
  '/tokens/balance',
  '/vouchers/balance',
];

// Check if a URL is expected to fail silently for guests
function isGuestSafeUrl(url: string): boolean {
  return GUEST_SAFE_URLS.some(safeUrl => url.includes(safeUrl));
}

// Response interceptor to catch 401, 403 (CSRF), and show global toast for all APIs
api.interceptors.response.use(
  (response) => response,
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
    
    // For 401 errors, handle based on whether the URL is guest-safe
    if (error.response?.status === 401) {
      // If URL is guest-safe, silently reject without toast or redirect
      // This prevents errors when guests browse public pages that call user-specific APIs
      if (isGuestSafeUrl(url)) {
        return Promise.reject(error);
      }
      
      // For non-guest-safe URLs, show session expired message and redirect
      toast({
        title: "Session Expired",
        description: "Reauthenticating the user...",
      });
      setTimeout(() => {
        redirectToLogin();
      }, 1500);
      return Promise.reject(error);
    }
    
    // For 502 (Bad Gateway) and other server errors on guest-safe URLs, silently reject
    // This prevents error toasts for non-logged-in users when backend services are unavailable
    if (isGuestSafeUrl(url) && (error.response?.status === 502 || error.response?.status === 503 || error.response?.status === 504)) {
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
