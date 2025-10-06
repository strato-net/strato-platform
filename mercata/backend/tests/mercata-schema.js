// Use module.exports to export the functions that should be
// available to use from this package.
// module.exports = { <your_function> }

// Once exported, use this statement in your scripts to use the package.
// const schemas = pm.require('@blockapps/mercata-schema');

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

// Oracle Get Prices schema
const oraclePrices = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "array",
  "items": {
    "type": "object",
    "required": ["asset", "price"],
    "properties": {
      "asset": {
        "type": "string",
        "description": "Token/asset address"
      },
      "price": {
        "type": "string",
        "description": "Current price in USD (as a string to maintain precision)"
      }
    }
  }
};

// Oracle Get Single Price schema
const oracleSinglePrice = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["asset", "price"],
  "properties": {
    "asset": {
      "type": "string",
      "description": "Token/asset address"
    },
    "price": {
      "type": "string",
      "description": "Current price in USD (as a string to maintain precision)"
    }
  }
};

// Oracle Get Price History
const oraclePriceHistory = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["data", "totalCount"],
  "properties": {
    "data": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "timestamp", "asset", "price", "blockTimestamp"],
        "properties": {
          "id": {
            "type": "string",
            "description": "Unique identifier for the price entry (event ID or 'filled-<timestamp>' for interpolated data)"
          },
          "timestamp": {
            "type": "string",
            "format": "date-time",
            "description": "ISO 8601 timestamp when the price was recorded"
          },
          "asset": {
            "type": "string",
            "description": "Asset/token address"
          },
          "price": {
            "type": "string",
            "description": "Price value in USD (as string for precision)"
          },
          "blockTimestamp": {
            "type": "string",
            "format": "date-time",
            "description": "ISO 8601 timestamp of the block when the price was recorded"
          }
        }
      }
    },
    "totalCount": {
      "type": "integer",
      "description": "Total number of price history entries"
    }
  }
};

// Get Swap Pools schema
const swapPools = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "array",
  "items": {
    "type": "object",
    "required": [
      "address",
      "poolName",
      "poolSymbol",
      "tokenA",
      "tokenB",
      "lpToken",
      "swapFeeRate",
      "lpSharePercent",
      "aToBRatio",
      "bToARatio",
      "totalLiquidityUSD",
      "tradingVolume24h",
      "apy",
      "oracleAToBRatio",
      "oracleBToARatio"
    ],
    "properties": {
      "address": {
        "type": "string",
        "description": "Pool contract address"
      },
      "poolName": {
        "type": "string",
        "description": "Pool name in TokenA-TokenB format"
      },
      "poolSymbol": {
        "type": "string",
        "description": "Pool symbol in TokenA-TokenB format"
      },
      "tokenA": {
        "type": "object",
        "required": ["address", "_name", "_symbol", "customDecimals", "_totalSupply", "balance", "price", "poolBalance", "images"],
        "properties": {
          "address": {
            "type": "string"
          },
          "_name": {
            "type": "string"
          },
          "_symbol": {
            "type": "string"
          },
          "customDecimals": {
            "type": "integer",
            "minimum": 0
          },
          "_totalSupply": {
            "type": "string"
          },
          "balance": {
            "type": "string",
            "description": "User balance of this token"
          },
          "price": {
            "type": "string",
            "description": "Token price in USD"
          },
          "poolBalance": {
            "type": "string",
            "description": "Pool's balance of this token"
          },
          "images": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["value"],
              "properties": {
                "value": {
                  "type": "string"
                }
              }
            }
          }
        }
      },
      "tokenB": {
        "type": "object",
        "required": ["address", "_name", "_symbol", "customDecimals", "_totalSupply", "balance", "price", "poolBalance", "images"],
        "properties": {
          "address": {
            "type": "string"
          },
          "_name": {
            "type": "string"
          },
          "_symbol": {
            "type": "string"
          },
          "customDecimals": {
            "type": "integer",
            "minimum": 0
          },
          "_totalSupply": {
            "type": "string"
          },
          "balance": {
            "type": "string",
            "description": "User balance of this token"
          },
          "price": {
            "type": "string",
            "description": "Token price in USD"
          },
          "poolBalance": {
            "type": "string",
            "description": "Pool's balance of this token"
          },
          "images": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["value"],
              "properties": {
                "value": {
                  "type": "string"
                }
              }
            }
          }
        }
      },
      "lpToken": {
        "type": "object",
        "required": ["address", "_name", "_symbol", "customDecimals", "_totalSupply", "balance", "price", "images"],
        "properties": {
          "address": {
            "type": "string"
          },
          "_name": {
            "type": "string"
          },
          "_symbol": {
            "type": "string"
          },
          "customDecimals": {
            "type": "integer",
            "minimum": 0
          },
          "_totalSupply": {
            "type": "string",
            "description": "Total supply of LP tokens"
          },
          "balance": {
            "type": "string",
            "description": "User's LP token balance"
          },
          "price": {
            "type": "string",
            "description": "LP token price in USD"
          },
          "images": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["value"],
              "properties": {
                "value": {
                  "type": "string"
                }
              }
            }
          }
        }
      },
      "swapFeeRate": {
        "type": "number",
        "minimum": 0,
        "maximum": 10000,
        "description": "Swap fee rate in basis points"
      },
      "lpSharePercent": {
        "type": "number",
        "minimum": 0,
        "maximum": 10000,
        "description": "LP share percentage in basis points"
      },
      "aToBRatio": {
        "type": "string",
        "description": "Pool's current A to B ratio"
      },
      "bToARatio": {
        "type": "string",
        "description": "Pool's current B to A ratio"
      },
      "totalLiquidityUSD": {
        "type": "string",
        "description": "Total liquidity in USD"
      },
      "tradingVolume24h": {
        "type": "string",
        "description": "24-hour trading volume in USD"
      },
      "apy": {
        "type": "string",
        "description": "Annual percentage yield"
      },
      "oracleAToBRatio": {
        "type": "string",
        "description": "Oracle-based A to B ratio"
      },
      "oracleBToARatio": {
        "type": "string",
        "description": "Oracle-based B to A ratio"
      }
    }
  }
};

