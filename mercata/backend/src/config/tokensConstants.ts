// ============================================================================
// TOKENS V2 CONSTANTS
// ============================================================================

/**
 * Contract name constants for tokens
 */
const CONTRACT_PREFIX = "BlockApps-";

export const TOKENS_CONTRACTS = {
  Token: `${CONTRACT_PREFIX}Token`,
} as const;

// ============================================================================
// DATABASE SELECT FIELDS
// ============================================================================

/**
 * Base fields for token selection in database queries (v2)
 */
export const TOKENS_V2_SELECT_FIELDS = [
  "address",
  "_name",
  "_symbol",
  "_owner",
  "_totalSupply::text",
  "customDecimals",
  "description",
  "status",
  "_paused",
  `images:${TOKENS_CONTRACTS.Token}-images(value)`,
  `attributes:${TOKENS_CONTRACTS.Token}-attributes(key,value)`,
] as const;

/**
 * Balances field for token selection (only include when filtering by balances)
 */
export const TOKENS_V2_BALANCES_FIELD = `balances:${TOKENS_CONTRACTS.Token}-_balances!inner(user:key,balance:value::text)`;

