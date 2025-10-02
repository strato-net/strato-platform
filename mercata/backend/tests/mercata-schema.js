// Reusable schema objects for CDP and Lending post-response scripts
// Use: const schemas = pm.require('schemas')

// Common validation functions
const hex40 = (s) => typeof s === "string" && /^[0-9a-fA-F]{40}$/.test(s);
const isUintString = (s) => typeof s === "string" && /^\d+$/.test(s);

// Base address pattern
const addressPattern = "^[0-9a-fA-F]{40}$";
const uintStringPattern = "^\\d+$";

// Common object schemas
const baseAddress = {
  type: "string",
  pattern: addressPattern
};

const baseUintString = {
  type: "string", 
  pattern: uintStringPattern
};

// Token metadata schema (used in CDP vaults, lending collateral)
const tokenMetadata = {
  type: "object",
  required: ["address", "_name", "_symbol", "_owner", "_totalSupply", "customDecimals"],
  properties: {
    address: baseAddress,
    _name: { type: "string" },
    _symbol: { type: "string" },
    _owner: baseAddress,
    _totalSupply: baseUintString,
    customDecimals: { type: "integer", minimum: 0 },
    images: {
      type: "array",
      items: {
        type: "object",
        required: ["value"],
        properties: {
          value: { type: "string" }
        }
      }
    },
    attributes: {
      type: "array",
      items: {
        type: "object",
        required: ["key", "value"],
        properties: {
          key: { type: "string" },
          value: { type: "string" }
        }
      }
    },
    balances: {
      type: "array",
      items: {
        type: "object",
        required: ["user", "balance"],
        properties: {
          user: baseAddress,
          balance: baseUintString
        }
      }
    },
    price: baseUintString
  },
  additionalProperties: true
};

// CDP VaultData schema
const cdpVaultData = {
  type: "object",
  required: [
    "asset", "symbol", "collateralAmount", "collateralAmountDecimals", "collateralValueUSD",
    "debtAmount", "debtValueUSD", "collateralizationRatio", "liquidationRatio", "healthFactor",
    "stabilityFeeRate", "health", "scaledDebt", "rateAccumulator"
  ],
  properties: {
    asset: baseAddress,
    symbol: { type: "string" },
    collateralAmount: baseUintString,
    collateralAmountDecimals: { type: "integer", minimum: 0 },
    collateralValueUSD: baseUintString,
    debtAmount: baseUintString,
    debtValueUSD: baseUintString,
    collateralizationRatio: { type: "number" },
    liquidationRatio: { type: "number" },
    healthFactor: { type: "number" },
    stabilityFeeRate: { type: "number" },
    health: { type: "string" },
    scaledDebt: baseUintString,
    rateAccumulator: baseUintString,
    borrower: { type: ["string", "null"], pattern: addressPattern }
  },
  additionalProperties: true
};

// CDP VaultData with required borrower (for liquidatable)
const cdpVaultDataWithBorrower = {
  type: "object",
  required: [
    "asset", "symbol", "collateralAmount", "collateralAmountDecimals", "collateralValueUSD",
    "debtAmount", "debtValueUSD", "collateralizationRatio", "liquidationRatio", "healthFactor",
    "stabilityFeeRate", "health", "scaledDebt", "rateAccumulator", "borrower"
  ],
  properties: {
    asset: baseAddress,
    symbol: { type: "string" },
    collateralAmount: baseUintString,
    collateralAmountDecimals: { type: "integer", minimum: 0 },
    collateralValueUSD: baseUintString,
    debtAmount: baseUintString,
    debtValueUSD: baseUintString,
    collateralizationRatio: { type: "number" },
    liquidationRatio: { type: "number" },
    healthFactor: { type: "number" },
    stabilityFeeRate: { type: "number" },
    health: { type: "string" },
    scaledDebt: baseUintString,
    rateAccumulator: baseUintString,
    borrower: { type: "string", pattern: addressPattern }
  },
  additionalProperties: true
};

// CDP AssetConfig schema
const cdpAssetConfig = {
  type: "object",
  required: [
    "asset", "symbol", "liquidationRatio", "liquidationPenaltyBps", "closeFactorBps",
    "stabilityFeeRate", "debtCeiling", "unitScale", "isSupported"
  ],
  properties: {
    asset: baseAddress,
    symbol: { type: "string" },
    liquidationRatio: { type: "number" },
    liquidationPenaltyBps: { type: "integer", minimum: 0 },
    closeFactorBps: { type: "integer", minimum: 0 },
    stabilityFeeRate: { type: "number" },
    debtFloor: baseUintString,
    debtCeiling: baseUintString,
    unitScale: baseUintString,
    isPaused: { type: "boolean" },
    isSupported: { type: "boolean" }
  },
  additionalProperties: true
};

// CDP BadDebt schema
const cdpBadDebt = {
  type: "object",
  required: ["asset", "badDebt"],
  properties: {
    asset: baseAddress,
    badDebt: baseUintString,
    symbol: { type: "string" }
  },
  additionalProperties: true
};

