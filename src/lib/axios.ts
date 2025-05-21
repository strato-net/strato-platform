// src/lib/axios.ts
import axios from "axios";
import { toast } from "@/components/ui/sonner";

const api = axios.create({
  baseURL: "/api",
  withCredentials: true,
});

// Response interceptor to catch 401
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      toast("Session expired. Redirecting to login...");
      setTimeout(() => {
        window.location.href = "/login";
      }, 1500);
    }
    return Promise.reject(error);
  }
);

export { api, axios };
