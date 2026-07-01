// In-wallet token swaps against STRATO two-token AMM pools (BlockApps-Pool).
// Pools + reserves come from Cirrus; a swap is a bundled Token.approve + Pool.swap
// submitted via the BLOC flow. Quote math lives in swap-quote.ts (popup-safe).

import { type Address } from "viem";
import type { StratoNetwork } from "./networks";
import { sendBlocCalls } from "./tx-strato";
import { DEFAULT_FEE_BPS, type SwapPool, type SwapToken } from "./swap-quote";

const SWAP_GAS = { gasLimit: 32_100_000_000, gasPrice: 1 };

function base(n: StratoNetwork): string {
  return `${new URL(n.rpcUrl).origin}/cirrus/search`;
}

function tok(t: any): SwapToken | null {
  if (!t?.address) return null;
  return {
    address: String(t.address).replace(/^0x/, "").toLowerCase(),
    symbol: t._symbol ?? "?",
    decimals: Number(t.customDecimals) || 18,
    icon: Array.isArray(t.images) ? t.images[0]?.value : undefined,
  };
}

/** Active two-token pools the user can swap against. */
export async function fetchPools(network: StratoNetwork): Promise<SwapPool[]> {
  const url =
    `${base(network)}/BlockApps-Pool?isDisabled=eq.false&isPaused=eq.false` +
    `&select=address,swapFeeRate,isStable,aToBRatio::text,bToARatio::text,` +
    `tokenABalance::text,tokenBBalance::text,` +
    `tokenA:tokenA_fkey(address,_symbol,customDecimals,images:BlockApps-Token-images(value)),` +
    `tokenB:tokenB_fkey(address,_symbol,customDecimals,images:BlockApps-Token-images(value))&limit=200`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Pools fetch failed (${res.status})`);
  const rows = await res.json();
  if (!Array.isArray(rows)) return [];
  const pools: SwapPool[] = [];
  for (const r of rows) {
    const tokenA = tok(r.tokenA);
    const tokenB = tok(r.tokenB);
    if (!tokenA || !tokenB) continue; // skip degenerate pools
    pools.push({
      address: String(r.address).replace(/^0x/, "").toLowerCase(),
      isStable: !!r.isStable,
      feeBps: Number(r.swapFeeRate) || DEFAULT_FEE_BPS,
      aToBRatio: String(r.aToBRatio ?? "0"),
      bToARatio: String(r.bToARatio ?? "0"),
      reserveA: String(r.tokenABalance ?? "0"),
      reserveB: String(r.tokenBBalance ?? "0"),
      tokenA,
      tokenB,
    });
  }
  return pools;
}

export interface SwapRequest {
  poolAddress: string;
  isAToB: boolean;
  inputTokenAddress: string;
  amountIn: string; // base units
  minAmountOut: string; // base units
}

/** Build + submit approve(pool, amountIn) then swap(...) via the BLOC flow. */
export async function executeSwap(
  network: StratoNetwork,
  from: Address,
  req: SwapRequest
): Promise<any[]> {
  const deadline = Math.floor(Date.now() / 1000) + 300; // +5 min
  return sendBlocCalls(
    network,
    from,
    [
      {
        contractName: "Token",
        contractAddress: req.inputTokenAddress,
        method: "approve",
        args: { spender: req.poolAddress, value: req.amountIn },
      },
      {
        contractName: "Pool",
        contractAddress: req.poolAddress,
        method: "swap",
        args: {
          isAToB: req.isAToB,
          amountIn: req.amountIn,
          minAmountOut: req.minAmountOut,
          deadline,
        },
      },
    ],
    SWAP_GAS
  );
}
