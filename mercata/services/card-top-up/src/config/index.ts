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
    operatorToken: process.env.OPERATOR_ACCESS_TOKEN || "",
    timeout: 30_000,
  },
  polling: {
    intervalMs: Number(process.env.POLL_INTERVAL_MS) || 5 * 60 * 1000, // 5 min default
  },
  rpcUrls: getExternalChainRpcUrls(),
};
