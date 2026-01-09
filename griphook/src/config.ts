export type MercataMcpConfig = {
  apiBaseUrl: string;
  accessToken?: string;
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

export function loadConfig(): MercataMcpConfig {
  const apiBaseUrl = normalizeBaseUrl(process.env.MERCATA_API_BASE_URL || "http://localhost:3001/api");
  const accessToken =
    process.env.MERCATA_ACCESS_TOKEN ||
    process.env.MERCATA_TOKEN ||
    process.env.X_USER_ACCESS_TOKEN;
  const timeoutEnv = Number(process.env.MERCATA_HTTP_TIMEOUT_MS ?? 15000);
  const httpHost = process.env.MERCATA_MCP_HTTP_HOST || "127.0.0.1";
  const httpPort = parsePort(process.env.MERCATA_MCP_HTTP_PORT, 3005);
  const httpPath = normalizePath(process.env.MERCATA_MCP_HTTP_PATH || "/mcp");
  const httpSsePath = normalizePath(process.env.MERCATA_MCP_HTTP_SSE_PATH || `${httpPath}/events`);

  return {
    apiBaseUrl,
    accessToken: accessToken || undefined,
    timeoutMs: Number.isFinite(timeoutEnv) ? timeoutEnv : 15000,
    http: {
      enabled: parseBoolean(process.env.MERCATA_MCP_HTTP_ENABLED, true),
      host: httpHost,
      port: httpPort,
      path: httpPath,
      ssePath: httpSsePath,
    },
  };
}
