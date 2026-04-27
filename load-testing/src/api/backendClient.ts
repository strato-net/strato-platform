import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import { OAuthClient } from "../auth/oauth";
import { AuthConfig } from "../types";

export interface BackendRequestResult {
  status: number;
  durationMs: number;
  data?: any;
  error?: string;
}

export class BackendClient {
  private axios: AxiosInstance;
  private oauth: OAuthClient | null;

  /**
   * `auth` accepts either:
   *   - an `AuthConfig` (the legacy form — a fresh OAuthClient is created
   *     internally), OR
   *   - a pre-built `OAuthClient` instance, which lets multiple BackendClients
   *     share one Keycloak session + one cached bearer + one in-flight refresh.
   *     This is the recommended form when `concurrentUsers` exceeds the size
   *     of the `users` pool — sharing prevents Keycloak's per-user grant rate
   *     limit from kicking in under concurrency.
   *   - `null` to disable auth entirely.
   */
  constructor(
    baseUrl: string,
    auth: OAuthClient | AuthConfig | null,
    timeoutMs: number = 60000,
  ) {
    this.axios = axios.create({
      baseURL: baseUrl.replace(/\/$/, ""),
      timeout: timeoutMs,
      validateStatus: () => true,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
    });
    if (auth instanceof OAuthClient) {
      this.oauth = auth;
    } else if (auth) {
      this.oauth = new OAuthClient(auth);
    } else {
      this.oauth = null;
    }
  }

  async init(): Promise<void> {
    if (this.oauth) {
      await this.oauth.init();
    }
  }

  async getToken(): Promise<string | null> {
    if (!this.oauth) return null;
    return this.oauth.getToken();
  }

  async request(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    opts: {
      body?: any;
      query?: Record<string, string | number | boolean>;
      auth?: boolean;
      headers?: Record<string, string>;
      walletAddress?: string;
    } = {},
  ): Promise<BackendRequestResult> {
    const config: AxiosRequestConfig = {
      method,
      url: path,
      params: opts.query,
      data: opts.body,
      headers: { ...(opts.headers ?? {}) },
    };

    if (opts.auth && this.oauth) {
      const token = await this.oauth.getToken();
      (config.headers as any)["Authorization"] = `Bearer ${token}`;
      if (opts.walletAddress) {
        (config.headers as any)["x-wallet-address"] = opts.walletAddress;
      }
    }

    const start = Date.now();
    try {
      const res = await this.axios.request(config);
      const durationMs = Date.now() - start;
      const data = res.data;
      const isSuccess = res.status >= 200 && res.status < 400;
      return {
        status: res.status,
        durationMs,
        data,
        error: isSuccess ? undefined : extractErrorMessage(data, res.status),
      };
    } catch (err: any) {
      const durationMs = Date.now() - start;
      return {
        status: 0,
        durationMs,
        error: err.message || String(err),
      };
    }
  }
}

function extractErrorMessage(data: any, status: number): string {
  if (!data) return `HTTP ${status}`;
  if (typeof data === "string") return data.substring(0, 500);
  return (
    data?.error?.message ||
    data?.message ||
    (typeof data?.error === "string" ? data.error : "") ||
    JSON.stringify(data).substring(0, 500)
  );
}