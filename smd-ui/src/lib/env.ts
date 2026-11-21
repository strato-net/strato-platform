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
      MULTISIG_FACTORY_ADDRESS?: string;
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

const normalizeFactoryAddress = (address: unknown): string => {
  const value = typeof address === "string" ? address.replace(/^0x/i, "").toLowerCase() : "";
  return /^[0-9a-f]{40}$/.test(value) ? value : "";
};

let multisigConfigError = "";

export const runtime = {
  chainId: () => window.ENV?.CHAIN_ID ?? null,
  networkName: () => window.ENV?.NETWORK_NAME ?? "",
  rpcUrl: () => window.ENV?.RPC_URL || env.RPC_URL,
  explorerUrl: () => window.ENV?.EXPLORER_URL ?? "",
  wagmiProjectId: () => window.ENV?.WAGMI_PROJECT_ID ?? "",
  multisigFactoryAddress: () => normalizeFactoryAddress(window.ENV?.MULTISIG_FACTORY_ADDRESS),
};

export const getMultisigConfigError = (): string => multisigConfigError;

export async function loadBackendConfig(timeoutMs = 5_000): Promise<void> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch("/api/config", {
      credentials: "include",
      signal: controller.signal,
    });
    if (!response.ok) {
      multisigConfigError = "Multisig wallets could not be loaded. Refresh to try again.";
      window.ENV = { ...window.ENV, MULTISIG_FACTORY_ADDRESS: "" };
      return;
    }
    const config = (await response.json())?.data;
    const factory = normalizeFactoryAddress(config?.multisigFactory);
    multisigConfigError = factory ? "" : "The multisig wallet configuration is missing or invalid.";
    window.ENV = {
      ...window.ENV,
      MULTISIG_FACTORY_ADDRESS: factory,
    };
  } catch {
    multisigConfigError = "Multisig wallets could not be loaded. Refresh to try again.";
    window.ENV = { ...window.ENV, MULTISIG_FACTORY_ADDRESS: "" };
  } finally {
    window.clearTimeout(timeout);
  }
}
