// ============================================================================
// SWAP CONSTANTS
// ============================================================================

/**
 * Contract name constants for swap-related contracts
 */
const CONTRACT_PREFIX = "BlockApps-Mercata-";

export const SWAP_CONTRACTS = {
  Token: `${CONTRACT_PREFIX}Token`,
  Pool: `${CONTRACT_PREFIX}Pool`,
  PoolFactory: `${CONTRACT_PREFIX}PoolFactory`,
  PoolSwap: `${CONTRACT_PREFIX}Pool-Swap`,
} as const;

// ============================================================================
// DATABASE SELECT FIELDS
// ============================================================================

/**
 * Base fields for token selection in database queries
 */
export const SWAP_TOKEN_SELECT_FIELDS = [
  "address",
  "_name",
  "_symbol",
  "_totalSupply::text",
  "customDecimals",
  `balances:${SWAP_CONTRACTS.Token}-_balances(user:key,balance:value::text)`,
  `images:${SWAP_CONTRACTS.Token}-images(value)`,
] as const;

/**
 * Complete fields for pool selection in database queries
 */
export const SWAP_POOL_SELECT_FIELDS = [
  "address",
  "swapFeeRate",
  "lpSharePercent",
  "aToBRatio::text", 
  "bToARatio::text",
  `tokenA:tokenA_fkey(${SWAP_TOKEN_SELECT_FIELDS.join(',')})`,
  "tokenABalance::text",
  `tokenB:tokenB_fkey(${SWAP_TOKEN_SELECT_FIELDS.join(',')})`,
  "tokenBBalance::text",
  `lpToken:lpToken_fkey(${SWAP_TOKEN_SELECT_FIELDS.join(',')})`,
] as const;

/**
 * Fields for swap history selection in database queries
 */
export const SWAP_HISTORY_SELECT_FIELDS = [
  "address",
  "id",
  "block_timestamp",
  "sender",
  "tokenIn",
  "tokenOut", 
  "amountIn::text",
  "amountOut::text",
  "pool:BlockApps-Mercata-Pool(tokenA:tokenA_fkey(address,symbol:_symbol),tokenB:tokenB_fkey(address,symbol:_symbol))"
] as const;
