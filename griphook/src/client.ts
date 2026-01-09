import axios, { AxiosInstance, AxiosError, Method } from "axios";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { GriphookConfig } from "./config.js";
import { OAuthClient } from "./auth.js";

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

export class GriphookClient {
  private http: AxiosInstance;
  private oauth: OAuthClient;

  constructor(config: GriphookConfig) {
    this.oauth = new OAuthClient(config.oauth);
    this.http = axios.create({
      baseURL: config.apiBaseUrl,
      timeout: config.timeoutMs,
    });
  }

  async request<T = unknown>(method: HttpMethod, path: string, options?: {
    params?: Record<string, unknown>;
    data?: unknown;
    headers?: Record<string, string>;
  }): Promise<T> {
    const url = path.startsWith("/") ? path : `/${path}`;
    const headers: Record<string, string> = { ...(options?.headers ?? {}) };

    // Get fresh token for each request (uses cache internally)
    const token = await this.oauth.getAccessToken();
    headers["x-user-access-token"] = token;
    headers["authorization"] = `Bearer ${token}`;

    try {
      const response = await this.http.request<T>({
        method: method as Method,
        url,
        params: options?.params,
        data: options?.data,
        headers,
      });
      return response.data;
    } catch (err) {
      throw new McpError(ErrorCode.InternalError, this.formatAxiosError(err));
    }
  }

  /**
   * Get the authenticated username from the OAuth token
   */
  async getUsername(): Promise<string> {
    return this.oauth.getUsername();
  }

  private formatAxiosError(err: unknown): string {
    if (axios.isAxiosError(err)) {
      const axiosErr = err as AxiosError<{ error?: string; message?: string }>;
      const status = axiosErr.response?.status;
      const detail = axiosErr.response?.data?.error || axiosErr.response?.data?.message;
      return `HTTP ${status ?? "request failed"}: ${detail || axiosErr.message}`;
    }

    return err instanceof Error ? err.message : "Unknown error";
  }
}
