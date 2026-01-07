export type MercataMcpConfig = {
  apiBaseUrl: string;
  accessToken?: string;
  timeoutMs: number;
};

function normalizeBaseUrl(value: string): string {
  if (!value) return "http://localhost:3001/api";
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function loadConfig(): MercataMcpConfig {
  const apiBaseUrl = normalizeBaseUrl(process.env.MERCATA_API_BASE_URL || "http://localhost:3001/api");
  const accessToken =
    process.env.MERCATA_ACCESS_TOKEN ||
    process.env.MERCATA_TOKEN ||
    process.env.X_USER_ACCESS_TOKEN;
  const timeoutEnv = Number(process.env.MERCATA_HTTP_TIMEOUT_MS ?? 15000);

  return {
    apiBaseUrl,
    accessToken: accessToken || undefined,
    timeoutMs: Number.isFinite(timeoutEnv) ? timeoutEnv : 15000,
  };
}
