// src/lib/axios.ts
import axios from "axios";
import { toast } from "@/hooks/use-toast";
import { getErrorTitle } from "./errorConfig";

const api = axios.create({
  baseURL: "/api",
  withCredentials: true,
});

// Helper: Extract error message from backend response
function extractApiErrorMessage(error: any): string {
  console.log(" catching error in extractApiErrorMessage",error.response.data.error);
  return (
    error?.response?.data?.error?.message ||
    error?.response?.data?.message ||
    error?.message ||
    "An unexpected error occurred."
  );
}

// Response interceptor to catch 401 and show global toast for all APIs
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const url = error?.config?.url || "";
    
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
        window.location.href = "/login";
      }, 1500);
    }
    return Promise.reject(error);
  }
);

export { api, axios };
