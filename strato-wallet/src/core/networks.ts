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
  /**
   * Small network logo shown as a badge on token icons (MetaMask-style) to
   * distinguish which chain a token lives on. Only set for EVM networks.
   */
  chainBadge?: string;
  /**
   * Test network. Hidden from the UI selectors unless "Show test networks" is
   * enabled in Settings, but always known to the background so dApps running on a
   * testnet can still discover/connect and switch the wallet to it.
   */
  testnet?: boolean;
}

// /rpc, /api/*, /bloc/*, and /strato/v2.3/* are all nginx routes on the SAME node
// origin, so derive these from the RPC URL's origin (not the raw vault server).

/** Vault signature endpoint (BLOC v2.3 signer, fronted by the node's nginx). */
export function signatureUrl(n: StratoNetwork): string {
  return `${new URL(n.rpcUrl).origin}/strato/v2.3/signature`;
}

/** Vault MPC shard endpoint (2-of-2 shard store/fetch). */
export function mpcKeyUrl(n: StratoNetwork): string {
  return `${new URL(n.rpcUrl).origin}/strato/v2.3/mpckey`;
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
  chainBadge: "https://icons.llamao.fi/icons/chains/rsz_ethereum.jpg",
};
export const BASE_NETWORK: StratoNetwork = {
  id: "base",
  name: "Base",
  kind: "evm",
  rpcUrl: "https://mainnet.base.org",
  chainId: "8453",
  explorerUrl: "https://basescan.org",
  nativeSymbol: "ETH",
  chainBadge: "https://icons.llamao.fi/icons/chains/rsz_base.jpg",
};
export const LINEA_NETWORK: StratoNetwork = {
  id: "linea",
  name: "Linea",
  kind: "evm",
  rpcUrl: "https://rpc.linea.build",
  chainId: "59144",
  explorerUrl: "https://lineascan.build",
  nativeSymbol: "ETH",
  chainBadge: "https://icons.llamao.fi/icons/chains/rsz_linea.jpg",
};

// ---- Test networks. Hidden by default (Settings → Show test networks), but
// always present in getNetworks() so dApps on a testnet can connect/switch. ----

// STRATO Helium testnet (BlockApps public testnet). Verified chainId
// 195049586845898 (0xb165855668ca) at app.testnet.strato.nexus/rpc.
export const HELIUM_NETWORK: StratoNetwork = {
  id: "strato-helium",
  name: "STRATO Helium",
  kind: "strato",
  testnet: true,
  rpcUrl: "https://app.testnet.strato.nexus/rpc",
  chainId: "195049586845898",
  blocUrl: "https://app.testnet.strato.nexus/bloc/v2.2",
  stratoApiUrl: "https://app.testnet.strato.nexus/strato-api/eth/v1.2",
  vaultUrl: "https://app.testnet.strato.nexus/strato/v2.3",
  explorerUrl: "https://stratoscan.testnet.strato.nexus",
  nativeSymbol: "USDST",
  oauthIssuer: "https://keycloak.blockapps.net/auth/realms/mercata",
  oauthClientId: "strato-wallet-extension-test",
};
export const ETHEREUM_SEPOLIA_NETWORK: StratoNetwork = {
  id: "ethereum-sepolia",
  name: "Ethereum Sepolia",
  kind: "evm",
  testnet: true,
  rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
  chainId: "11155111",
  explorerUrl: "https://sepolia.etherscan.io",
  nativeSymbol: "ETH",
  chainBadge: "https://icons.llamao.fi/icons/chains/rsz_ethereum.jpg",
};
export const BASE_SEPOLIA_NETWORK: StratoNetwork = {
  id: "base-sepolia",
  name: "Base Sepolia",
  kind: "evm",
  testnet: true,
  rpcUrl: "https://sepolia.base.org",
  chainId: "84532",
  explorerUrl: "https://sepolia.basescan.org",
  nativeSymbol: "ETH",
  chainBadge: "https://icons.llamao.fi/icons/chains/rsz_base.jpg",
};
export const LINEA_SEPOLIA_NETWORK: StratoNetwork = {
  id: "linea-sepolia",
  name: "Linea Sepolia",
  kind: "evm",
  testnet: true,
  rpcUrl: "https://rpc.sepolia.linea.build",
  chainId: "59141",
  explorerUrl: "https://sepolia.lineascan.build",
  nativeSymbol: "ETH",
  chainBadge: "https://icons.llamao.fi/icons/chains/rsz_linea.jpg",
};

/** Networks shipped with the extension. */
export const BUILTIN_NETWORKS: StratoNetwork[] = [
  DEFAULT_NETWORK,
  ETHEREUM_NETWORK,
  BASE_NETWORK,
  LINEA_NETWORK,
  HELIUM_NETWORK,
  ETHEREUM_SEPOLIA_NETWORK,
  BASE_SEPOLIA_NETWORK,
  LINEA_SEPOLIA_NETWORK,
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

// Whether test networks are shown in the UI selectors. Off by default; testnets
// are always known to the background regardless of this flag (so dApps on a
// testnet can still connect and switch the wallet to it).
const showTestnetsStore = storage.defineItem<boolean>("local:showTestnets", {
  fallback: false,
});

export async function getShowTestnets(): Promise<boolean> {
  return showTestnetsStore.getValue();
}

export async function setShowTestnets(show: boolean): Promise<void> {
  await showTestnetsStore.setValue(show);
}

/** True if this network is a test network. */
export function isTestnet(n: StratoNetwork): boolean {
  return n.testnet === true;
}

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
