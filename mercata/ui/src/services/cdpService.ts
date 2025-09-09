import { api } from "@/lib/axios";
import { parseUnits } from "ethers";

// Constants for better maintainability
const USDST_DECIMALS = 18;
const DEFAULT_DECIMALS = 18;

// Helper function to get asset decimals with caching
const assetDecimalsCache = new Map<string, number>();

// Helper function to convert scientific notation to full integer string
export const convertScientificNotation = (value: string): string => {
  if (!value) return '';
  
  // Check if it's scientific notation
  if (value.includes('e+') || value.includes('e-') || value.includes('E+') || value.includes('E-')) {
    const num = parseFloat(value);
    return num.toString();
  }
  
  return value;
};

const getAssetDecimals = async (asset: string): Promise<number> => {
  if (assetDecimalsCache.has(asset)) {
    return assetDecimalsCache.get(asset)!;
  }
  
  try {
    const assetConfig = await cdpService.getAssetConfig(asset);
    const decimals = DEFAULT_DECIMALS; // Default to 18 decimals for now, could be enhanced to get actual decimals from token contract
    assetDecimalsCache.set(asset, decimals);
    return decimals;
  } catch {
    assetDecimalsCache.set(asset, DEFAULT_DECIMALS);
    return DEFAULT_DECIMALS; // Fallback to 18 decimals
  }
};

export interface VaultData {
  asset: string;                               // Collateral asset address
  symbol: string;                              // Asset symbol (e.g., "ETH", "WBTC")
  collateralAmount: string;                    // Raw integer string (wei format)
  collateralAmountDecimals: number;            // Decimals for proper formatting
  collateralValueUSD: string;                  // Raw integer string (18 decimals)
  debtAmount: string;                          // Raw integer string (18 decimals)
  debtValueUSD: string;                        // Raw integer string (18 decimals)
  collateralizationRatio: number;              // Ratio of collateral to debt (percentage)
  liquidationRatio: number;                    // Minimum required collateralization ratio
  healthFactor: number;                        // Vault health (CR / liquidationRatio)
  stabilityFeeRate: number;                    // Annual interest rate (percentage)
  health: "healthy" | "warning" | "danger";    // Health status indicator
  borrower?: string;                           // Borrower address (for liquidatable positions)
  // Raw data for precision calculations
  scaledDebt: string;                          // Raw scaled debt (wei format)
  rateAccumulator: string;                     // Current rate accumulator (RAY format)
}

export interface AssetConfig {
  asset: string;                          // Asset address
  symbol: string;                         // Asset symbol
  liquidationRatio: number;               // Minimum collateralization ratio (percentage)
  liquidationPenaltyBps: number;          // Liquidation penalty in basis points
  closeFactorBps: number;                 // Max liquidation percentage in basis points
  stabilityFeeRate: number;               // Annual interest rate (percentage)
  debtFloor: string;                      // Minimum vault debt amount
  debtCeiling: string;                    // Maximum total protocol debt for this asset
  unitScale: string;                      // Price scaling factor
  isPaused: boolean;                      // Whether asset operations are paused
  isSupported: boolean;                   // Whether asset is supported
}

export interface TransactionResponse {
  status: string;                         // Transaction status (e.g., "success")
  hash: string;                           // Transaction hash
}

