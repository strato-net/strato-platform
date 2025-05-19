// src/lib/axios.ts
import axios from "axios";
import { toast } from "@/components/ui/sonner";

const api = axios.create({
  const base = import.meta.env.BASE_URL || "http://localhost"; //Adjust accordingly
  const baseURL = `${base}/api`;
  withCredentials: true, // if using cookies for auth
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

export default api;