// Get Swap Pool Single schema
const swapPoolSingle = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": [
    "address",
    "poolName",
    "poolSymbol",
    "tokenA",
    "tokenB",
    "lpToken",
    "swapFeeRate",
    "lpSharePercent",
    "aToBRatio",
    "bToARatio",
    "totalLiquidityUSD",
    "tradingVolume24h",
    "apy",
    "oracleAToBRatio",
    "oracleBToARatio"
  ],
  "properties": {
    "address": {
      "type": "string",
      "description": "Pool contract address"
    },
    "poolName": {
      "type": "string",
      "description": "Pool name in TokenA-TokenB format"
    },
    "poolSymbol": {
      "type": "string",
      "description": "Pool symbol in TokenA-TokenB format"
    },
    "tokenA": {
      "type": "object",
      "required": ["address", "_name", "_symbol", "customDecimals", "_totalSupply", "balance", "price", "poolBalance", "images"],
      "properties": {
        "address": { "type": "string" },
        "_name": { "type": "string" },
        "_symbol": { "type": "string" },
        "customDecimals": { "type": "integer", "minimum": 0 },
        "_totalSupply": { "type": "string" },
        "balance": { "type": "string" },
        "price": { "type": "string" },
        "poolBalance": { "type": "string" },
        "images": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["value"],
            "properties": { "value": { "type": "string" } }
          }
        }
      }
    },
    "tokenB": {
      "type": "object",
      "required": ["address", "_name", "_symbol", "customDecimals", "_totalSupply", "balance", "price", "poolBalance", "images"],
      "properties": {
        "address": { "type": "string" },
        "_name": { "type": "string" },
        "_symbol": { "type": "string" },
        "customDecimals": { "type": "integer", "minimum": 0 },
        "_totalSupply": { "type": "string" },
        "balance": { "type": "string" },
        "price": { "type": "string" },
        "poolBalance": { "type": "string" },
        "images": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["value"],
            "properties": { "value": { "type": "string" } }
          }
        }
      }
    },
    "lpToken": {
      "type": "object",
      "required": ["address", "_name", "_symbol", "customDecimals", "_totalSupply", "balance", "price", "images"],
      "properties": {
        "address": { "type": "string" },
        "_name": { "type": "string" },
        "_symbol": { "type": "string" },
        "customDecimals": { "type": "integer", "minimum": 0 },
        "_totalSupply": { "type": "string" },
        "balance": { "type": "string" },
        "price": { "type": "string" },
        "images": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["value"],
            "properties": { "value": { "type": "string" } }
          }
        }
      }
    },
    "swapFeeRate": {
      "type": "number",
      "minimum": 0,
      "maximum": 10000
    },
    "lpSharePercent": {
      "type": "number",
      "minimum": 0,
      "maximum": 10000
    },
    "aToBRatio": { "type": "string" },
    "bToARatio": { "type": "string" },
    "totalLiquidityUSD": { "type": "string" },
    "tradingVolume24h": { "type": "string" },
    "apy": { "type": "string" },
    "oracleAToBRatio": { "type": "string" },
    "oracleBToARatio": { "type": "string" }
  }
};

