/**
 * CDP Service - Handles Collateralized Debt Position operations
 */

import { strato, cirrus } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { FunctionInput } from "../../types/types";
import { postAndWaitForTx } from "../../utils/txHelper";
import { extractContractName } from "../../utils/utils";
import { StratoPaths, constants } from "../../config/constants";
import { formatUnits, parseUnits } from "ethers";

// Extract constants for consistency with lending service
const {
  cdpRegistrySelectFields,
  cdpRegistry,
  CDPEngine,
  CDPVault,
  CDPRegistry,
  Token,
  PriceOracle,
} = constants;

// Constants for calculations
const RAY = BigInt(10) ** BigInt(27);
const WAD = BigInt(10) ** BigInt(18);

/**
 * Generic Cirrus fetch for the CDPRegistry row.
 * Similar to getPool() in lending service
 */
export const getCDPRegistry = async (
  accessToken: string,
  _userAddress: string | undefined,
  options: Record<string, string> = {}
): Promise<Record<string, any>> => {
  const { select, ...filters } = options;
  const cleanedFilters = Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== undefined)
  );

  const params = {
    ...cleanedFilters,
    select: select ?? cdpRegistrySelectFields.join(","),
    address: `eq.${cdpRegistry}`,
  };

  const {
    data: [registryData],
  } = await cirrus.get(accessToken, `/${CDPRegistry}`, { params });

  if (!registryData) {
    throw new Error(
      `Error fetching ${extractContractName(CDPRegistry)} data from Cirrus`
    );
  }

  return registryData;
};

// Helper function to calculate health factor
const calculateHealthFactor = (cr: number, liquidationRatio: number): number => {
  return cr / liquidationRatio;
};

// Helper function to get health status
const getHealthStatus = (healthFactor: number): "healthy" | "warning" | "danger" => {
  if (healthFactor >= 1.5) return "healthy";
  if (healthFactor >= 1.1) return "warning";
  return "danger";
};

// Helper function to calculate rate accumulator with accrued interest
const calculateAccruedRate = (
  rateAccumulator: string,
  stabilityFeeRate: string,
  lastAccrual: number
): string => {
  const currentTime = Math.floor(Date.now() / 1000);
  const dt = currentTime - lastAccrual;
  
  if (dt === 0) return rateAccumulator;
  
  // Simplified compound interest calculation
  // For more accurate calculation, we would need to implement the _rpow function from the contract
  const rateNum = BigInt(rateAccumulator);
  const feeRateNum = BigInt(stabilityFeeRate);
  
  // Approximate: newRate = oldRate * (1 + (feeRate - RAY) / RAY * dt)
  const feePerSecond = (feeRateNum - RAY) * BigInt(dt);
  const factor = RAY + feePerSecond;
  const newRate = (rateNum * factor) / RAY;
  
  return newRate.toString();
};

// Helper function to get token info
const getTokenInfo = async (
  accessToken: string,
  tokenAddress: string
): Promise<{ symbol: string; decimals: number }> => {
  const { data } = await cirrus.get(accessToken, `/${Token}`, {
    params: {
      address: "eq." + tokenAddress,
      select: "_symbol,customDecimals",
    }
  });
  
  const token = data?.[0];
  return {
    symbol: token?._symbol || "UNKNOWN",
    decimals: token?.customDecimals || 18,
  };
};

interface VaultData {
  asset: string;
  symbol: string;
  collateralAmount: string;
  collateralValueUSD: string;
  debtAmount: string;
  debtValueUSD: string;
  collateralizationRatio: number;
  liquidationRatio: number;
  healthFactor: number;
  stabilityFeeRate: number;
  health: "healthy" | "warning" | "danger";
}

interface AssetConfig {
  asset: string;
  symbol: string;
  liquidationRatio: number;
  liquidationPenaltyBps: number;
  closeFactorBps: number;
  stabilityFeeRate: number;
  debtFloor: string;
  debtCeiling: string;
  unitScale: string;
  isPaused: boolean;
  isSupported: boolean;
}

