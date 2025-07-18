// src/lib/fetch.ts
import { toast } from "@/hooks/use-toast";
import { getErrorTitle } from "./errorConfig";

// Helper: Extract error message from fetch response
function extractFetchErrorMessage(response: Response, responseData: any): string {
  console.log("error catching in fetch",responseData);
  return (
    responseData?.error?.message ||
    responseData?.message ||
    responseData?.error ||
    `HTTP ${response.status}: ${response.statusText}`
  );
}

// Global fetch wrapper with error handling
export async function fetchWithErrorHandling(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    // Handle non-2xx responses
    if (!response.ok) {
      let responseData;
      try {
        responseData = await response.json();
      } catch {
        responseData = { message: `HTTP ${response.status}: ${response.statusText}` };
      }

      const errorMessage = extractFetchErrorMessage(response, responseData);
      const errorTitle = getErrorTitle(url);

      // Show error toast
      toast({
        title: errorTitle,
        description: typeof errorMessage === "string"
          ? errorMessage
          : "An unexpected error occurred.",
        variant: "destructive",
      });

      // Handle 401 specifically
      if (response.status === 401 && !url.includes('/user/me')) {
        toast({
          title: "Session Expired",
          description: "Redirecting to login...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/login";
        }, 1500);
      }

      throw new Error(errorMessage);
    }

    return response;
  } catch (error) {
    // Handle network errors or other exceptions
    if (error instanceof TypeError && error.message.includes('fetch')) {
      const errorTitle = getErrorTitle(url);
      toast({
        title: errorTitle,
        description: "Network error. Please check your connection.",
        variant: "destructive",
      });
    }
    throw error;
  }
}

// Convenience function for JSON responses
export async function fetchJson<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetchWithErrorHandling(url, options);
  return response.json();
} 