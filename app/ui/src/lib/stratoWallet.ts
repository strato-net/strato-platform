import { createConnector } from "wagmi";
import { type WalletDetailsParams } from "@rainbow-me/rainbowkit";
import { type Wallet } from "@rainbow-me/rainbowkit";
import { PENDING_STRATO_WALLET_CONNECT_KEY, redirectToLogin } from "@/lib/auth";
import { type Address, type EIP1193Provider, type Hex, keccak256, toRlp } from "viem";
import { getStratoChainId, initStratoChain, rpcUrl } from "@/lib/stratoChain";

const EXTERNAL_WALLET_KEY = "bridge-external-wallet";

// RainbowKit shows its RETRY button the instant connect() rejects, with no
// grace period. When we hand off to the login redirect the connection is still
// in flight, so we stay pending and let the page unload instead of rejecting.
const PENDING_UNTIL_UNLOAD = new Promise<never>(() => {});

// Guards against /api/user/me hanging, which would otherwise spin forever.
const AUTH_CHECK_TIMEOUT_MS = 15_000;

let _suppressReconnect = false;

export function suppressStratoReconnect() {
  _suppressReconnect = true;
}

export function allowStratoReconnect() {
  _suppressReconnect = false;
}

export function markExternalWalletActive() {
  localStorage.setItem(EXTERNAL_WALLET_KEY, "1");
}

export function clearExternalWalletActive() {
  localStorage.removeItem(EXTERNAL_WALLET_KEY);
}

export function isExternalWalletActive(): boolean {
  return localStorage.getItem(EXTERNAL_WALLET_KEY) === "1";
}

function toMinimalHex(n: number | bigint): Hex {
  if (n === 0 || n === 0n) return "0x";
  const hex = typeof n === "bigint" ? n.toString(16) : n.toString(16);
  return `0x${hex.length % 2 ? "0" + hex : hex}` as Hex;
}

async function rpcProxy(method: string, params?: unknown[]) {
  const res = await fetch(rpcUrl || "/rpc", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

async function signViaVault(msgHash: Hex): Promise<{ r: Hex; s: Hex; v: number }> {
  const res = await fetch("/vault/signature", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ msgHash: msgHash.slice(2) }),
  });
  if (!res.ok) throw new Error(`Vault signing failed: ${res.status}`);
  const sig = await res.json();
  return { r: `0x${sig.r}` as Hex, s: `0x${sig.s}` as Hex, v: sig.v };
}

function createStratoProvider(userAddress: Address, chainId: number): EIP1193Provider {
  const chainIdHex = `0x${chainId.toString(16)}`;

  const provider: EIP1193Provider = {
    async request({ method, params }: { method: string; params?: unknown[] }) {
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          return [userAddress];

        case "eth_chainId":
          return chainIdHex;

        case "net_version":
          return String(chainId);

        case "wallet_switchEthereumChain":
          return null;

        case "eth_sendTransaction": {
          const [tx] = (params || []) as [Record<string, string>];

          const nonceHex = await rpcProxy("eth_getTransactionCount", [userAddress, "latest"]) as string;
          const nonce = parseInt(nonceHex, 16);
          const gasPrice = tx.gasPrice ? parseInt(tx.gasPrice, 16) : 0;
          const gasLimit = tx.gas ? parseInt(tx.gas, 16) : 1000000;
          const to = (tx.to || "0x") as Hex;
          const value = tx.value ? BigInt(tx.value) : 0n;
          const data = (tx.data || "0x") as Hex;

          const unsignedFields: Hex[] = [
            toMinimalHex(nonce),
            toMinimalHex(gasPrice),
            toMinimalHex(gasLimit),
            to,
            toMinimalHex(value),
            data,
            toMinimalHex(chainId),
            "0x",
            "0x",
          ];
          const signingHash = keccak256(toRlp(unsignedFields));

          const sig = await signViaVault(signingHash);
          const eip155V = chainId * 2 + 35 + sig.v;

          const signedFields: Hex[] = [
            toMinimalHex(nonce),
            toMinimalHex(gasPrice),
            toMinimalHex(gasLimit),
            to,
            toMinimalHex(value),
            data,
            toMinimalHex(eip155V),
            sig.r,
            sig.s,
          ];
          const rawTx = toRlp(signedFields);

          return rpcProxy("eth_sendRawTransaction", [rawTx]);
        }

        default:
          return rpcProxy(method, params);
      }
    },

    on(_event: string, _listener: (...args: unknown[]) => void) {},
    removeListener(_event: string, _listener: (...args: unknown[]) => void) {},
  } as EIP1193Provider;

  return provider;
}

function normalizeAddress(address: string | undefined): Address | null {
  if (!address) return null;
  return (address.startsWith("0x") ? address : `0x${address}`) as Address;
}

function stratoConnectionFrom(connection: any): { address: Address; chainId: number } | null {
  if (connection?.connector?.id !== "stratoWallet") return null;
  const address = normalizeAddress(connection?.accounts?.[0]);
  return address && connection?.chainId ? { address, chainId: connection.chainId } : null;
}

