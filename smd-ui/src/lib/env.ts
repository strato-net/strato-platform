// Endpoint configuration for the STRATO Management Dashboard.
// Base URLs resolve through the platform nginx (nginx-packager) which OIDC-protects
// /smd/ and proxies these paths.

declare global {
  interface Window {
    ENV?: {
      CHAIN_ID?: number | null;
      NETWORK_NAME?: string;
      RPC_URL?: string;
      EXPLORER_URL?: string;
      WAGMI_PROJECT_ID?: string;
    };
  }
}

export const env = {
  APEX_URL: "/apex-api",
  BLOC_URL: "/bloc/v2.2",
  CIRRUS_URL: "/cirrus/search",
  HEALTH_URL: "/health",
  STRATO_URL: "/strato-api/eth/v1.2",
  STRATO_URL_V23: "/strato/v2.3",
  // Vault server-side signing endpoint exposed through nginx-packager (see Phase 1B).
  SIGNATURE_URL: "/strato/v2.3/signature",
  // STRATO node JSON-RPC (requires JSONRPC_ENABLED=true in nginx-packager).
  RPC_URL: "/rpc",
} as const;

export const runtime = {
  chainId: () => window.ENV?.CHAIN_ID ?? null,
  networkName: () => window.ENV?.NETWORK_NAME ?? "",
  rpcUrl: () => window.ENV?.RPC_URL || env.RPC_URL,
  explorerUrl: () => window.ENV?.EXPLORER_URL ?? "",
  wagmiProjectId: () => window.ENV?.WAGMI_PROJECT_ID ?? "",
};