export const cdpService = {
  // Get user's CDP positions/vaults
  async getVaults(): Promise<VaultData[]> {
    const response = await api.get("/cdp/vaults");
    return response.data;
  },

  // Get specific vault for an asset
  async getVault(asset: string): Promise<VaultData | null> {
    const response = await api.get(`/cdp/vaults/${asset}`);
    return response.data;
  },

  // Deposit collateral
  async deposit(asset: string, amount: string): Promise<TransactionResponse> {
    const decimals = await getAssetDecimals(asset);
    const amountWei = parseUnits(amount, decimals).toString();
    const response = await api.post("/cdp/deposit", { asset, amount: amountWei });
    return response.data;
  },

  // Withdraw collateral
  async withdraw(asset: string, amount: string): Promise<TransactionResponse> {
    const decimals = await getAssetDecimals(asset);
    const amountWei = parseUnits(amount, decimals).toString();
    const response = await api.post("/cdp/withdraw", { asset, amount: amountWei });
    return response.data;
  },

  // Get maximum withdrawable amount (simulation)
  async getMaxWithdraw(asset: string): Promise<{ maxAmount: string }> {
    const response = await api.post("/cdp/get-max-withdraw", { asset });
    return response.data;
  },

  // Withdraw maximum safe collateral
  async withdrawMax(asset: string): Promise<TransactionResponse> {
    const response = await api.post("/cdp/withdraw-max", { asset });
    return response.data;
  },

  // Get maximum mintable amount (simulation)
  async getMaxMint(asset: string): Promise<{ maxAmount: string }> {
    const response = await api.post("/cdp/get-max-mint", { asset });
    return response.data;
  },

  // Mint USDST
  async mint(asset: string, amount: string): Promise<TransactionResponse> {
    const amountWei = parseUnits(amount, USDST_DECIMALS).toString();
    const response = await api.post("/cdp/mint", { asset, amount: amountWei });
    return response.data;
  },

  // Mint maximum safe USDST
  async mintMax(asset: string): Promise<TransactionResponse> {
    const response = await api.post("/cdp/mint-max", { asset });
    return response.data;
  },

  // Repay USDST debt
  async repay(asset: string, amount: string): Promise<TransactionResponse> {
    const amountWei = parseUnits(amount, USDST_DECIMALS).toString();
    const response = await api.post("/cdp/repay", { asset, amount: amountWei });
    return response.data;
  },

  // Repay all debt for an asset
  async repayAll(asset: string): Promise<TransactionResponse> {
    const response = await api.post("/cdp/repay-all", { asset });
    return response.data;
  },

  // Execute liquidation
  async liquidate(collateralAsset: string, borrower: string, debtToCover: string): Promise<TransactionResponse> {
    const debtToCoverWei = parseUnits(debtToCover, USDST_DECIMALS).toString();
    const response = await api.post("/cdp/liquidate", { collateralAsset, borrower, debtToCover: debtToCoverWei });
    return response.data;
  },

  // Get liquidatable positions
  async getLiquidatable(): Promise<VaultData[]> {
    const response = await api.get("/cdp/liquidatable");
    return response.data;
  },

  // Get asset configuration
  async getAssetConfig(asset: string): Promise<AssetConfig | null> {
    const response = await api.get(`/cdp/config/${asset}`);
    return response.data;
  },

  // Get all supported assets
  async getSupportedAssets(): Promise<AssetConfig[]> {
    const response = await api.get("/cdp/assets");
    return response.data;
  },

  async getAssetDebtInfo(asset: string): Promise<{
    currentTotalDebt: string;
    debtFloor: string;
    debtCeiling: string;
  }> {
    const response = await api.post("/cdp/asset-debt-info", { asset });
    return response.data;
  },

  // ----- CDP Management APIs (Admin Only) -----
  
  // Set collateral asset configuration
  async setCollateralConfig(configData: {
    asset: string;
    liquidationRatio: string;
    liquidationPenaltyBps: string;
    closeFactorBps: string;
    stabilityFeeRate: string;
    debtFloor: string;
    debtCeiling: string;
    unitScale: string;
    isPaused: boolean;
  }): Promise<TransactionResponse> {
    const response = await api.post("/cdp/admin/set-collateral-config", configData);
    return response.data;
  },

  // Set multiple collateral configurations in batch
  async setCollateralConfigBatch(configs: {
    assets: string[];
    liquidationRatios: string[];
    liquidationPenaltyBpsArr: string[];
    closeFactorBpsArr: string[];
    stabilityFeeRates: string[];
    debtFloors: string[];
    debtCeilings: string[];
    unitScales: string[];
    pauses: boolean[];
  }): Promise<TransactionResponse> {
    const response = await api.post("/cdp/admin/set-collateral-config-batch", configs);
    return response.data;
  },

  // Toggle asset pause status
  async setAssetPaused(asset: string, isPaused: boolean): Promise<TransactionResponse> {
    const response = await api.post("/cdp/admin/set-asset-paused", { asset, isPaused });
    return response.data;
  },

  // Set global pause status
  async setGlobalPaused(isPaused: boolean): Promise<TransactionResponse> {
    const response = await api.post("/cdp/admin/set-global-paused", { isPaused });
    return response.data;
  },

  // Get global pause status
  async getGlobalPaused(): Promise<{ isPaused: boolean }> {
    const response = await api.get("/cdp/admin/global-paused");
    return response.data;
  },

  // Get all collateral configurations (admin view)
  async getAllCollateralConfigs(): Promise<AssetConfig[]> {
    const response = await api.get("/cdp/admin/all-configs");
    return response.data;
  },

  // ----- Registry Management APIs (Admin Only) -----
  
  // Set registry address
  async setRegistry(registryData: {
    cdpVault: string;
    cdpEngine: string;
    priceOracle: string;
    usdst: string;
    tokenFactory: string;
    feeCollector: string;
  }): Promise<TransactionResponse> {
    const response = await api.post("/cdp/admin/set-registry", registryData);
    return response.data;
  },

  // Get current registry configuration
  async getRegistryConfig(): Promise<{
    cdpVault: string;
    cdpEngine: string;
    priceOracle: string;
    usdst: string;
    tokenFactory: string;
    feeCollector: string;
  }> {
    const response = await api.get("/cdp/admin/registry-config");
    return response.data;
  },

  // Get asset global state (rateAccumulator, lastAccrual, totalScaledDebt)
  async getAssetGlobalState(asset: string): Promise<{
    rateAccumulator: string;
    lastAccrual: number;
    totalScaledDebt: string;
  }> {
    const response = await api.get(`/cdp/admin/asset-global-state/${asset}`);
    return response.data;
  },

  // Get system health metrics
  async getSystemHealth(): Promise<{
    globalPaused: boolean;
    totalAssets: number;
    totalDebt: string;
    totalCollateral: string;
    systemHealth: 'healthy' | 'warning' | 'critical';
  }> {
    const response = await api.get("/cdp/admin/system-health");
    return response.data;
  },

};
