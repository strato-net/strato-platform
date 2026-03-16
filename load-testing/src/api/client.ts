import axios, { AxiosRequestConfig } from "axios";
import { OAuthClient } from "../auth/oauth";
import { ApiClient, NodeConfig } from "../types";

function extractErrorMessage(error: any): string {
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
  return error.message || "Unknown error";
}

async function retry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
): Promise<T> {
  let lastError: Error;
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = new Error(extractErrorMessage(error));
      if (i < maxAttempts) {
        const backoffDelay = Math.min(1000 * Math.pow(2, i - 1), 10000);
        await new Promise((resolve) => setTimeout(resolve, backoffDelay));
      }
    }
  }
  throw lastError!;
}

export function createApiClient(
  baseURL: string,
  oauthClient: OAuthClient,
  timeout: number = 30000,
): ApiClient {
  const request = async <T>(
    method: "get" | "post",
    url: string,
    data?: any,
  ): Promise<T> => {
    const token = await oauthClient.getToken();
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      Authorization: `Bearer ${token}`,
    };

    const requestUrl = `${baseURL}${url}`;
    const { data: responseData } = await retry(() =>
      axios.request<T>({
        method,
        url: requestUrl,
        data,
        headers,
        timeout,
      }),
    );
    return responseData;
  };

  return {
    get: <T>(url: string) => request<T>("get", url),
    post: <T>(url: string, data?: any) => request<T>("post", url, data),
  };
}

export interface NodeClients {
  strato: ApiClient;
  bloc: ApiClient;
  nodeName: string;
}

export async function createNodeClients(node: NodeConfig): Promise<NodeClients> {
  const oauthClient = new OAuthClient(node.auth);
  await oauthClient.init();

  return {
    strato: createApiClient(`${node.url}/strato/v2.3`, oauthClient),
    bloc: createApiClient(`${node.url}/bloc/v2.2`, oauthClient),
    nodeName: node.name,
  };
}
