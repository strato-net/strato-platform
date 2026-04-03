import axios, { AxiosRequestConfig } from "axios";
import { getBAUserToken } from "../auth/tokenProvider";
import { config } from "../config/runtimeConfig";
import { RetryConfig, ClientOptions, ApiClient } from "../../shared/types";
import { executeWithRetry } from "../../shared/core/retry";

export const extractErrorMessage = (error: any): string => {
  if (error.response?.data && typeof error.response.data === "string") {
    if (
      error.response.data.includes("Just a moment") ||
      error.response.data.includes("Cloudflare")
    ) {
      return "Cloudflare challenge detected - service temporarily blocked";
    }
  }

  if (error.response?.data) {
    const { data } = error.response;
    return (
      data.error?.message ||
      data.message ||
      (typeof data.error === "string" ? data.error : "") ||
      JSON.stringify(data)
    );
  }

  return config.api.errorCodes[error.code] || error.message || "Unknown error";
};

export const retry = async <T>(
  fn: () => Promise<T>,
  {
    maxAttempts = config.api.defaults.maxAttempts,
    logPrefix = "API",
  }: RetryConfig = {},
): Promise<T> => {
  return executeWithRetry(fn, {
    maxAttempts,
    normalizeError: (error) => new Error(extractErrorMessage(error)),
    shouldRetry: () => true,
    getDelayMs: (error, attempt) => {
      if (!error.message.includes("Cloudflare challenge")) {
        return 0;
      }

      return Math.min(1000 * Math.pow(2, attempt - 1), 30000);
    },
  });
};

const createClient = (
  baseURL: string,
  {
    authenticated = true,
    timeout = config.api.defaults.timeout,
    logPrefix = "API",
  }: ClientOptions = {},
): ApiClient => {
  const request = async <T>(
    method: "get" | "post",
    url: string,
    data?: any,
    config?: AxiosRequestConfig,
  ): Promise<T> => {
    const headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      ...config?.headers,
    };

    if (authenticated) {
      const token = await getBAUserToken();
      if (!token) throw new Error("No access token available");
      headers["Authorization"] = `Bearer ${token}`;
    }

    const requestUrl = baseURL ? `${baseURL}${url}` : url;

    const { data: responseData } = await retry(
      () =>
        axios.request<T>({
          method,
          url: requestUrl,
          data,
          headers,
          timeout,
          ...config,
        }),
      { logPrefix },
    );

    return responseData;
  };

  return {
    get: <T>(url: string, config?: AxiosRequestConfig) =>
      request<T>("get", url, undefined, config),

    post: <T>(url: string, data?: any, config?: AxiosRequestConfig) =>
      request<T>("post", url, data, config),
  };
};

export const cirrus = createClient(`${config.api.nodeUrl}/cirrus/search`, {
  logPrefix: "Cirrus",
});
export const strato = createClient(`${config.api.nodeUrl}/strato/v2.3`, {
  logPrefix: "Strato",
});
export const bloc = createClient(`${config.api.nodeUrl}/bloc/v2.2`, {
  logPrefix: "Bloc",
});
export const fetch = createClient("", {
  authenticated: false,
  logPrefix: "Fetch",
});