// Get Swappable Tokens schema
const swapAbleTokens = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "array",
  "items": {
    "type": "object",
    "required": [
      "address",
      "_name",
      "_symbol",
      "customDecimals",
      "_totalSupply",
      "balance",
      "price",
      "poolBalance",
      "images"
    ],
    "properties": {
      "address": {
        "type": "string",
        "description": "Token contract address"
      },
      "_name": {
        "type": "string",
        "description": "Token name"
      },
      "_symbol": {
        "type": "string",
        "description": "Token symbol"
      },
      "customDecimals": {
        "type": "integer",
        "minimum": 0,
        "description": "Number of decimal places"
      },
      "_totalSupply": {
        "type": "string",
        "description": "Total supply of the token"
      },
      "balance": {
        "type": "string",
        "description": "User's balance of this token"
      },
      "price": {
        "type": "string",
        "description": "Token price in USD"
      },
      "poolBalance": {
        "type": "string",
        "description": "Pool's balance of this token"
      },
      "images": {
        "type": "array",
        "items": {
          "type": "object",
          "required": ["value"],
          "properties": {
            "value": {
              "type": "string",
              "description": "Image URL"
            }
          }
        },
        "description": "Token images (filtered to exclude empty values)"
      }
    }
  }
};

// Get Tokens which can be swapped with a given token
// @dev Currently just a list of toknes like swappable tokens
const swapTokenPairs = swapAbleTokens;

// Get User LP Token Positions schema
const swapPositions = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "array",
  "items": {
    "type": "object",
    "required": [
      "address",
      "poolName",
      "poolSymbol",
      "tokenA",
      "tokenB",
      "lpToken",
      "swapFeeRate",
      "lpSharePercent",
      "aToBRatio",
      "bToARatio",
      "totalLiquidityUSD",
      "tradingVolume24h",
      "apy",
      "oracleAToBRatio",
      "oracleBToARatio"
    ],
    "properties": {
      "address": { "type": "string" },
      "poolName": { "type": "string" },
      "poolSymbol": { "type": "string" },
      "tokenA": {
        "type": "object",
        "required": ["address", "_name", "_symbol", "customDecimals", "_totalSupply", "balance", "price", "poolBalance", "images"],
        "properties": {
          "address": { "type": "string" },
          "_name": { "type": "string" },
          "_symbol": { "type": "string" },
          "customDecimals": { "type": "integer", "minimum": 0 },
          "_totalSupply": { "type": "string" },
          "balance": { "type": "string" },
          "price": { "type": "string" },
          "poolBalance": { "type": "string" },
          "images": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["value"],
              "properties": { "value": { "type": "string" } }
            }
          }
        }
      },
      "tokenB": {
        "type": "object",
        "required": ["address", "_name", "_symbol", "customDecimals", "_totalSupply", "balance", "price", "poolBalance", "images"],
        "properties": {
          "address": { "type": "string" },
          "_name": { "type": "string" },
          "_symbol": { "type": "string" },
          "customDecimals": { "type": "integer", "minimum": 0 },
          "_totalSupply": { "type": "string" },
          "balance": { "type": "string" },
          "price": { "type": "string" },
          "poolBalance": { "type": "string" },
          "images": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["value"],
              "properties": { "value": { "type": "string" } }
            }
          }
        }
      },
      "lpToken": {
        "type": "object",
        "required": ["address", "_name", "_symbol", "customDecimals", "_totalSupply", "balance", "price", "images"],
        "properties": {
          "address": { "type": "string" },
          "_name": { "type": "string" },
          "_symbol": { "type": "string" },
          "customDecimals": { "type": "integer", "minimum": 0 },
          "_totalSupply": { "type": "string" },
          "balance": { "type": "string" },
          "price": { "type": "string" },
          "images": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["value"],
              "properties": { "value": { "type": "string" } }
            }
          }
        }
      },
      "swapFeeRate": { "type": "number", "minimum": 0, "maximum": 10000 },
      "lpSharePercent": { "type": "number", "minimum": 0, "maximum": 10000 },
      "aToBRatio": { "type": "string" },
      "bToARatio": { "type": "string" },
      "totalLiquidityUSD": { "type": "string" },
      "tradingVolume24h": { "type": "string" },
      "apy": { "type": "string" },
      "oracleAToBRatio": { "type": "string" },
      "oracleBToARatio": { "type": "string" }
    }
  }
};

