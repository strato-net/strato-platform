import { defineChain, type Chain } from "viem";

export const rpcUrl =
  typeof window !== "undefined" ? `${window.location.origin}/rpc` : "";

let _chainId: number | null = null;
let _chain: Chain | null = null;

export async function initStratoChain(): Promise<Chain | null> {
  if (_chain) return _chain;
  try {
    const [rpcRes, metaRes] = await Promise.all([
      fetch(rpcUrl || "/rpc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      }),
      fetch("/api/config").then(r => r.json()).catch(() => null),
    ]);
    const { result } = await rpcRes.json();
    if (!result) return null;
    _chainId = Number(result);

    const networkName: string = metaRes?.data?.networkName || "";
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