function getCachedUserAddress(): Address | null {
  try {
    const user = JSON.parse(localStorage.getItem("user") || "{}");
    return normalizeAddress(user?.userAddress);
  } catch {
    return null;
  }
}

function getStoredStratoConnection(state?: any): { address: Address; chainId: number } | null {
  const current = state?.current;
  const stateConnection = current ? state?.connections?.get?.(current) : null;
  const hydrated = stratoConnectionFrom(stateConnection);
  if (hydrated) return hydrated;

  try {
    const stored = JSON.parse(localStorage.getItem("wagmi.store") || "{}");
    const connections = stored?.state?.connections?.value;
    const current = stored?.state?.current;
    const conn = connections?.find(
      ([uid, c]: [string, any]) => uid === current && c?.connector?.id === "stratoWallet"
    )?.[1];
    const persisted = stratoConnectionFrom(conn);
    if (persisted) return persisted;
  } catch {
    const address = getCachedUserAddress();
    const chainId = getStratoChainId();
    return address && chainId ? { address, chainId } : null;
  }

  const address = getCachedUserAddress();
  const chainId = getStratoChainId();
  return address && chainId ? { address, chainId } : null;
}

function stratoConnector(walletDetails: Record<string, unknown> = {}) {
  let provider: EIP1193Provider | null = null;
  let currentAddress: Address | null = null;

  return createConnector((config) => ({
    ...walletDetails,
    id: "stratoWallet",
    name: "STRATO Wallet",
    type: "strato" as const,

    async setup() {},

    async connect({ isReconnecting } = {}) {
      let chainId = getStratoChainId();
      if (!chainId) {
        // The user can click before window.ENV has been read; init on demand
        // rather than failing the connect outright.
        await initStratoChain();
        chainId = getStratoChainId();
      }
      if (!chainId) throw new Error("STRATO chain not initialized");

      const stored = isReconnecting ? getStoredStratoConnection(config.state) : null;
      if (stored) {
        currentAddress = stored.address;
        provider = createStratoProvider(stored.address, chainId);
        config.emitter.emit("change", { accounts: [stored.address], chainId });
        return { accounts: [stored.address], chainId };
      }

      let data: any;
      try {
        const res = await fetch("/api/user/me", {
          credentials: "include",
          signal: AbortSignal.timeout(AUTH_CHECK_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error();
        data = await res.json();
      } catch {
        sessionStorage.setItem(PENDING_STRATO_WALLET_CONNECT_KEY, "1");
        redirectToLogin();
        return PENDING_UNTIL_UNLOAD;
      }
      const addr = normalizeAddress(data.userAddress);
      if (!addr) {
        sessionStorage.setItem(PENDING_STRATO_WALLET_CONNECT_KEY, "1");
        redirectToLogin();
        return PENDING_UNTIL_UNLOAD;
      }
      currentAddress = addr;
      provider = createStratoProvider(addr, chainId);
      config.emitter.emit("change", { accounts: [addr], chainId });
      return { accounts: [addr], chainId };
    },

    async disconnect() {
      provider = null;
      currentAddress = null;
      config.emitter.emit("disconnect");
    },

    async getAccounts() {
      return currentAddress ? [currentAddress] : [];
    },

    async getChainId() {
      return getStratoChainId() ?? 0;
    },

    async getProvider() {
      const chainId = getStratoChainId();
      const stored = !currentAddress ? getStoredStratoConnection(config.state) : null;
      if (stored) {
        currentAddress = stored.address;
      }
      if (!provider && currentAddress && chainId) {
        provider = createStratoProvider(currentAddress, chainId);
      }
      return provider as EIP1193Provider;
    },

    async isAuthorized() {
      if (_suppressReconnect || isExternalWalletActive()) return false;
      if (currentAddress) return true;
      const stored = getStoredStratoConnection(config.state);
      if (stored) {
        currentAddress = stored.address;
        return true;
      }
      try {
        const res = await fetch("/api/user/me", { credentials: "include" });
        if (!res.ok) return false;
        const data = await res.json();
        const addr = normalizeAddress(data.userAddress);
        if (!addr) return false;
        const chainId = getStratoChainId();
        if (!chainId) return false;
        currentAddress = addr;
        provider = createStratoProvider(addr, chainId);
        return true;
      } catch {
        return false;
      }
    },

    async switchChain({ chainId }: { chainId: number }) {
      const chain = config.chains.find((c) => c.id === chainId);
      if (!chain) throw new Error(`Chain ${chainId} not configured`);
      config.emitter.emit("change", { chainId });
      return chain;
    },

    onAccountsChanged() {},
    onChainChanged() {},
    onDisconnect() {},
  }));
}

export function stratoWallet(): Wallet {
  return {
    id: "stratoWallet",
    name: "STRATO Wallet",
    iconUrl: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='6' fill='%231a1a2e'/><text x='16' y='22' text-anchor='middle' fill='white' font-size='16' font-family='sans-serif'>S</text></svg>",
    iconBackground: "#1a1a2e",
    installed: true,
    createConnector: (walletDetails: WalletDetailsParams) =>
      stratoConnector(walletDetails as unknown as Record<string, unknown>),
  };
}
