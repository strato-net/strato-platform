// src/lib/axios.ts
import axios from "axios";
import { toast } from "@/hooks/use-toast";
import { getErrorTitle } from "./errorConfig";
import { getCsrfToken } from "./csrf";

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
    
    // Show toast for all API errors (except 401 which is handled separately)
    if (error.response?.status !== 401) {
      const errorMessage = extractApiErrorMessage(error);
      const errorTitle = getErrorTitle(url);
      toast({
        title: errorTitle,
        description: typeof errorMessage === "string"
          ? errorMessage
          : "An unexpected error occurred.",
        variant: "destructive",
      });
    }
    
    if (error.response?.status === 401 && url !== '/user/me') {
      toast({
        title: "Session Expired",
        description: "Redirecting to login...",
        variant: "destructive",
      });
      setTimeout(() => {
        const theme = localStorage.getItem('theme') || 'light';
        window.location.href = `/login?theme=${theme}`;
      }, 1500);
    }
    return Promise.reject(error);
  }
);

export { api, axios };
