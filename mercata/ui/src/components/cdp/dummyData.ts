import { parseUnits } from "ethers";
import { VaultData, AssetConfig } from "@/services/cdpService";

export const USE_DUMMY_DATA = true; // Set to false to use real data

export const DUMMY_VAULT_ADDRESSES = {
  ETHST: "0x1111111111111111111111111111111111111111",
  WBTCST: "0x2222222222222222222222222222222222222222",
  USDCST: "0x3333333333333333333333333333333333333333",
};

export const dummyVaults: VaultData[] = [
  {
    asset: DUMMY_VAULT_ADDRESSES.ETHST,
    symbol: "ETHST",
    collateralAmount: parseUnits("2.5", 18).toString(), // 2.5 ETH
    collateralAmountDecimals: 18,
    collateralValueUSD: parseUnits("6250", 18).toString(), // $2,500 per ETH = $6,250
    debtValueUSD: parseUnits("2000", 18).toString(), // $2,000 debt
    debtAmount: parseUnits("2000", 18).toString(),
    collateralizationRatio: 312.5, // (6250 / 2000) * 100
    liquidationRatio: 150,
    healthFactor: 2.08,
    stabilityFeeRate: 2.5,
    health: "healthy",
    scaledDebt: parseUnits("2000", 18).toString(),
    rateAccumulator: parseUnits("1", 27).toString(),
  },
  {
    asset: DUMMY_VAULT_ADDRESSES.WBTCST,
    symbol: "WBTCST",
    collateralAmount: parseUnits("0.15", 8).toString(), // 0.15 WBTC
    collateralAmountDecimals: 8,
    collateralValueUSD: parseUnits("9000", 18).toString(), // $60,000 per WBTC = $9,000
    debtValueUSD: parseUnits("3000", 18).toString(), // $3,000 debt
    debtAmount: parseUnits("3000", 18).toString(),
    collateralizationRatio: 300, // (9000 / 3000) * 100
    liquidationRatio: 150,
    healthFactor: 2.0,
    stabilityFeeRate: 3.2,
    health: "healthy",
    scaledDebt: parseUnits("3000", 18).toString(),
    rateAccumulator: parseUnits("1", 27).toString(),
  },
  {
    asset: DUMMY_VAULT_ADDRESSES.USDCST,
    symbol: "USDCST",
    collateralAmount: parseUnits("5000", 6).toString(), // 5,000 USDC
    collateralAmountDecimals: 6,
    collateralValueUSD: parseUnits("5000", 18).toString(), // $1 per USDC = $5,000
    debtValueUSD: parseUnits("0", 18).toString(), // No debt yet
    debtAmount: parseUnits("0", 18).toString(),
    collateralizationRatio: 0,
    liquidationRatio: 150,
    healthFactor: 0,
    stabilityFeeRate: 1.8,
    health: "healthy",
    scaledDebt: parseUnits("0", 18).toString(),
    rateAccumulator: parseUnits("1", 27).toString(),
  },
];

export const dummyAssets: AssetConfig[] = [
  {
    asset: DUMMY_VAULT_ADDRESSES.ETHST,
    symbol: "ETHST",
    stabilityFeeRate: 2.5, // 2.5% APR
    liquidationRatio: 150,
    minCR: 200,
    liquidationPenaltyBps: 500,
    closeFactorBps: 5000,
    debtFloor: parseUnits("100", 18).toString(),
    debtCeiling: parseUnits("10000000", 18).toString(),
    unitScale: parseUnits("1", 18).toString(),
    isPaused: false,
    isSupported: true,
  },
  {
    asset: DUMMY_VAULT_ADDRESSES.WBTCST,
    symbol: "WBTCST",
    stabilityFeeRate: 3.2, // 3.2% APR
    liquidationRatio: 150,
    minCR: 200,
    liquidationPenaltyBps: 500,
    closeFactorBps: 5000,
    debtFloor: parseUnits("100", 18).toString(),
    debtCeiling: parseUnits("10000000", 18).toString(),
    unitScale: parseUnits("1", 18).toString(),
    isPaused: false,
    isSupported: true,
  },
  {
    asset: DUMMY_VAULT_ADDRESSES.USDCST,
    symbol: "USDCST",
    stabilityFeeRate: 1.8, // 1.8% APR (lowest)
    liquidationRatio: 150,
    minCR: 200,
    liquidationPenaltyBps: 500,
    closeFactorBps: 5000,
    debtFloor: parseUnits("100", 18).toString(),
    debtCeiling: parseUnits("10000000", 18).toString(),
    unitScale: parseUnits("1", 18).toString(),
    isPaused: false,
    isSupported: true,
  },
];

export const dummyPrices: Record<string, string> = {
  [DUMMY_VAULT_ADDRESSES.ETHST.toLowerCase()]: parseUnits("2500", 18).toString(), // $2,500 per ETH
  [DUMMY_VAULT_ADDRESSES.WBTCST.toLowerCase()]: parseUnits("60000", 18).toString(), // $60,000 per WBTC
  [DUMMY_VAULT_ADDRESSES.USDCST.toLowerCase()]: parseUnits("1", 18).toString(), // $1 per USDC
};

export const dummyActiveTokens = [
  {
    address: DUMMY_VAULT_ADDRESSES.ETHST,
    symbol: "ETHST",
    name: "Ethereum",
    balance: parseUnits("1.5", 18).toString(), // 1.5 ETH available
    decimals: 18,
  },
  {
    address: DUMMY_VAULT_ADDRESSES.WBTCST,
    symbol: "WBTCST",
    name: "Wrapped Bitcoin",
    balance: parseUnits("0.05", 8).toString(), // 0.05 WBTC available
    decimals: 8,
  },
  {
    address: DUMMY_VAULT_ADDRESSES.USDCST,
    symbol: "USDCST",
    name: "USD Coin",
    balance: parseUnits("2000", 6).toString(), // 2,000 USDC available
    decimals: 6,
  },
];
