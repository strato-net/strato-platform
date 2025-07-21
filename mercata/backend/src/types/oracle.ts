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