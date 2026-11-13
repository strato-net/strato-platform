import { config } from "../config";
import { parseJsonPreservingBigInts, toAddress, toBigInt } from "../utils/num";

/** One row of Cirrus's event table. */
export interface ChainEvent {
  id: number;
  address: string;
  name: string;
  blockTs: Date;
  txSender: string | null;
  args: Record<string, unknown>;
}

/**
 * What the poller knows at its position in the chain: the latest oracle
 * price per asset (USD per whole token, 1e18) and the pools the trusted
 * factories created. The dirty sets are what the next commit has to write.
 * decimals is each priced token's decimals, which turn an amount into whole
 * tokens; null for a priced asset that is not a token and so values nothing.
 */
export interface State {
  prices: Map<string, bigint>;
  decimals: Map<string, number | null>;
  pools: Map<string, [string, string]>;
  dirtyPrices: Set<string>;
  dirtyPools: Set<string>;
}

export interface Activity {
  eventId: number;
  account: string;
  blockTs: Date;
  usdWad: bigint;
}

// Array-typed attributes arrive as JSON text inside the jsonb.
const toArray = (v: unknown): unknown[] => {
  if (Array.isArray(v)) return v;
  if (typeof v !== "string" || !v.trim().startsWith("[")) return [];
  try {
    const parsed = parseJsonPreservingBigInts(v);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const setPrice = (state: State, asset: unknown, price: unknown): void => {
  const a = toAddress(asset);
  const p = toBigInt(price);
  if (!a || p === null || p <= 0n) return;
  state.prices.set(a, p);
  state.dirtyPrices.add(a);
};

/** Takes a price update or a pool creation from a trusted contract into state. */
export const learn = (e: ChainEvent, state: State): void => {
  const { sources } = config;
  const a = e.args;
  if (sources.priceOracles.has(e.address)) {
    if (e.name === "PriceUpdated") setPrice(state, a.asset, a.price);
    if (e.name === "BatchPricesUpdated") {
      const prices = toArray(a.priceValues);
      toArray(a.assets).forEach((asset, i) => setPrice(state, asset, prices[i]));
    }
  } else if (sources.poolFactories.has(e.address) && (e.name === "NewPool" || e.name === "NewPoolV3")) {
    const [pool, token0, token1] = [toAddress(a.pool), toAddress(a.tokenA), toAddress(a.tokenB)];
    if (pool && token0 && token1 && !state.pools.has(pool)) {
      state.pools.set(pool, [token0, token1]);
      state.dirtyPools.add(pool);
    }
  }
};

/**
 * The account an event moved money for and its USD value at the current
 * oracle price, or null when the event is not counted: emitted by a contract
 * outside the trusted sources, or none of its tokens is a priced token.
 */
export const activityOf = (e: ChainEvent, state: State): Activity | null => {
  const { sources } = config;
  const a = e.args;
  let account: unknown;
  // (token, amount) candidates; the first priced one values the event
  let legs: [unknown, unknown][];
  if (e.name === "Swap" && state.pools.has(e.address)) {
    // The swap's sender can be a router, so the trader is the transaction's sender.
    account = e.txSender;
    const [token0, token1] = state.pools.get(e.address)!;
    if (a.tokenIn !== undefined) {
      legs = [[a.tokenIn, a.amountIn], [a.tokenOut, a.amountOut]];
    } else {
      // PoolV3 names no tokens and signs its amounts: the positive one is the input.
      const zeroForOne = (toBigInt(a.amount0) ?? 0n) > 0n;
      legs = zeroForOne ? [[token0, a.amount0], [token1, a.amount1]] : [[token1, a.amount1], [token0, a.amount0]];
    }
  } else if (e.name === "MetalMinted" && sources.metalForges.has(e.address)) {
    account = a.buyer;
    legs = [[a.payToken, a.payAmount]];
  } else if (e.name === "DepositCompleted" && sources.bridges.has(e.address)) {
    account = a.stratoRecipient;
    legs = [[a.stratoToken, a.stratoTokenAmount]];
  } else if ((e.name === "Deposited" || e.name === "SuppliedCollateral") && sources.lendingPools.has(e.address)) {
    account = a.user;
    legs = [[a.asset, a.amount]];
  } else if (e.name === "Deposited" && sources.cdpEngines.has(e.address)) {
    account = a.owner;
    legs = [[a.asset, a.amount]];
  } else {
    return null;
  }
  const who = toAddress(account);
  if (!who) return null;
  for (const [token, amount] of legs) {
    const price = state.prices.get(toAddress(token) ?? "");
    const decimals = state.decimals.get(toAddress(token) ?? "");
    const n = toBigInt(amount);
    if (price === undefined || decimals == null || n === null) continue;
    // Amounts are in the token's smallest unit, prices per whole token
    return { eventId: e.id, account: who, blockTs: e.blockTs, usdWad: ((n < 0n ? -n : n) * price) / 10n ** BigInt(decimals) };
  }
  return null;
};