export const getVaults = async (
  accessToken: string,
  userAddress: string
): Promise<VaultData[]> => {
  const registry = await getCDPRegistry(accessToken, userAddress);
  
  if (!registry?.cdpEngine) {
    throw new Error("CDP Engine not found");
  }

  const userVaults = registry.cdpEngine.vaults?.filter(
    (v: any) => v.user.toLowerCase() === userAddress.toLowerCase()
  ) || [];

  const vaultPromises = userVaults.map(async (vaultEntry: any) => {
    const asset = vaultEntry.asset;
    const vault = vaultEntry.Vault;
    
    // Get token info
    const tokenInfo = await getTokenInfo(accessToken, asset);
    
    // Get asset config and global state
    const config = registry.cdpEngine.collateralConfigs?.find(
      (c: any) => c.asset.toLowerCase() === asset.toLowerCase()
    )?.CollateralConfig;
    
    const globalState = registry.cdpEngine.collateralGlobalStates?.find(
      (s: any) => s.asset.toLowerCase() === asset.toLowerCase()
    )?.CollateralGlobalState;
    
    // Get price
    const priceEntry = registry.priceOracle?.prices?.find(
      (p: any) => p.asset.toLowerCase() === asset.toLowerCase()
    );
    const price = BigInt(priceEntry?.price || "0");
    
    if (!config || !globalState || !vault) {
      return null;
    }
    
    // Calculate current debt with accrued interest
    const currentRateAccumulator = calculateAccruedRate(
      globalState.rateAccumulator,
      config.stabilityFeeRate,
      parseInt(globalState.lastAccrual)
    );
    
    const scaledDebt = BigInt(vault.scaledDebt || "0");
    const currentDebt = (scaledDebt * BigInt(currentRateAccumulator)) / RAY;
    
    // Calculate collateral value
    const collateralAmount = BigInt(vault.collateral || "0");
    const collateralValueUSD = (collateralAmount * price) / BigInt(config.unitScale);
    
    // Calculate collateralization ratio
    let cr = 0;
    if (currentDebt > 0n) {
      cr = Number((collateralValueUSD * WAD) / currentDebt) / Number(WAD) * 100;
    } else if (collateralAmount > 0n) {
      cr = Number.MAX_SAFE_INTEGER; // Infinite CR when no debt
    }
    
    const liquidationRatio = Number(config.liquidationRatio) / Number(WAD) * 100;
    const healthFactor = calculateHealthFactor(cr, liquidationRatio);
    
    // Convert stability fee rate from RAY per second to annual percentage
    const stabilityFeeRate = (Number(config.stabilityFeeRate) - Number(RAY)) * 365 * 24 * 60 * 60 / Number(RAY) * 100;
    
    return {
      asset,
      symbol: tokenInfo.symbol,
      collateralAmount: formatUnits(collateralAmount, tokenInfo.decimals),
      collateralValueUSD: formatUnits(collateralValueUSD, 18),
      debtAmount: formatUnits(currentDebt, 18),
      debtValueUSD: formatUnits(currentDebt, 18), // USDST is 1:1 with USD
      collateralizationRatio: cr,
      liquidationRatio,
      healthFactor,
      stabilityFeeRate,
      health: getHealthStatus(healthFactor),
    };
  });

  const vaults = await Promise.all(vaultPromises);
  return vaults.filter((v: VaultData | null): v is VaultData => v !== null);
};

export const getVault = async (
  accessToken: string,
  userAddress: string,
  asset: string
): Promise<VaultData | null> => {
  const vaults = await getVaults(accessToken, userAddress);
  return vaults.find(v => 
    v.asset.toLowerCase() === asset.toLowerCase() || 
    v.symbol.toLowerCase() === asset.toLowerCase()
  ) || null;
};

export const deposit = async (
  accessToken: string,
  userAddress: string,
  body: { asset: string; amount: string }
): Promise<{ status: string; hash: string }> => {
  const registry = await getCDPRegistry(accessToken, userAddress);
  
  if (!registry?.cdpEngine) {
    throw new Error("CDP Engine not found");
  }

  const tx: FunctionInput[] = [
    {
      contractName: extractContractName(Token),
      contractAddress: body.asset,
      method: "approve",
      args: { spender: registry.cdpVault.address, value: body.amount },
    },
    {
      contractName: extractContractName(CDPEngine),
      contractAddress: registry.cdpEngine.address,
      method: "deposit",
      args: { asset: body.asset, amount: body.amount },
    },
  ];

  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, buildFunctionTx(tx))
  );
};

