import { defineChain, type Chain } from "viem";

export const rpcUrl =
  typeof window !== "undefined" ? `${window.location.origin}/rpc` : "";

let _chainId: number | null = null;
let _chain: Chain | null = null;

type WalletLike = {
  chain?: { id?: number };
  switchChain?: (args: { id: number }) => Promise<unknown>;
  addChain?: (args: { chain: Chain }) => Promise<unknown>;
  request?: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

type AddEthereumChainParameter = {
  chainId: `0x${string}`;
  chainName: string;
  nativeCurrency: Chain["nativeCurrency"];
  rpcUrls: string[];
  blockExplorerUrls?: string[];
};

function toChainIdHex(chainId: number): `0x${string}` {
  return `0x${chainId.toString(16)}`;
}

function hasErrorCode(error: unknown, code: number, seen = new Set<unknown>()): boolean {
  if (!error || typeof error !== "object") return false;
  if (seen.has(error)) return false;
  seen.add(error);

  const err = error as {
    code?: unknown;
    cause?: unknown;
    data?: unknown;
    error?: unknown;
    originalError?: unknown;
  };
  if (err.code === code) return true;
  return (
    hasErrorCode(err.cause, code, seen) ||
    hasErrorCode(err.data, code, seen) ||
    hasErrorCode(err.error, code, seen) ||
    hasErrorCode(err.originalError, code, seen)
  );
}

function isUnknownChainError(error: unknown): boolean {
  return hasErrorCode(error, 4902);
}

function getInitializedStratoChain(): Chain {
  if (!_chain) throw new Error("STRATO chain not initialized");
  return _chain;
}

function getAddEthereumChainParameter(chain: Chain): AddEthereumChainParameter {
  const blockExplorerUrl = chain.blockExplorers?.default?.url;
  return {
    chainId: toChainIdHex(chain.id),
    chainName: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: chain.rpcUrls.default.http,
    ...(blockExplorerUrl ? { blockExplorerUrls: [blockExplorerUrl] } : {}),
  };
}

async function switchWalletChain(walletClient: WalletLike, chain: Chain) {
  if (walletClient.switchChain) {
    await walletClient.switchChain({ id: chain.id });
    return;
  }
  if (walletClient.request) {
    await walletClient.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: toChainIdHex(chain.id) }],
    });
    return;
  }
  throw new Error("Connected wallet does not support network switching");
}

async function addWalletChain(walletClient: WalletLike, chain: Chain) {
  if (walletClient.addChain) {
    await walletClient.addChain({ chain });
    return;
  }
  if (walletClient.request) {
    await walletClient.request({
      method: "wallet_addEthereumChain",
      params: [getAddEthereumChainParameter(chain)],
    });
    return;
  }
  throw new Error("Connected wallet does not support adding networks");
}

export async function ensureStratoChainInWallet(walletClient: WalletLike | null | undefined) {
  if (!walletClient) throw new Error("No wallet client available");
  const chain = getInitializedStratoChain();
  if (walletClient.chain?.id === chain.id) return;

  try {
    await switchWalletChain(walletClient, chain);
  } catch (error) {
    if (!isUnknownChainError(error)) throw error;
    await addWalletChain(walletClient, chain);
    await switchWalletChain(walletClient, chain);
  }
}

export async function initStratoChain(): Promise<Chain | null> {
  if (_chain) return _chain;
  try {
    const env = (window as { ENV?: { CHAIN_ID?: number; NETWORK_NAME?: string } }).ENV;
    const chainId = env?.CHAIN_ID;
    if (!chainId) {
      return null;
    }
    _chainId = chainId;

    const networkName = env?.NETWORK_NAME || "";
    const isProduction = networkName === "upquark";
    const chainLabel = networkName ? `STRATO ${networkName}` : "STRATO";
    const explorerUrl = isProduction
      ? "https://stratoscan.strato.nexus"
      : "https://stratoscan.testnet.stratomercata.com";

    _chain = defineChain({
      id: _chainId,
      name: chainLabel,
      nativeCurrency: { decimals: 18, name: "tUSDST", symbol: "tUSDST" },
      rpcUrls: { default: { http: [rpcUrl || "/rpc"] } },
      blockExplorers: { default: { name: "Stratoscan", url: explorerUrl } },
    });
    return _chain;
  } catch {
    return null;
  }
}

export function getStratoChain(): Chain | null {
  return _chain;
}

export function getStratoChainId(): number | null {
  return _chainId;
}
