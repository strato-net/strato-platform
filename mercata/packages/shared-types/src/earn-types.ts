export interface ApySource {
  source: "lending" | "swap" | "vault" | "safety";
  apy: string;
  meta?: string;
}

export interface TokenApyEntry {
  token: string;
  apys: ApySource[];
}
