import {
  ExplicitTokenClassification,
  getBaseExplicitClassifications,
  getConfiguredMetalAddresses,
  getConfiguredMetalSymbols,
  getConfiguredStablecoinAddresses,
  getConfiguredStablecoinSymbols,
  normalizeClassificationAddress,
  TokenClassificationContext,
  TokenClassificationResult,
} from "../../config/tokenClassification";

interface ClassifiableToken {
  address: string;
  _symbol?: string;
}

interface ClassificationContextParams {
  lpTokenAddresses?: Iterable<string>;
  lendingReceiptTokenAddresses?: Iterable<string>;
  safetyReceiptTokenAddresses?: Iterable<string>;
  vaultShareTokenAddresses?: Iterable<string>;
  receiptTokenSymbols?: Iterable<string>;
  bridgeStablecoinAddresses?: Iterable<string>;
  explicitByAddress?: Map<string, ExplicitTokenClassification>;
}

const createResult = (
  classification: TokenClassificationResult["classification"],
  source: TokenClassificationResult["source"],
  confidence: TokenClassificationResult["confidence"]
): TokenClassificationResult => ({
  classification,
  source,
  confidence,
});

export const buildTokenClassificationContext = (
  params: ClassificationContextParams = {}
): TokenClassificationContext => {
  const explicitByAddress = new Map<string, ExplicitTokenClassification>(getBaseExplicitClassifications());
  params.explicitByAddress?.forEach((value, key) => {
    explicitByAddress.set(normalizeClassificationAddress(key), value);
  });

  const stablecoinAddresses = new Set<string>([
    ...getConfiguredStablecoinAddresses(),
    ...Array.from(explicitByAddress.entries())
      .filter(([, value]) => value.classification.includeInStablecoinSupply)
      .map(([key]) => key),
  ]);

  const metalAddresses = new Set<string>(getConfiguredMetalAddresses());
  const lpTokenAddresses = new Set<string>(
    Array.from(params.lpTokenAddresses || [], (address) => normalizeClassificationAddress(address)).filter(Boolean)
  );
  const lendingReceiptTokenAddresses = new Set<string>(
    Array.from(params.lendingReceiptTokenAddresses || [], (address) => normalizeClassificationAddress(address)).filter(Boolean)
  );
  const safetyReceiptTokenAddresses = new Set<string>(
    Array.from(params.safetyReceiptTokenAddresses || [], (address) => normalizeClassificationAddress(address)).filter(Boolean)
  );
  const vaultShareTokenAddresses = new Set<string>(
    Array.from(params.vaultShareTokenAddresses || [], (address) => normalizeClassificationAddress(address)).filter(Boolean)
  );
  const receiptTokenSymbols = new Set<string>(
    Array.from(params.receiptTokenSymbols || [], (symbol) => (symbol || "").trim().toUpperCase())
      .filter(Boolean)
  );
  const bridgeStablecoinAddresses = new Set<string>(
    Array.from(params.bridgeStablecoinAddresses || [], (address) => normalizeClassificationAddress(address))
      .filter(Boolean)
  );

  return {
    explicitByAddress,
    stablecoinAddresses,
    metalAddresses,
    stablecoinSymbols: getConfiguredStablecoinSymbols(),
    metalSymbols: getConfiguredMetalSymbols(),
    lpTokenAddresses,
    lendingReceiptTokenAddresses,
    safetyReceiptTokenAddresses,
    vaultShareTokenAddresses,
    receiptTokenSymbols,
    bridgeStablecoinAddresses,
  };
};

