export type OAuthConfig = {
  clientId: string;
  clientSecret: string;
  openIdDiscoveryUrl: string;
};

export type GriphookConfig = {
  apiBaseUrl: string;
  oauth: OAuthConfig | null;
  timeoutMs: number;
  http: {
    enabled: boolean;
    host: string;
    port: number;
    path: string;
    ssePath: string;
  };
};

function normalizeBaseUrl(value: string): string {
  if (!value) return "http://localhost:3001/api";
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return !["false", "0", "no", "off"].includes(value.toLowerCase());
}

function parsePort(value: string | undefined, defaultValue: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

function normalizePath(value: string): string {
  if (!value) return "/mcp";
  return value.startsWith("/") ? value : `/${value}`;
}

/**
 * Load OAuth configuration if all required environment variables are present.
 * Returns null if OAuth client is not configured.
 */
function loadOAuthConfig(): OAuthConfig | null {
  const clientId = process.env.OAUTH_CLIENT_ID;
  const clientSecret = process.env.OAUTH_CLIENT_SECRET;
  const openIdDiscoveryUrl = process.env.OPENID_DISCOVERY_URL;

  if (clientId && clientSecret && openIdDiscoveryUrl) {
    return { clientId, clientSecret, openIdDiscoveryUrl };
  }

  return null;
}

export function loadConfig(): GriphookConfig {
  const apiBaseUrl = normalizeBaseUrl(process.env.STRATO_API_BASE_URL || "http://localhost:3001/api");
  const timeoutEnv = Number(process.env.STRATO_HTTP_TIMEOUT_MS ?? 15000);
  const httpHost = process.env.GRIPHOOK_HTTP_HOST || "127.0.0.1";
  const httpPort = parsePort(process.env.GRIPHOOK_HTTP_PORT, 3005);
  const httpPath = normalizePath(process.env.GRIPHOOK_HTTP_PATH || "/mcp");
  const httpSsePath = normalizePath(process.env.GRIPHOOK_HTTP_SSE_PATH || `${httpPath}/events`);

  return {
    apiBaseUrl,
    oauth: loadOAuthConfig(),
    timeoutMs: Number.isFinite(timeoutEnv) ? timeoutEnv : 15000,
    http: {
      enabled: parseBoolean(process.env.GRIPHOOK_HTTP_ENABLED, true),
      host: httpHost,
      port: httpPort,
      path: httpPath,
      ssePath: httpSsePath,
    },
  };
}
