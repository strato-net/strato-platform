import { api } from "@/lib/axios";

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
    const response = await api.post("/cdp/deposit", { asset, amount });
    return response.data;
  },

  // Withdraw collateral
  async withdraw(asset: string, amount: string): Promise<TransactionResponse> {
    const response = await api.post("/cdp/withdraw", { asset, amount });
    return response.data;
  },

  // Withdraw maximum safe collateral
  async withdrawMax(asset: string): Promise<TransactionResponse> {
    const response = await api.post("/cdp/withdraw-max", { asset });
    return response.data;
  },

  // Mint USDST
  async mint(asset: string, amount: string): Promise<TransactionResponse> {
    const response = await api.post("/cdp/mint", { asset, amount });
    return response.data;
  },

  // Mint maximum safe USDST
  async mintMax(asset: string): Promise<TransactionResponse> {
    const response = await api.post("/cdp/mint-max", { asset });
    return response.data;
  },

  // Repay USDST debt
  async repay(asset: string, amount: string): Promise<TransactionResponse> {
    const response = await api.post("/cdp/repay", { asset, amount });
    return response.data;
  },

  // Repay all debt for an asset
  async repayAll(asset: string): Promise<TransactionResponse> {
    const response = await api.post("/cdp/repay-all", { asset });
    return response.data;
  },

  // Execute liquidation
  async liquidate(collateralAsset: string, borrower: string, debtToCover: string): Promise<TransactionResponse> {
    const response = await api.post("/cdp/liquidate", { collateralAsset, borrower, debtToCover });
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
  }
};
