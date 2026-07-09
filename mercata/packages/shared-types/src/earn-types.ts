export interface ApySource {
  source: "lending" | "swap" | "vault" | "safety" | "base" | "weighted_swap" | "vault_weighted" | "rewards" | "staking";
  apy: string;
  meta?: string;
  /** Lowercase pool address without 0x; swap sources only */
  poolAddress?: string;
}

export interface TokenApyEntry {
  token: string;
  apys: ApySource[];
}
