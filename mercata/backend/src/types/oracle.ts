// ---------------- Oracle Types ----------------
export interface PriceHistoryEntry {
  id: string;
  timestamp: Date;
  asset: string;
  price: string;
  blockTimestamp: Date;
}

export interface PriceHistoryResponse {
  data: PriceHistoryEntry[];
  totalCount: number;
}

export interface OraclePriceEntry {
  asset: string;
  price: string;
}

export type OraclePriceMap = Map<string, string>; 