export const withdraw = async (
  accessToken: string,
  userAddress: string,
  body: { asset: string; amount: string }
): Promise<{ status: string; hash: string }> => {
  const registry = await getCDPRegistry(accessToken, userAddress);
  
  if (!registry?.cdpEngine) {
    throw new Error("CDP Engine not found");
  }

  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, buildFunctionTx({
      contractName: extractContractName(CDPEngine),
      contractAddress: registry.cdpEngine.address,
      method: "withdraw",
      args: { asset: body.asset, amount: body.amount },
    }))
  );
};

export const withdrawMax = async (
  accessToken: string,
  userAddress: string,
  body: { asset: string }
): Promise<{ status: string; hash: string }> => {
  const registry = await getCDPRegistry(accessToken, userAddress);
  
  if (!registry?.cdpEngine) {
    throw new Error("CDP Engine not found");
  }

  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, buildFunctionTx({
      contractName: extractContractName(CDPEngine),
      contractAddress: registry.cdpEngine.address,
      method: "withdrawMax",
      args: { asset: body.asset },
    }))
  );
};

export const mint = async (
  accessToken: string,
  userAddress: string,
  body: { asset: string; amount: string }
): Promise<{ status: string; hash: string }> => {
  const registry = await getCDPRegistry(accessToken, userAddress);
  
  if (!registry?.cdpEngine) {
    throw new Error("CDP Engine not found");
  }

  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, buildFunctionTx({
      contractName: extractContractName(CDPEngine),
      contractAddress: registry.cdpEngine.address,
      method: "mint",
      args: { asset: body.asset, amountUSD: body.amount },
    }))
  );
};

export const mintMax = async (
  accessToken: string,
  userAddress: string,
  body: { asset: string }
): Promise<{ status: string; hash: string }> => {
  const registry = await getCDPRegistry(accessToken, userAddress);
  
  if (!registry?.cdpEngine) {
    throw new Error("CDP Engine not found");
  }

  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, buildFunctionTx({
      contractName: extractContractName(CDPEngine),
      contractAddress: registry.cdpEngine.address,
      method: "mintMax",
      args: { asset: body.asset },
    }))
  );
};

export const repay = async (
  accessToken: string,
  userAddress: string,
  body: { asset: string; amount: string }
): Promise<{ status: string; hash: string }> => {
  const registry = await getCDPRegistry(accessToken, userAddress);
  
  if (!registry?.cdpEngine) {
    throw new Error("CDP Engine not found");
  }

  // Get USDST address from registry
  const usdstAddress = registry.usdst;
  
  if (!usdstAddress) {
    throw new Error("USDST token not found in registry");
  }

  const tx: FunctionInput[] = [
    {
      contractName: extractContractName(Token),
      contractAddress: usdstAddress,
      method: "approve",
      args: { spender: registry.cdpEngine.address, value: body.amount },
    },
    {
      contractName: extractContractName(CDPEngine),
      contractAddress: registry.cdpEngine.address,
      method: "repay",
      args: { asset: body.asset, amountUSD: body.amount },
    },
  ];

  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, buildFunctionTx(tx))
  );
};

export const repayAll = async (
  accessToken: string,
  userAddress: string,
  body: { asset: string }
): Promise<{ status: string; hash: string }> => {
  const registry = await getCDPRegistry(accessToken, userAddress);
  
  if (!registry?.cdpEngine) {
    throw new Error("CDP Engine not found");
  }

  // Get USDST address from registry
  const usdstAddress = registry.usdst;
  
  if (!usdstAddress) {
    throw new Error("USDST token not found in registry");
  }

  const MAX_UINT256 = ((1n << 256n) - 1n).toString();

  const tx: FunctionInput[] = [
    {
      contractName: extractContractName(Token),
      contractAddress: usdstAddress,
      method: "approve",
      args: { spender: registry.cdpEngine.address, value: MAX_UINT256 },
    },
    {
      contractName: extractContractName(CDPEngine),
      contractAddress: registry.cdpEngine.address,
      method: "repayAll",
      args: { asset: body.asset },
    },
  ];

  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, buildFunctionTx(tx))
  );
};

