import { Token } from "@/interface";
import { usdstAddress } from "./constants";

/**
 * Get the priority of a token, use for sorting tokens
 * (e.g. in the transfer dropdown)
 *
 * Current, divides tokens into 5 priority groups:
 * 1. USDST
 * 2. Collateral tokens (GOLDST, WBTCST, etc)
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

  // Priority 2: Collateral tokens (GOLDST, WBTCST, etc)
  const collateralTokens = ['GOLDST', 'WBTCST', 'ETHST', 'SILVST'];
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