// Get Swap Pool Swap History schema
const swapHistory = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["data", "totalCount"],
  "properties": {
    "data": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "id",
          "timestamp",
          "tokenIn",
          "tokenOut",
          "amountIn",
          "amountOut",
          "impliedPrice",
          "sender"
        ],
        "properties": {
          "id": {
            "type": "integer",
            "description": "Unique swap event ID"
          },
          "timestamp": {
            "type": "string",
            "format": "date-time",
            "description": "ISO 8601 timestamp of the swap"
          },
          "tokenIn": {
            "type": "string",
            "description": "Symbol of the token being swapped in"
          },
          "tokenOut": {
            "type": "string",
            "description": "Symbol of the token being swapped out"
          },
          "amountIn": {
            "type": "string",
            "description": "Amount of tokenIn"
          },
          "amountOut": {
            "type": "string",
            "description": "Amount of tokenOut"
          },
          "impliedPrice": {
            "type": "string",
            "description": "Calculated implied price from the swap"
          },
          "sender": {
            "type": "string",
            "description": "Address of the user who executed the swap"
          }
        }
      }
    },
    "totalCount": {
      "type": "integer",
      "description": "Total number of swap history entries"
    }
  }
};

// Get Bridge Network Configs
const bridgeNetworkConfigs = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "array",
  "items": {
    "type": "object",
    "required": [
      "externalChainId",
      "chainInfo"
    ],
    "properties": {
      "externalChainId": {
        "type": "number",
        "description": "The external blockchain network ID (e.g., 1 for Ethereum mainnet, 11155111 for Sepolia)"
      },
      "chainInfo": {
        "type": "object",
        "required": [
          "custody",
          "enabled",
          "chainName",
          "depositRouter",
          "lastProcessedBlock"
        ],
        "properties": {
          "custody": {
            "type": "string",
            "description": "Address of the custody contract"
          },
          "enabled": {
            "type": "boolean",
            "description": "Whether this network is currently enabled for bridging"
          },
          "chainName": {
            "type": "string",
            "description": "Human-readable name of the blockchain network"
          },
          "depositRouter": {
            "type": "string",
            "description": "Address of the deposit router contract (with 0x prefix)"
          },
          "lastProcessedBlock": {
            "type": "string",
            "description": "The last block number processed by the bridge"
          }
        }
      }
    }
  }
};

