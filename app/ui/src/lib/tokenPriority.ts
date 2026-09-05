import { Token } from "@/interface";
import { usdstAddress } from "./constants";

/**
 * Get the priority of a token, use for sorting tokens
 * (e.g. in the transfer dropdown)
 *
 * Current, divides tokens into 5 priority groups:
 * 1. Native Tokens
 * 2. Collateral tokens (GOLDST, WBTC, ETH, etc)
 * 3. Special LP Tokens (MUSDST, SUSDST)
 * 4. LP Tokens (contains "LP" in symbol)
 * 5. Everything else
 *
 * To alter how tokens are prioritized throughout the app, modify this function.
 *
 * @param token The token object to prioritize
 * @returns priority number; lower means higher priority
 */
export const getTokenPriority = (token: Token): number => {
  const symbol = token?.token?._symbol || '';
  const address = token.address?.toLowerCase() || '';

  // Priority 1: USDST
  if (address === usdstAddress.toLowerCase()) return 1;

  // Priority 2: Collateral tokens (GOLDST, WBTC, etc)
  const collateralTokens = ['GOLDST', 'WBTC', 'ETH', 'SILVST'];
  if (collateralTokens.includes(symbol)) return 2;

  // Priority 3: Special LP Tokens
  const specialLpTokens = ['MUSDST', 'SUSDST', 'lendUSDST', 'safetyUSDST'];
  if (specialLpTokens.includes(symbol)) return 3;

  // Priority 4: LP Tokens (contains "LP" in symbol)
  if (symbol.includes('-LP')) return 4;

  // Priority 4: Everything else
  return 5;
};

const sortAlphabeticallyCompareFn = (a: Token, b: Token) => {
  const symbolA = a?.token?._symbol || '';
  const symbolB = b?.token?._symbol || '';
  return symbolA.localeCompare(symbolB);
};

export const sortTokensCompareFn = (a: Token, b: Token) => {
  const priorityA = getTokenPriority(a);
  const priorityB = getTokenPriority(b);

  // Sort by priority first
  if (priorityA !== priorityB) {
    return priorityA - priorityB;
  }

  // Within same priority, sort alphabetically by symbol
  return sortAlphabeticallyCompareFn(a, b);
};

/**
 * Canonical display order (by symbol) for tokens the user has no balance in,
 * used by the Dashboard "My Tokens" list. Matched case-insensitively.
 * Any symbol not listed here ("Others") is placed last.
 */
export const EARNING_ASSET_SYMBOL_ORDER: string[] = [
  // Native tokens
  "STRATO", "GOLDST", "SILVST", "USDST",
  // Yield Vaults
  "CarryETH", "CarryWBTC", "YieldUSDC","saveUSDST",
  // Wrapped tokens
  "ETH", "WBTC", "SPY", "NVDA",
  // Stable coins
  "USDC", "USDT",
  // Staking tokens
  "wstETH", "rETH", "syrupUSDC", "sUSDs",
  // Gold tokens
  "PAXG", "XAUt",
  // Other 
  "BOOE", 
  // LP tokens
  "SLP","lendUSDST", "safetyUSDST", "sUSDS-USDST-LP", "bCSPXST-USDST-LP",
  "ETH-USDST-LP", "GOLDST-USDST-LP", "syrupUSDC-USDST-LP",
  "USDT-USDC-USDST-LP",  "SILVST-USDST-LP",
];

const earningAssetSymbolRankMap = new Map(
  EARNING_ASSET_SYMBOL_ORDER.map((symbol, index) => [symbol.toLowerCase(), index])
);

/**
 * Rank for the canonical no-balance ordering; lower means higher in the list.
 * Unknown symbols ("Others") sort last.
 */
export const getEarningAssetSymbolRank = (symbol?: string): number => {
  const rank = earningAssetSymbolRankMap.get((symbol || "").toLowerCase());
  return rank === undefined ? EARNING_ASSET_SYMBOL_ORDER.length : rank;
};