// CDP JuniorNote schema
const cdpJuniorNote = {
  type: "object",
  required: ["owner", "capUSDST", "entryIndex", "claimableAmount"],
  properties: {
    owner: baseAddress,
    capUSDST: baseUintString,
    entryIndex: baseUintString,
    claimableAmount: baseUintString
  },
  additionalProperties: true
};

// Lending AssetConfig schema (different from CDP)
const lendingAssetConfig = {
  type: "object",
  required: ["asset", "AssetConfig"],
  properties: {
    asset: baseAddress,
    AssetConfig: {
      type: "object",
      required: ["ltv", "interestRate", "reserveFactor", "liquidationBonus", "perSecondFactorRAY", "liquidationThreshold"],
      properties: {
        ltv: baseUintString,
        interestRate: baseUintString,
        reserveFactor: baseUintString,
        liquidationBonus: baseUintString,
        perSecondFactorRAY: baseUintString,
        liquidationThreshold: baseUintString
      }
    }
  }
};

// Lending CollateralInfo schema
const lendingCollateralInfo = {
  type: "object",
  required: [
    "address", "_name", "_symbol", "_owner", "_totalSupply", "customDecimals",
    "userBalance", "userBalanceValue", "collateralizedAmount", "collateralizedAmountValue",
    "isCollateralized", "canSupply", "maxBorrowingPower", "assetPrice", "ltv", "liquidationThreshold"
  ],
  properties: {
    address: baseAddress,
    _name: { type: "string" },
    _symbol: { type: "string" },
    _owner: baseAddress,
    _totalSupply: baseUintString,
    customDecimals: { type: "integer", minimum: 0 },
    images: { type: ["array", "null"] },
    userBalance: baseUintString,
    userBalanceValue: baseUintString,
    collateralizedAmount: baseUintString,
    collateralizedAmountValue: baseUintString,
    isCollateralized: { type: "boolean" },
    canSupply: { type: "boolean" },
    maxBorrowingPower: baseUintString,
    assetPrice: baseUintString,
    ltv: baseUintString,
    liquidationThreshold: baseUintString
  },
  additionalProperties: true
};

// Lending LiquidationEntry schema
const lendingLiquidationEntry = {
  type: "object",
  required: ["id", "user", "asset", "amount", "healthFactor", "collaterals"],
  properties: {
    id: { type: "string" },
    user: baseAddress,
    asset: baseAddress,
    assetSymbol: { type: "string" },
    amount: baseUintString,
    healthFactor: { type: "number" },
    collaterals: {
      type: "array",
      items: {
        type: "object",
        required: ["asset", "amount", "usdValue", "expectedProfit"],
        properties: {
          asset: baseAddress,
          symbol: { type: "string" },
          amount: baseUintString,
          usdValue: baseUintString,
          expectedProfit: baseUintString,
          maxRepay: baseUintString,
          liquidationBonus: { type: "integer" }
        }
      }
    },
    maxRepay: baseUintString
  },
  additionalProperties: true
};

// Safety Module Info schema
const safetyModuleInfo = {
  type: "object",
  required: [
    "totalAssets", "totalShares", "userShares", "userCooldownStart", "cooldownSeconds",
    "unstakeWindow", "exchangeRate", "canRedeem", "cooldownActive", "cooldownTimeRemaining",
    "unstakeWindowTimeRemaining"
  ],
  properties: {
    totalAssets: baseUintString,
    totalShares: baseUintString,
    userShares: baseUintString,
    userCooldownStart: baseUintString,
    cooldownSeconds: baseUintString,
    unstakeWindow: baseUintString,
    exchangeRate: baseUintString,
    canRedeem: { type: "boolean" },
    cooldownActive: { type: "boolean" },
    cooldownTimeRemaining: baseUintString,
    unstakeWindowTimeRemaining: baseUintString
  },
  additionalProperties: true
};

// Common validation functions
const validateAddresses = (data, paths) => {
  paths.forEach(path => {
    const value = path.split('.').reduce((obj, key) => obj?.[key], data);
    if (value !== undefined) {
      pm.expect(hex40(value), `Invalid address at ${path}`).to.be.true;
    }
  });
};

const validateUintStrings = (data, paths) => {
  paths.forEach(path => {
    const value = path.split('.').reduce((obj, key) => obj?.[key], data);
    if (value !== undefined) {
      pm.expect(isUintString(String(value)), `Invalid uint string at ${path}`).to.be.true;
    }
  });
};

const validateArrayItems = (array, validator, label) => {
  array.forEach((item, i) => {
    validator(item, `${label}[${i}]`);
  });
};

// Export all schemas and utilities
module.exports = {
  // Validation functions
  hex40,
  isUintString,
  validateAddresses,
  validateUintStrings,
  validateArrayItems,
  
  // Base patterns
  addressPattern,
  uintStringPattern,
  baseAddress,
  baseUintString,
  
  // Schemas
  tokenMetadata,
  cdpVaultData,
  cdpVaultDataWithBorrower,
  cdpAssetConfig,
  cdpBadDebt,
  cdpJuniorNote,
  lendingAssetConfig,
  lendingCollateralInfo,
  lendingLiquidationEntry,
  safetyModuleInfo
};
