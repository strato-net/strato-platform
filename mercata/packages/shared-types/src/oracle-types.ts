// ============================================================================
// ORACLE PRICE TYPES
// ============================================================================

/**
 * Oracle price entry from API
 */
export interface OraclePriceEntry {
  asset: string;
  price: string;
}

/**
 * Map of asset addresses to their prices
 */
export type OraclePriceMap = Map<string, string>;

// ============================================================================
// PRICE HISTORY TYPES
// ============================================================================

/**
 * Historical price entry
 */
export interface PriceHistoryEntry {
  id: string;
  timestamp: Date;
  asset: string;
  price: string;
  blockTimestamp: Date;
}

/**
 * Response containing price history data
 */
export interface PriceHistoryResponse {
  data: PriceHistoryEntry[];
  totalCount: number;
}
