import { createConnector } from "wagmi";
import { type WalletDetailsParams, type Wallet } from "@rainbow-me/rainbowkit";
import { PENDING_STRATO_WALLET_CONNECT_KEY, fetchStratoUser, redirectToLogin } from "@/lib/auth";
import { type Address, type EIP1193Provider, type Hex, keccak256, toRlp } from "viem";
import { getStratoChainId, rpcUrl } from "@/lib/stratoChain";
import { env } from "@/lib/env";
import { getCsrfToken } from "@/lib/csrf";

function toMinimalHex(n: number | bigint): Hex {
  if (n === 0 || n === 0n) return "0x";
  const hex = n.toString(16);
  return `0x${hex.length % 2 ? "0" + hex : hex}` as Hex;
}

async function rpcProxy(method: string, params?: unknown[]) {
  const res = await fetch(rpcUrl || env.RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

// Server-side signing: the STRATO wallet's key lives in the vault. We send the
// transaction signing hash and the vault returns the ECDSA signature.
async function signViaVault(msgHash: Hex): Promise<{ r: Hex; s: Hex; v: number }> {
  const csrf = getCsrfToken();
  const res = await fetch(env.SIGNATURE_URL, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
    },
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

          const nonceHex = (await rpcProxy("eth_getTransactionCount", [userAddress, "latest"])) as string;
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

    on() {},
    removeListener() {},
  } as EIP1193Provider;

  return provider;
}

function normalizeAddress(address: string | undefined): Address | null {
  if (!address) return null;
  return (address.startsWith("0x") ? address : `0x${address}`) as Address;
}

function getCachedUserAddress(): Address | null {
  try {
    const user = JSON.parse(localStorage.getItem("user") || "{}");
    return normalizeAddress(user?.userAddress);
  } catch {
    return null;
  }
}

function getStoredStratoConnection(): { address: Address; chainId: number } | null {
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

    async setup(): Promise<void> {},

    async connect({ isReconnecting }: { isReconnecting?: boolean } = {}) {
      const chainId = getStratoChainId();
      if (!chainId) throw new Error("STRATO chain not initialized");

      const stored = isReconnecting ? getStoredStratoConnection() : null;
      if (stored) {
        currentAddress = stored.address;
        provider = createStratoProvider(stored.address, chainId);
        config.emitter.emit("change", { accounts: [stored.address], chainId });
        return { accounts: [stored.address], chainId };
      }

      const user = await fetchStratoUser();
      const addr = normalizeAddress(user?.userAddress);
      if (!addr) {
        sessionStorage.setItem(PENDING_STRATO_WALLET_CONNECT_KEY, "1");
        redirectToLogin();
        throw new Error("Authentication required");
      }
      try {
        localStorage.setItem("user", JSON.stringify(user));
      } catch {
        // Ignore storage errors.
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
      const stored = !currentAddress ? getStoredStratoConnection() : null;
      if (stored) currentAddress = stored.address;
      if (!provider && currentAddress && chainId) {
        provider = createStratoProvider(currentAddress, chainId);
      }
      return provider as EIP1193Provider;
    },

    async isAuthorized() {
      if (currentAddress) return true;
      const stored = getStoredStratoConnection();
      if (stored) {
        currentAddress = stored.address;
        return true;
      }
      const user = await fetchStratoUser();
      const addr = normalizeAddress(user?.userAddress);
      const chainId = getStratoChainId();
      if (!addr || !chainId) return false;
      currentAddress = addr;
      provider = createStratoProvider(addr, chainId);
      return true;
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any);
}

export function stratoWallet(): Wallet {
  return {
    id: "stratoWallet",
    name: "STRATO Wallet",
    iconUrl:
      "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='6' fill='%23001B70'/><text x='16' y='22' text-anchor='middle' fill='white' font-size='16' font-family='sans-serif'>S</text></svg>",
    iconBackground: "#001B70",
    installed: true,
    createConnector: (walletDetails: WalletDetailsParams) =>
      stratoConnector(walletDetails as unknown as Record<string, unknown>),
  };
}