// Bridgeable Tokens schema
const bridgeAbleTokens = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "array",
  "items": {
    "type": "object",
    "required": [
      "stratoToken",
      "stratoTokenName",
      "stratoTokenSymbol",
      "externalChainId",
      "permissions",
      "externalName",
      "externalToken",
      "externalSymbol",
      "externalDecimals",
      "maxPerTx"
    ],
    "properties": {
      "stratoToken": {
        "type": "string",
        "description": "Address of the token on the Strato blockchain"
      },
      "stratoTokenName": {
        "type": "string",
        "description": "Name of the token on Strato"
      },
      "stratoTokenSymbol": {
        "type": "string",
        "description": "Symbol of the token on Strato"
      },
      "externalChainId": {
        "type": "number",
        "description": "External blockchain network ID"
      },
      "permissions": {
        "type": "string",
        "enum": ["1", "3"],
        "description": "Bridge permissions: '1' for wrap/unwrap only, '3' for both wrap/unwrap and mint/burn"
      },
      "externalName": {
        "type": "string",
        "description": "Name of the token on the external blockchain"
      },
      "externalToken": {
        "type": "string",
        "description": "Address of the token on the external blockchain (with 0x prefix)"
      },
      "externalSymbol": {
        "type": "string",
        "description": "Symbol of the token on the external blockchain"
      },
      "externalDecimals": {
        "type": "string",
        "description": "Number of decimals for the external token"
      },
      "maxPerTx": {
        "type": "string",
        "description": "Maximum amount allowed per transaction"
      }
    }
  }
};

// Bridge Redeemable Tokens schema
const bridgeRedeemableTokens = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "array",
  "items": {
    "type": "object",
    "required": [
      "stratoToken",
      "stratoTokenName",
      "stratoTokenSymbol",
      "externalChainId",
      "permissions",
      "externalName",
      "externalToken",
      "externalSymbol",
      "externalDecimals",
      "maxPerTx"
    ],
    "properties": {
      "stratoToken": {
        "type": "string",
        "description": "Address of the token on the Strato blockchain"
      },
      "stratoTokenName": {
        "type": "string",
        "description": "Name of the token on Strato"
      },
      "stratoTokenSymbol": {
        "type": "string",
        "description": "Symbol of the token on Strato"
      },
      "externalChainId": {
        "type": "number",
        "description": "External blockchain network ID"
      },
      "permissions": {
        "type": "string",
        "enum": ["2", "3"],
        "description": "Bridge permissions: '2' for mint/burn only, '3' for both wrap/unwrap and mint/burn"
      },
      "externalName": {
        "type": "string",
        "description": "Name of the token on the external blockchain"
      },
      "externalToken": {
        "type": "string",
        "description": "Address of the token on the external blockchain (with 0x prefix)"
      },
      "externalSymbol": {
        "type": "string",
        "description": "Symbol of the token on the external blockchain"
      },
      "externalDecimals": {
        "type": "string",
        "description": "Number of decimals for the external token"
      },
      "maxPerTx": {
        "type": "string",
        "description": "Maximum amount allowed per transaction"
      }
    }
  }
};

// Bridge Withdrawal Transactions schema
const bridgeWithdrawalTransactions = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["data", "totalCount"],
  "properties": {
    "data": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "withdrawalId",
          "WithdrawalInfo",
          "block_timestamp",
          "transaction_hash",
          "stratoToken",
          "stratoTokenName",
          "stratoTokenSymbol",
          "externalName",
          "externalSymbol",
          "externalToken"
        ],
        "properties": {
          "withdrawalId": {
            "type": "number",
            "description": "Unique withdrawal ID"
          },
          "WithdrawalInfo": {
            "type": "object",
            "required": [
              "externalChainId",
              "externalRecipient",
              "stratoToken",
              "stratoTokenAmount",
              "stratoSender",
              "bridgeStatus",
              "mintUSDST",
              "timestamp",
              "requestedAt"
            ],
            "properties": {
              "externalChainId": {
                "type": "string",
                "description": "Chain ID where custody resides"
              },
              "externalRecipient": {
                "type": "string",
                "description": "External recipient address"
              },
              "stratoToken": {
                "type": "string",
                "description": "Token to burn on Strato"
              },
              "stratoTokenAmount": {
                "type": "string",
                "description": "Escrowed amount of stratoToken"
              },
              "stratoSender": {
                "type": "string",
                "description": "Strato sender address"
              },
              "bridgeStatus": {
                "type": "string",
                "description": "Bridge status (e.g., INITIATED, PENDING_REVIEW, COMPLETED, ABORTED)"
              },
              "mintUSDST": {
                "type": "boolean",
                "description": "True if burning USDST, false if unwrapping token"
              },
              "timestamp": {
                "type": "string",
                "description": "Timestamp of the withdrawal"
              },
              "requestedAt": {
                "type": "string",
                "description": "Timestamp of the withdrawal request"
              }
            }
          },
          "block_timestamp": {
            "type": "string",
            "format": "date-time",
            "description": "ISO 8601 timestamp of the block"
          },
          "transaction_hash": {
            "type": "string",
            "description": "Strato transaction hash"
          },
          "stratoToken": {
            "type": "string",
            "description": "Strato token address (enriched)"
          },
          "stratoTokenName": {
            "type": "string",
            "description": "Strato token name (enriched)"
          },
          "stratoTokenSymbol": {
            "type": "string",
            "description": "Strato token symbol (enriched)"
          },
          "externalName": {
            "type": "string",
            "description": "External token name (enriched)"
          },
          "externalSymbol": {
            "type": "string",
            "description": "External token symbol (enriched)"
          },
          "externalToken": {
            "type": "string",
            "description": "External token address (enriched)"
          }
        }
      }
    },
    "totalCount": {
      "type": "integer",
      "description": "Total number of withdrawal transactions"
    }
  }
};

