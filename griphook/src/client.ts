import axios, { AxiosInstance, AxiosError, Method } from "axios";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { MercataMcpConfig } from "./config.js";

export type MercataHttpMethod = "get" | "post" | "put" | "patch" | "delete";

export class MercataApiClient {
  private http: AxiosInstance;
  private config: MercataMcpConfig;

  constructor(config: MercataMcpConfig) {
    this.config = config;
    this.http = axios.create({
      baseURL: config.apiBaseUrl,
      timeout: config.timeoutMs,
    });
  }

  async request<T = unknown>(method: MercataHttpMethod, path: string, options?: {
    params?: Record<string, unknown>;
    data?: unknown;
    headers?: Record<string, string>;
    tokenOverride?: string;
  }): Promise<T> {
    const url = path.startsWith("/") ? path : `/${path}`;
    const headers: Record<string, string> = { ...(options?.headers ?? {}) };
    const token = options?.tokenOverride || this.config.accessToken;

    if (token) {
      headers["x-user-access-token"] = token;
      headers["authorization"] = `Bearer ${token}`;
    }

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
