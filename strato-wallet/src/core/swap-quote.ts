// Pure swap types + quote math (no signing deps), safe to import in the popup UI.

export const DEFAULT_FEE_BPS = 30; // PoolFactory default when swapFeeRate is 0

export interface SwapToken {
  address: string; // lowercase hex, no 0x (Cirrus form)
  symbol: string;
  decimals: number;
  icon?: string;
}

export interface SwapPool {
  address: string; // no 0x
  isStable: boolean;
  feeBps: number;
  aToBRatio: string;
  bToARatio: string;
  reserveA: string; // base units
  reserveB: string;
  tokenA: SwapToken;
  tokenB: SwapToken;
}

/** Estimated output (base units) for swapping `amountIn` of the input token. */
export function quoteOut(pool: SwapPool, amountIn: bigint, isAToB: boolean): bigint {
  if (amountIn <= 0n) return 0n;
  const fee = (amountIn * BigInt(pool.feeBps)) / 10000n;
  const net = amountIn - fee;

  if (pool.isStable) {
    const ratio = isAToB ? pool.aToBRatio : pool.bToARatio;
    const scaled = BigInt(Math.round(parseFloat(ratio) * 1e18));
    return (net * scaled) / 10n ** 18n;
  }

  const [inRes, outRes] = isAToB
    ? [BigInt(pool.reserveA), BigInt(pool.reserveB)]
    : [BigInt(pool.reserveB), BigInt(pool.reserveA)];
  if (inRes <= 0n || outRes <= 0n) return 0n;
  return (net * outRes) / (inRes + net);
}

/** Find the pool that pairs two tokens (by address), and the swap direction. */
export function findPool(
  pools: SwapPool[],
  fromAddr: string,
  toAddr: string
): { pool: SwapPool; isAToB: boolean } | null {
  const f = fromAddr.toLowerCase();
  const t = toAddr.toLowerCase();
  for (const p of pools) {
    if (p.tokenA.address === f && p.tokenB.address === t) return { pool: p, isAToB: true };
    if (p.tokenB.address === f && p.tokenA.address === t) return { pool: p, isAToB: false };
  }
  return null;
}
