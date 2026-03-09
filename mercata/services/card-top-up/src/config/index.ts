function getExternalChainRpcUrls(): Record<string, string> {
  const raw = process.env.EXTERNAL_CHAIN_RPC_URLS;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

export const config = {
  api: {
    baseUrl: process.env.MERCATA_API_URL || "http://localhost:3001",
    timeout: 30_000,
  },
  operator: {
    clientId: process.env.OPERATOR_CLIENT_ID || "",
    clientSecret: process.env.OPERATOR_CLIENT_SECRET || "",
    discoveryUrl: process.env.OPERATOR_DISCOVERY_URL || "",
  },
  polling: {
    intervalMs: Number(process.env.POLL_INTERVAL_MS) || 5 * 60 * 1000, // 5 min default
  },
  rpcUrls: getExternalChainRpcUrls(),
};