// Bridege Deposit Transactions schema
const bridgeDepositTransactions = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["data", "totalCount"],
  "properties": {
    "data": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "externalChainId",
          "externalTxHash",
          "DepositInfo",
          "block_timestamp",
          "transaction_hash",
          "stratoToken",
          "stratoTokenName",
          "stratoTokenSymbol",
          "externalName",
          "externalSymbol",
          "externalToken"
        ],
        "properties": {
          "externalChainId": {
            "type": "string",
            "description": "External blockchain network ID"
          },
          "externalTxHash": {
            "type": "string",
            "description": "External chain transaction hash"
          },
          "DepositInfo": {
            "type": "object",
            "required": [
              "stratoToken",
              "stratoRecipient",
              "stratoTokenAmount",
              "externalSender",
              "bridgeStatus",
              "mintUSDST",
              "timestamp"
            ],
            "properties": {
              "stratoToken": {
                "type": "string",
                "description": "Strato token to mint"
              },
              "stratoRecipient": {
                "type": "string",
                "description": "Strato recipient address"
              },
              "stratoTokenAmount": {
                "type": "string",
                "description": "Strato token amount to mint"
              },
              "externalSender": {
                "type": "string",
                "description": "External chain sender address"
              },
              "bridgeStatus": {
                "type": "string",
                "description": "Bridge status (e.g., INITIATED, COMPLETED, ABORTED)"
              },
              "mintUSDST": {
                "type": "boolean",
                "description": "True if minting USDST, false if minting original token"
              },
              "timestamp": {
                "type": "string",
                "description": "Timestamp of the deposit"
              }
            }
          },
          "block_timestamp": {
            "type": "string",
            "format": "date-time",
            "description": "ISO 8601 timestamp of the block"
          },
          "transaction_hash": {
            "type": "string",
            "description": "Strato transaction hash"
          },
          "stratoToken": {
            "type": "string",
            "description": "Strato token address (enriched)"
          },
          "stratoTokenName": {
            "type": "string",
            "description": "Strato token name (enriched)"
          },
          "stratoTokenSymbol": {
            "type": "string",
            "description": "Strato token symbol (enriched)"
          },
          "externalName": {
            "type": "string",
            "description": "External token name (enriched)"
          },
          "externalSymbol": {
            "type": "string",
            "description": "External token symbol (enriched)"
          },
          "externalToken": {
            "type": "string",
            "description": "External token address (enriched)"
          }
        }
      }
    },
    "totalCount": {
      "type": "integer",
      "description": "Total number of deposit transactions"
    }
  }
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
  safetyModuleInfo,
  oraclePrices,
  oracleSinglePrice,
  oraclePriceHistory,
  swapPools,
  swapPoolSingle,
  swapAbleTokens,
  swapTokenPairs,
  swapPositions,
  swapHistory,
  bridgeNetworkConfigs,
  bridgeAbleTokens,
  bridgeRedeemableTokens,
  bridgeWithdrawalTransactions,
  bridgeDepositTransactions
};