export const liquidate = async (
  accessToken: string,
  userAddress: string,
  body: { collateralAsset: string; borrower: string; debtToCover: string }
): Promise<{ status: string; hash: string }> => {
  const registry = await getCDPRegistry(accessToken, userAddress);
  
  if (!registry?.cdpEngine) {
    throw new Error("CDP Engine not found");
  }

  // Get USDST address from registry
  const usdstAddress = registry.usdst;
  
  if (!usdstAddress) {
    throw new Error("USDST token not found in registry");
  }

  const tx: FunctionInput[] = [
    {
      contractName: extractContractName(Token),
      contractAddress: usdstAddress,
      method: "approve",
      args: { spender: registry.cdpEngine.address, value: body.debtToCover },
    },
    {
      contractName: extractContractName(CDPEngine),
      contractAddress: registry.cdpEngine.address,
      method: "liquidate",
      args: {
        collateralAsset: body.collateralAsset,
        borrower: body.borrower,
        debtToCover: body.debtToCover,
      },
    },
  ];

  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, buildFunctionTx(tx))
  );
};

export const getLiquidatable = async (
  accessToken: string,
  userAddress: string
): Promise<VaultData[]> => {
  // Get all vaults from the registry
  const registry = await getCDPRegistry(accessToken, userAddress);
  
  if (!registry?.cdpEngine) {
    throw new Error("CDP Engine not found");
  }

  const allVaultEntries = registry.cdpEngine.vaults || [];
  
  const vaultPromises = allVaultEntries.map(async (vaultEntry: any) => {
    const vaultOwner = vaultEntry.user;
    const asset = vaultEntry.asset;
    const vault = vaultEntry.Vault;
    
    // Skip if no debt
    if (!vault?.scaledDebt || vault.scaledDebt === "0") {
      return null;
    }
    
    // Get vault data
    const vaultData = await getVault(accessToken, vaultOwner, asset);
    
    // Return only if liquidatable (health factor < 1.0)
    if (vaultData && vaultData.healthFactor < 1.0) {
      return vaultData;
    }
    
    return null;
  });

  const vaults = await Promise.all(vaultPromises);
  return vaults.filter((v: VaultData | null): v is VaultData => v !== null);
};

export const getAssetConfig = async (
  accessToken: string,
  userAddress: string,
  asset: string
): Promise<AssetConfig | null> => {
  const registry = await getCDPRegistry(accessToken, userAddress);
  
  if (!registry?.cdpEngine) {
    throw new Error("CDP Engine not found");
  }

  const configEntry = registry.cdpEngine.collateralConfigs?.find(
    (c: any) => c.asset.toLowerCase() === asset.toLowerCase()
  );
  
  if (!configEntry) {
    return null;
  }
  
  const config = configEntry.CollateralConfig;
  const tokenInfo = await getTokenInfo(accessToken, asset);
  
  // Convert stability fee rate from RAY per second to annual percentage
  const stabilityFeeRate = (Number(config.stabilityFeeRate) - Number(RAY)) * 365 * 24 * 60 * 60 / Number(RAY) * 100;
  
  return {
    asset,
    symbol: tokenInfo.symbol,
    liquidationRatio: Number(config.liquidationRatio) / Number(WAD) * 100,
    liquidationPenaltyBps: parseInt(config.liquidationPenaltyBps),
    closeFactorBps: parseInt(config.closeFactorBps),
    stabilityFeeRate,
    debtFloor: config.debtFloor,
    debtCeiling: config.debtCeiling,
    unitScale: config.unitScale,
    isPaused: config.isPaused,
    isSupported: true,
  };
};

export const getSupportedAssets = async (
  accessToken: string,
  userAddress: string
): Promise<AssetConfig[]> => {
  const registry = await getCDPRegistry(accessToken, userAddress);
  
  if (!registry?.cdpEngine) {
    throw new Error("CDP Engine not found");
  }

  const configEntries = registry.cdpEngine.collateralConfigs || [];
  
  const configPromises = configEntries.map(async (entry: any) => {
    return getAssetConfig(accessToken, userAddress, entry.asset);
  });
  
  const configs = await Promise.all(configPromises);
  return configs.filter((c: AssetConfig | null): c is AssetConfig => c !== null);
};
