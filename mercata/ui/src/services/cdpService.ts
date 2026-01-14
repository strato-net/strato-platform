import { api } from "@/lib/axios";
import { parseUnitsWithTruncation } from "@/utils/numberUtils";
import type {
  VaultData,
  AssetConfig,
  TransactionResponse,
  BadDebt,
  JuniorNote,
} from "./cdpTypes";
import type { VaultCandidateAPI } from "./MintService";
import { apiToVaultCandidate, type VaultCandidate } from "./MintService";

export type {
  VaultData,
  AssetConfig,
  TransactionResponse,
  BadDebt,
  JuniorNote,
  VaultCandidate,
};

// Constants for better maintainability
const USDST_DECIMALS = 18;
const DEFAULT_DECIMALS = 18;

// Helper function to get asset decimals with caching
const assetDecimalsCache = new Map<string, number>();


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

export const cdpService = {
  // Get user's CDP positions/vaults
  async getVaults(): Promise<VaultData[]> {
    const response = await api.get("/cdp/vaults");
    return response.data;
  },

  async getVaultCandidates(): Promise<{ existingVaults: VaultCandidate[]; potentialVaults: VaultCandidate[] }> {
    const response = await api.get<{ existingVaults: VaultCandidateAPI[]; potentialVaults: VaultCandidateAPI[] }>("/cdp/vault-candidates");
    return {
      existingVaults: response.data.existingVaults.map(apiToVaultCandidate),
      potentialVaults: response.data.potentialVaults.map(apiToVaultCandidate),
    };
  },

  // Get specific vault for an asset
  async getVault(asset: string): Promise<VaultData | null> {
    const response = await api.get(`/cdp/vaults/${asset}`);
    return response.data;
  },

  // Deposit collateral
  async deposit(asset: string, amount: string): Promise<TransactionResponse> {
    const decimals = await getAssetDecimals(asset);
    // Use parseUnitsWithTruncation to handle amounts with too many decimal places
    const amountWei = parseUnitsWithTruncation(amount, decimals).toString();
    const response = await api.post("/cdp/deposit", { asset, amount: amountWei });
    return response.data;
  },

  // Withdraw collateral
  async withdraw(asset: string, amount: string): Promise<TransactionResponse> {
    const decimals = await getAssetDecimals(asset);
    // Use parseUnitsWithTruncation to handle amounts with too many decimal places
    const amountWei = parseUnitsWithTruncation(amount, decimals).toString();
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
    // Use parseUnitsWithTruncation to handle amounts with too many decimal places
    const amountWei = parseUnitsWithTruncation(amount, USDST_DECIMALS).toString();
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
    // Use parseUnitsWithTruncation to handle amounts with too many decimal places
    const amountWei = parseUnitsWithTruncation(amount, USDST_DECIMALS).toString();
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
    // Use parseUnitsWithTruncation to handle amounts with too many decimal places
    const debtToCoverWei = parseUnitsWithTruncation(debtToCover, USDST_DECIMALS).toString();
    const response = await api.post("/cdp/liquidate", { collateralAsset, borrower, debtToCover: debtToCoverWei });
    return response.data;
  },

  // Get liquidatable positions
  async getLiquidatable(): Promise<VaultData[]> {
    const response = await api.get("/cdp/liquidatable");
    return response.data;
  },

  // Get maximum liquidatable amount for a position
  async getMaxLiquidatable(collateralAsset: string, borrower: string): Promise<{ maxAmount: string }> {
    const response = await api.post("/cdp/max-liquidatable", {
      collateralAsset,
      borrower
    });
    return response.data;
  },

  // Get asset configuration
  async getAssetConfig(asset: string): Promise<AssetConfig | null> {
    const response = await api.get(`/cdp/config/${asset}`);
    return response.data;
  },

  // Get assets (all by default, or only supported if supportedOnly is true)
  async getAssets(supportedOnly?: boolean): Promise<AssetConfig[]> {
    const params = supportedOnly ? { supported: 'true' } : {};
    const response = await api.get("/cdp/assets", { params });
    return response.data;
  },

  // Get all supported assets (backward compatibility - calls getAssets with supportedOnly=true)
  async getSupportedAssets(): Promise<AssetConfig[]> {
    return this.getAssets(true);
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

  // Toggle asset support status
  async setAssetSupported(asset: string, supported: boolean): Promise<TransactionResponse> {
    const response = await api.post("/cdp/admin/set-asset-supported", { asset, supported });
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

  // Get bad debt for all assets
  async getBadDebt(): Promise<BadDebt[]> {
    const response = await api.get("/cdp/bad-debt");
    return response.data;
  },

  // Get junior notes for a specific account
  async getJuniorNotes(account: string): Promise<JuniorNote | null> {
    const response = await api.get(`/cdp/bad-debt/juniors/${account}`);
    return response.data;
  },

  // Open junior note
  async openJuniorNote(asset: string, amountUSDST: string): Promise<{ 
    status: string; 
    hash: string; 
    burnedUSDST?: string; 
    capUSDST?: string;
  }> {
    const response = await api.post("/cdp/bad-debt/open-junior-note", { 
      asset, 
      amountUSDST 
    });
    return response.data;
  },

  // Top up junior note
  async topUpJuniorNote(amountUSDST: string): Promise<{ 
    status: string; 
    hash: string; 
    burnedUSDST?: string; 
    capUSDST?: string;
  }> {
    const response = await api.post("/cdp/bad-debt/top-up-junior-note", { 
      amountUSDST 
    });
    return response.data;
  },

  // Claim junior note rewards
  async claimJuniorNote(): Promise<{ 
    status: string; 
    hash: string;
  }> {
    const response = await api.post("/cdp/bad-debt/claim-junior-note");
    return response.data;
  },

};