export const classifyToken = (
  token: ClassifiableToken,
  context: TokenClassificationContext
): TokenClassificationResult => {
  const address = normalizeClassificationAddress(token.address);
  const symbol = (token._symbol || "").trim().toUpperCase();

  const explicit = context.explicitByAddress.get(address);
  if (explicit) {
    return {
      classification: explicit.classification,
      source: explicit.source,
      confidence: explicit.confidence,
    };
  }

  if (context.lpTokenAddresses.has(address)) {
    return createResult(
      {
        assetClass: "lp_token",
        economicRole: "receipt",
        issuanceOrigin: "protocol_minted",
        isStablecoin: false,
        isMetal: false,
        isReceiptToken: true,
        includeInTvlUnderlying: false,
        includeInStablecoinSupply: false,
      },
      "protocol_inference",
      "high"
    );
  }

  if (context.lendingReceiptTokenAddresses.has(address)) {
    return createResult(
      {
        assetClass: "lending_receipt",
        economicRole: "receipt",
        issuanceOrigin: "protocol_minted",
        isStablecoin: false,
        isMetal: false,
        isReceiptToken: true,
        includeInTvlUnderlying: false,
        includeInStablecoinSupply: false,
      },
      "protocol_inference",
      "high"
    );
  }

  if (context.safetyReceiptTokenAddresses.has(address)) {
    return createResult(
      {
        assetClass: "safety_receipt",
        economicRole: "receipt",
        issuanceOrigin: "protocol_minted",
        isStablecoin: false,
        isMetal: false,
        isReceiptToken: true,
        includeInTvlUnderlying: false,
        includeInStablecoinSupply: false,
      },
      "protocol_inference",
      "high"
    );
  }

  if (context.vaultShareTokenAddresses.has(address)) {
    return createResult(
      {
        assetClass: "vault_share",
        economicRole: "receipt",
        issuanceOrigin: "protocol_minted",
        isStablecoin: false,
        isMetal: false,
        isReceiptToken: true,
        includeInTvlUnderlying: false,
        includeInStablecoinSupply: false,
      },
      "protocol_inference",
      "high"
    );
  }

  if (context.receiptTokenSymbols.has(symbol)) {
    return createResult(
      {
        assetClass: "vault_share",
        economicRole: "receipt",
        issuanceOrigin: "protocol_minted",
        isStablecoin: false,
        isMetal: false,
        isReceiptToken: true,
        includeInTvlUnderlying: false,
        includeInStablecoinSupply: false,
      },
      "protocol_inference",
      "medium"
    );
  }

  if (context.stablecoinAddresses.has(address)) {
    return createResult(
      {
        assetClass: "stablecoin",
        economicRole: "underlying",
        issuanceOrigin: "native",
        isStablecoin: true,
        isMetal: false,
        isReceiptToken: false,
        includeInTvlUnderlying: true,
        includeInStablecoinSupply: true,
      },
      "registry_override",
      "high"
    );
  }

  if (context.bridgeStablecoinAddresses.has(address)) {
    return createResult(
      {
        assetClass: "stablecoin",
        economicRole: "bridged_representation",
        issuanceOrigin: "bridged",
        isStablecoin: true,
        isMetal: false,
        isReceiptToken: false,
        includeInTvlUnderlying: true,
        includeInStablecoinSupply: true,
      },
      "bridge_route_inference",
      "medium"
    );
  }

  if (context.metalAddresses.has(address)) {
    return createResult(
      {
        assetClass: "metal",
        economicRole: "underlying",
        issuanceOrigin: "native",
        isStablecoin: false,
        isMetal: true,
        isReceiptToken: false,
        includeInTvlUnderlying: true,
        includeInStablecoinSupply: false,
      },
      "registry_override",
      "high"
    );
  }

  if (context.stablecoinSymbols.has(symbol)) {
    return createResult(
      {
        assetClass: "stablecoin",
        economicRole: "underlying",
        issuanceOrigin: "unknown",
        isStablecoin: true,
        isMetal: false,
        isReceiptToken: false,
        includeInTvlUnderlying: true,
        includeInStablecoinSupply: true,
      },
      "symbol_heuristic",
      "low"
    );
  }

  if (context.metalSymbols.has(symbol)) {
    return createResult(
      {
        assetClass: "metal",
        economicRole: "underlying",
        issuanceOrigin: "unknown",
        isStablecoin: false,
        isMetal: true,
        isReceiptToken: false,
        includeInTvlUnderlying: true,
        includeInStablecoinSupply: false,
      },
      "symbol_heuristic",
      "low"
    );
  }

  return createResult(
    {
      assetClass: "other",
      economicRole: "underlying",
      issuanceOrigin: "unknown",
      isStablecoin: false,
      isMetal: false,
      isReceiptToken: false,
      includeInTvlUnderlying: true,
      includeInStablecoinSupply: false,
    },
    "default",
    "low"
  );
};
