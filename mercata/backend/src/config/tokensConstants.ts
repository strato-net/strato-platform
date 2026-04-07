// ============================================================================
// CONSTANTS
// ============================================================================

const CONTRACT_PREFIX = "BlockApps-";

export const TOKENS_CONTRACTS = {
  Token: `${CONTRACT_PREFIX}Token`,
} as const;

const TOKENS_V2_BASE_FIELDS = [
  "address",
  "_name",
  "_symbol",
  "_owner",
  "_totalSupply::text",
  "customDecimals",
  "description",
  "status",
  "_paused",
] as const;

// ============================================================================
// TYPES
// ============================================================================

export interface TokenSelectOptions {
  images?: boolean;
  imagesInner?: boolean;
  attributes?: boolean;
  attributesInner?: boolean;
  balance?: boolean;
  balanceInner?: boolean;
}

// ============================================================================
// FUNCTIONS
// ============================================================================

export const buildTokenSelectFields = (options: TokenSelectOptions = {}): string[] => {
  const fields: string[] = [...TOKENS_V2_BASE_FIELDS];
  const { Token } = TOKENS_CONTRACTS;
  
  if (options.images || options.imagesInner) {
    fields.push(`images:${Token}-images${options.imagesInner ? "!inner" : ""}(value)`);
  }
  
  if (options.attributes || options.attributesInner) {
    fields.push(`attributes:${Token}-attributes${options.attributesInner ? "!inner" : ""}(key,value)`);
  }
  
  if (options.balance || options.balanceInner) {
    fields.push(`balances:${Token}-_balances${options.balanceInner ? "!inner" : ""}(user:key,balance:value::text)`);
  }
  
  return fields;
};
