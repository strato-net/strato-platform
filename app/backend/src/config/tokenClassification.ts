import {
  CANONICAL_METAL_SYMBOLS,
  CANONICAL_STABLECOIN_SYMBOLS,
  getCanonicalTokenRegistry,
} from "./tokenRegistry";

export type TokenAssetClass =
  | "stablecoin"
  | "metal"
  | "crypto"
  | "lp_token"
  | "vault_share"
  | "lending_receipt"
  | "safety_receipt"
  | "voucher"
  | "other";

export type TokenEconomicRole =
  | "underlying"
  | "receipt"
  | "reward"
  | "synthetic"
  | "bridged_representation"
  | "other";

export type TokenIssuanceOrigin =
  | "native"
  | "bridged"
  | "wrapped"
  | "protocol_minted"
  | "unknown";

export type TokenClassificationSource =
  | "registry_override"
  | "protocol_inference"
  | "bridge_route_inference"
  | "symbol_heuristic"
  | "default";

export type TokenClassificationConfidence = "high" | "medium" | "low";

export interface TokenClassification {
  assetClass: TokenAssetClass;
  economicRole: TokenEconomicRole;
  issuanceOrigin: TokenIssuanceOrigin;
  isStablecoin: boolean;
  isMetal: boolean;
  isReceiptToken: boolean;
  includeInTvlUnderlying: boolean;
  includeInStablecoinSupply: boolean;
}

export interface TokenClassificationResult {
  classification: TokenClassification;
  confidence: TokenClassificationConfidence;
  source: TokenClassificationSource;
}

export interface ExplicitTokenClassification extends TokenClassificationResult {
  canonicalSymbol?: string;
}

export interface TokenClassificationContext {
  explicitByAddress: Map<string, ExplicitTokenClassification>;
  stablecoinAddresses: Set<string>;
  metalAddresses: Set<string>;
  stablecoinSymbols: Set<string>;
  metalSymbols: Set<string>;
  lpTokenAddresses: Set<string>;
  lendingReceiptTokenAddresses: Set<string>;
  safetyReceiptTokenAddresses: Set<string>;
  vaultShareTokenAddresses: Set<string>;
  receiptTokenSymbols: Set<string>;
  bridgeStablecoinAddresses: Set<string>;
}

export const normalizeClassificationAddress = (value: string | undefined | null): string =>
  (value || "").toLowerCase().replace(/^0x/, "");

export const parseAddressSet = (value: string | undefined): Set<string> =>
  new Set(
    (value || "")
      .split(",")
      .map((entry) => normalizeClassificationAddress(entry.trim()))
      .filter(Boolean)
  );

export const parseSymbolSet = (value: string | undefined, defaults: string[]): Set<string> => {
  const symbols = (value || "")
    .split(",")
    .map((entry) => entry.trim().toUpperCase())
    .filter(Boolean);

  return new Set(symbols.length > 0 ? symbols : defaults);
};

export const getBaseExplicitClassifications = (): Map<string, ExplicitTokenClassification> => {
  return getCanonicalTokenRegistry();
};

export const getConfiguredStablecoinAddresses = (): Set<string> =>
  parseAddressSet(process.env.STABLECOIN_TOKEN_ADDRESSES);

export const getConfiguredMetalAddresses = (): Set<string> =>
  parseAddressSet(process.env.METAL_TOKEN_ADDRESSES);

export const getConfiguredStablecoinSymbols = (): Set<string> =>
  parseSymbolSet(process.env.STABLECOIN_SYMBOLS, [...CANONICAL_STABLECOIN_SYMBOLS]);

export const getConfiguredMetalSymbols = (): Set<string> =>
  parseSymbolSet(process.env.METAL_SYMBOLS, [...CANONICAL_METAL_SYMBOLS]);
