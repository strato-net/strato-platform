// Network configuration. A STRATO network bundles the EVM JSON-RPC endpoint
// (used for read methods and eth_sendRawTransaction) together with the STRATO
// BLOC / strato-api / vault endpoints used by the native transaction flow.
//
// chainId is per-network and configurable — never hardcode a production value.
// Conventions follow smd-ui/src/lib/stratoChain.ts (rpc at <origin>/rpc, 18-dec
// STRATO native currency, Stratoscan explorer).

import { storage } from "wxt/storage";

export interface StratoNetwork {
  /** Stable id used as the storage key for the selection. */
  id: string;
  name: string;
  /**
   * "strato" (Cirrus/BLOC/vault, swap-capable) or "evm" (generic EVM L1/L2 —
   * balances/activity via the MetaMask accounts API, no swap). Defaults to strato.
   */
  kind?: "strato" | "evm";
  /** EVM JSON-RPC endpoint, e.g. https://node.example/rpc */
  rpcUrl: string;
  /**
   * Chain id as a DECIMAL STRING. STRATO chain ids can exceed 2^53, so they must
   * not be stored as a JS number (precision loss). Convert with BigInt() when a
   * hex quantity is needed.
   */
  chainId: string;
  /** BLOC API base, e.g. https://node.example/bloc/v2.2 (STRATO path). */
  blocUrl?: string;
  /** strato-api eth base, e.g. https://node.example/strato-api/eth/v1.2 */
  stratoApiUrl?: string;
  /** Vault signature base for OAuth/remote accounts, e.g. https://node.example */
  vaultUrl?: string;
  /** Block explorer base, e.g. https://stratoscan.strato.nexus */
  explorerUrl?: string;
  /** Native gas/balance token symbol (STRATO's native unit is USDST). */
  nativeSymbol?: string;
  /**
   * OIDC issuer for "Login with STRATO" (OAuth/vault accounts), e.g.
   * https://keycloak.blockapps.net/auth/realms/mercata
   */
  oauthIssuer?: string;
  /** Keycloak client id registered for this extension (public client + PKCE). */
  oauthClientId?: string;
}

// /rpc, /api/*, /bloc/*, and /strato/v2.3/* are all nginx routes on the SAME node
// origin, so derive these from the RPC URL's origin (not the raw vault server).

/** Vault signature endpoint (BLOC v2.3 signer, fronted by the node's nginx). */
export function signatureUrl(n: StratoNetwork): string {
  return `${new URL(n.rpcUrl).origin}/strato/v2.3/signature`;
}

/** Node user-identity endpoint (maps an OAuth token -> blockchain address). */
export function userInfoUrl(n: StratoNetwork): string {
  return `${new URL(n.rpcUrl).origin}/api/user/me`;
}

// On STRATO/Mercata the native (gas/balance) token is the USDST stablecoin.
export const NATIVE_CURRENCY = {
  decimals: 18,
  name: "USDST",
  symbol: "USDST",
} as const;

// Default STRATO block explorer (Stratoscan). tx pages live at /transactions/<hash>.
export const STRATO_EXPLORER = "https://stratoscan.strato.nexus";

// Default network shipped with the extension. Visiting another STRATO dApp can
// auto-add/select its chain (see wallet_addEthereumChain in rpc-engine.ts), and
// everything here is editable in Settings.
export const DEFAULT_NETWORK: StratoNetwork = {
  id: "strato",
  name: "STRATO",
  kind: "strato",
  rpcUrl: "https://dnorwood.stratomercata.com/rpc",
  chainId: "123354377739506",
  blocUrl: "https://dnorwood.stratomercata.com/bloc/v2.2",
  stratoApiUrl: "https://dnorwood.stratomercata.com/strato-api/eth/v1.2",
  vaultUrl: "https://vault.blockapps.net:8093/strato/v2.3",
  explorerUrl: STRATO_EXPLORER,
  nativeSymbol: "USDST",
  oauthIssuer: "https://keycloak.blockapps.net/auth/realms/mercata",
  oauthClientId: "strato-wallet-extension-test",
};

