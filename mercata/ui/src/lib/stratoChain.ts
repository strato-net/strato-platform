import { defineChain, type Chain } from "viem";

export const rpcUrl =
  typeof window !== "undefined" ? `${window.location.origin}/rpc` : "";

let _chainId: number | null = null;
let _chain: Chain | null = null;

export async function initStratoChain(): Promise<Chain | null> {
  if (_chain) return _chain;
  try {
    const res = await fetch(rpcUrl || "/rpc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    });
    const { result } = await res.json();
    if (!result) return null;
    _chainId = Number(result);
    _chain = defineChain({
      id: _chainId,
      name: "STRATO",
      nativeCurrency: { decimals: 18, name: "ETH", symbol: "ETH" },
      rpcUrls: { default: { http: [rpcUrl || "/rpc"] } },
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