// Generic EVM networks (mainly for bridging to/from STRATO). Balances + activity
// come from the MetaMask accounts API; swap is STRATO-only.
export const ETHEREUM_NETWORK: StratoNetwork = {
  id: "ethereum",
  name: "Ethereum",
  kind: "evm",
  rpcUrl: "https://ethereum-rpc.publicnode.com",
  chainId: "1",
  explorerUrl: "https://etherscan.io",
  nativeSymbol: "ETH",
};
export const BASE_NETWORK: StratoNetwork = {
  id: "base",
  name: "Base",
  kind: "evm",
  rpcUrl: "https://mainnet.base.org",
  chainId: "8453",
  explorerUrl: "https://basescan.org",
  nativeSymbol: "ETH",
};
export const LINEA_NETWORK: StratoNetwork = {
  id: "linea",
  name: "Linea",
  kind: "evm",
  rpcUrl: "https://rpc.linea.build",
  chainId: "59144",
  explorerUrl: "https://lineascan.build",
  nativeSymbol: "ETH",
};

/** Networks shipped with the extension. */
export const BUILTIN_NETWORKS: StratoNetwork[] = [
  DEFAULT_NETWORK,
  ETHEREUM_NETWORK,
  BASE_NETWORK,
  LINEA_NETWORK,
];

/** True for STRATO networks (Cirrus/BLOC/swap); false for generic EVM. */
export function isStratoNetwork(n: StratoNetwork): boolean {
  return n.kind !== "evm";
}

/** Effective native token symbol for a network. */
export function nativeSymbol(n: StratoNetwork): string {
  return n.nativeSymbol || NATIVE_CURRENCY.symbol;
}

/** Block-explorer URL for a transaction hash (empty if no explorer set). */
export function explorerTxUrl(n: StratoNetwork, hash: string): string {
  if (!n.explorerUrl || !hash) return "";
  // Stratoscan (and Etherscan-style explorers) use /tx/<hash>.
  return `${n.explorerUrl.replace(/\/$/, "")}/tx/${hash}`;
}

/** Convert a decimal chainId string to a 0x-hex quantity. */
export function chainIdToHex(chainId: string): `0x${string}` {
  return `0x${BigInt(chainId).toString(16)}`;
}

/**
 * Derive the STRATO API bases from an EVM rpc URL like `https://host/rpc`. STRATO
 * nodes co-locate /rpc, /bloc/v2.2, /strato-api/eth/v1.2 and the vault under one
 * origin, so a dApp's addChain rpcUrl is enough to wire everything up.
 */
export function deriveStratoUrls(rpcUrl: string): Partial<StratoNetwork> {
  try {
    const u = new URL(rpcUrl);
    const origin = u.origin;
    return {
      blocUrl: `${origin}/bloc/v2.2`,
      stratoApiUrl: `${origin}/strato-api/eth/v1.2`,
      vaultUrl: origin,
      // Stratoscan is a standalone explorer, not co-located with the node.
      explorerUrl: STRATO_EXPLORER,
      nativeSymbol: NATIVE_CURRENCY.symbol,
    };
  } catch {
    return {};
  }
}

const networksStore = storage.defineItem<StratoNetwork[]>("local:networks", {
  fallback: BUILTIN_NETWORKS,
});

const selectedStore = storage.defineItem<string>("local:selectedNetwork", {
  fallback: DEFAULT_NETWORK.id,
});

export async function getNetworks(): Promise<StratoNetwork[]> {
  const stored = await networksStore.getValue();
  // Ensure built-in networks are present (adds newly-shipped ones to existing
  // installs without disturbing user-added/edited networks).
  const byId = new Map(stored.map((n) => [n.id, n]));
  let changed = false;
  for (const b of BUILTIN_NETWORKS) {
    const existing = byId.get(b.id);
    if (!existing) {
      byId.set(b.id, b);
      changed = true;
    } else if (b.kind === "evm") {
      // Keep built-in EVM networks in sync with shipped defaults (e.g. a fixed
      // RPC URL); users customize the STRATO network, not these.
      const synced = { ...existing, ...b };
      if (JSON.stringify(synced) !== JSON.stringify(existing)) {
        byId.set(b.id, synced);
        changed = true;
      }
    }
  }
  const merged = [...byId.values()];
  if (changed) await networksStore.setValue(merged);
  return merged.length ? merged : [DEFAULT_NETWORK];
}

export async function getSelectedNetwork(): Promise<StratoNetwork> {
  const [list, selectedId] = await Promise.all([
    getNetworks(),
    selectedStore.getValue(),
  ]);
  return list.find((n) => n.id === selectedId) ?? list[0];
}

export async function setSelectedNetwork(id: string): Promise<void> {
  await selectedStore.setValue(id);
}

export async function upsertNetwork(network: StratoNetwork): Promise<void> {
  const list = await getNetworks();
  const idx = list.findIndex((n) => n.id === network.id);
  if (idx >= 0) list[idx] = network;
  else list.push(network);
  await networksStore.setValue(list);
}
