/**
 * CDP Service - Handles Collateralized Debt Position operations
 */

import { strato, cirrus } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { FunctionInput } from "../../types/types";
import { postAndWaitForTx } from "../../utils/txHelper";
import { extractContractName } from "../../utils/utils";
import { StratoPaths, constants } from "../../config/constants";

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

const RAY = BigInt(10) ** BigInt(27);
const WAD = BigInt(10) ** BigInt(18);

/**
 * Generic Cirrus fetch for the CDPRegistry row.
 * Similar to getPool() in lending service
 */
export const getCDPRegistry = async (
  accessToken: string,
  userAddress: string | undefined,
  options: Record<string, string> = {},
  callerId?: string
): Promise<Record<string, any>> => {
  console.log(`🔍 [CDP] getCDPRegistry called at ${new Date().toISOString()}`, {
    userAddress,
    options,
    callerId
  });
  const { select, ...filters } = options;

  // Filter out undefined values
  const cleanedFilters = Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== undefined)
  );

  // Create efficient select query based on whether we need user-specific data
  let selectQuery;
  if (userAddress && !select) {
    // User-specific query - only get vaults for this user
    selectQuery = [
      "address",
      "feeCollector", 
      "tokenFactory",
      "usdst",
      "cdpEngine:cdpEngine_fkey(" +
        "address," +
        "registry," +
        "globalPaused," +
        "RAY::text," +
        "WAD::text," +
        `collateralConfigs:${CDPEngine}-collateralConfigs(asset:key,CollateralConfig:value),` +
        `collateralGlobalStates:${CDPEngine}-collateralGlobalStates(asset:key,CollateralGlobalState:value),` +
        `isSupportedAsset:${CDPEngine}-isSupportedAsset(asset:key,value)` +
      ")",
      "cdpVault:cdpVault_fkey(address,registry)",
      "priceOracle:priceOracle_fkey(address," +
        `prices:${PriceOracle}-prices(asset:key,value::text)` +
      ")"
    ].join(",");
  } else {
    // Use provided select or default (potentially large) query
    selectQuery = select ?? cdpRegistrySelectFields.join(",");
  }

  const params = {
    ...cleanedFilters,
    select: selectQuery,
    address: `eq.${cdpRegistry}`,
  };

  try {
    const { data: [registryData], } = await cirrus.get(
      accessToken,
      `/${CDPRegistry}`,
      { params }
    );
    if (!registryData) {
      console.error(`No CDP Registry found at address: ${cdpRegistry}`);
      throw new Error(`Error fetching ${extractContractName(CDPRegistry)} data from Cirrus`);
    }

    // Registry found successfully
    const caller = callerId || 'unknown';
    console.log(`✅ [${caller}] CDP Registry found with engine and vault addresses`);

    // Validate required components - handle both direct address and object formats
    const engineAddress = registryData.cdpEngine?.address || registryData.cdpEngine;
    const vaultAddress = registryData.cdpVault?.address || registryData.cdpVault;
    
    if (!engineAddress) {
      console.error(`❌ [${caller}] CDP Engine address missing from registry. Data structure:`, {
        hasEngineKey: 'cdpEngine' in registryData,
        engineValue: registryData.cdpEngine,
        engineType: typeof registryData.cdpEngine
      });
    }
    if (!vaultAddress) {
      console.error(`❌ [${caller}] CDP Vault address missing from registry. Data structure:`, {
        hasVaultKey: 'cdpVault' in registryData,
        vaultValue: registryData.cdpVault,
        vaultType: typeof registryData.cdpVault
      });
    }

    return registryData;
  } catch (error: any) {
    console.error("Error in getCDPRegistry:", {
      cdpRegistry,
      params,
      error: error.response?.data || error.message
    });
    throw new Error(`Error fetching ${extractContractName(CDPRegistry)} data from Cirrus`);
  }
};

/**
 * Fetch user-specific vault data efficiently
 */
export const getUserVaults = async (
  accessToken: string,
  userAddress: string
): Promise<any[]> => {
  console.log(`🔍 [CDP] getUserVaults called at ${new Date().toISOString()}`, {
    userAddress
  });
  try {
    const registry = await getCDPRegistry(accessToken, userAddress, {}, "getUserVaults");
    
    if (!registry?.cdpEngine) {
      return [];
    }

    // Query vaults directly with user filter to avoid pulling all vaults
    const { data: userVaults } = await cirrus.get(
      accessToken,
      `/${CDPEngine}-vaults`,
      {
        params: {
          select: "user:key,asset:key2,Vault:value",
          key: `eq.${userAddress.toLowerCase()}`
        }
      }
    );

    return userVaults || [];
  } catch (error) {
    console.warn(`❌ [CDP] Failed to fetch user vaults for ${userAddress}:`, error);
    return [];
  }
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
  collateralAmountDecimals: number; // Decimals for proper formatting
  collateralValueUSD: string;
  debtAmount: string;
  debtValueUSD: string;
  collateralizationRatio: number;
  liquidationRatio: number;
  healthFactor: number;
  stabilityFeeRate: number;
  health: "healthy" | "warning" | "danger";
  borrower?: string; // Optional for liquidatable positions
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
  console.log(`🔍 [CDP] getVaults called at ${new Date().toISOString()}`, {
    userAddress
  });
  const registry = await getCDPRegistry(accessToken, userAddress, {}, "getVaults");
  
  if (!registry?.cdpEngine) {
    throw new Error("CDP Engine not found");
  }

  // Use efficient user-specific vault query
  const userVaults = await getUserVaults(accessToken, userAddress);

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
    const price = BigInt(priceEntry?.value || "0");
    
    if (!config || !globalState || !vault) {
      return null;
    }
    
    // Use the current rate accumulator from the indexed data
    // This is already up-to-date as it's updated on every transaction
    const currentRateAccumulator = globalState.rateAccumulator;
    
    const scaledDebt = BigInt(vault.scaledDebt || "0");
    const currentDebt = (scaledDebt * BigInt(currentRateAccumulator)) / RAY;
    
    
    // Calculate collateral value
    const collateralAmount = BigInt(vault.collateral || "0");
    // Unit scale should now be 1e18 (fixed on-chain configuration)
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
      collateralAmount: collateralAmount.toString(), // Raw integer string
      collateralAmountDecimals: tokenInfo.decimals, // Include decimals info for frontend formatting
      collateralValueUSD: collateralValueUSD.toString(), // Raw integer string (18 decimals)
      debtAmount: currentDebt.toString(), // Raw integer string (18 decimals)
      debtValueUSD: currentDebt.toString(), // Raw integer string (18 decimals) - USDST is 1:1 with USD
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
  console.log(`🔍 [CDP] getVault called at ${new Date().toISOString()}`, {
    userAddress,
    asset
  });
  const registry = await getCDPRegistry(accessToken, userAddress, {}, "getVault");
  
  if (!registry?.cdpEngine) {
    throw new Error("CDP Engine not found");
  }

  // Find the specific vault using efficient user query
  const userVaults = await getUserVaults(accessToken, userAddress);
  const vaultEntry = userVaults.find(
    (v: any) => v.asset?.toLowerCase() === asset.toLowerCase()
  );
  
  if (!vaultEntry) {
    return null;
  }

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
    const price = BigInt(priceEntry?.value || "0");
    
    if (!config || !globalState || !vault) {
      return null;
    }
    
    // Use the current rate accumulator from the indexed data
    // This is already up-to-date as it's updated on every transaction
    const currentRateAccumulator = globalState.rateAccumulator;
    
    const scaledDebt = BigInt(vault.scaledDebt || "0");
    const currentDebt = (scaledDebt * BigInt(currentRateAccumulator)) / RAY;
    
    // Calculate collateral value
    const collateralAmount = BigInt(vault.collateral || "0");
    // Unit scale should now be 1e18 (fixed on-chain configuration)
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
      collateralAmount: collateralAmount.toString(), // Raw integer string
      collateralAmountDecimals: tokenInfo.decimals, // Include decimals info for frontend formatting
      collateralValueUSD: collateralValueUSD.toString(), // Raw integer string (18 decimals)
      debtAmount: currentDebt.toString(), // Raw integer string (18 decimals)
      debtValueUSD: currentDebt.toString(), // Raw integer string (18 decimals) - USDST is 1:1 with USD
      collateralizationRatio: cr,
      liquidationRatio,
      healthFactor,
      stabilityFeeRate,
      health: getHealthStatus(healthFactor),
    };
};

export const deposit = async (
  accessToken: string,
  userAddress: string,
  body: { asset: string; amount: string }
): Promise<{ status: string; hash: string }> => {
  console.log(`🔍 [CDP] deposit called at ${new Date().toISOString()}`, {
    userAddress,
    body
  });
  const registry = await getCDPRegistry(accessToken, userAddress, {}, "deposit");
  
  if (!registry?.cdpEngine) {
    throw new Error("CDP Engine not found");
  }
  
  const amountWei = body.amount;

  const tx: FunctionInput[] = [
    {
      contractName: extractContractName(Token),
      contractAddress: body.asset,
      method: "approve",
      args: { spender: registry.cdpVault.address, value: amountWei },
    },
    {
      contractName: extractContractName(CDPEngine),
      contractAddress: registry.cdpEngine.address,
      method: "deposit",
      args: { asset: body.asset, amount: amountWei },
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
  console.log(`🔍 [CDP] withdraw called at ${new Date().toISOString()}`, {
    userAddress,
    body
  });
  const registry = await getCDPRegistry(accessToken, userAddress, {}, "withdraw");
  
  if (!registry?.cdpEngine) {
    throw new Error("CDP Engine not found");
  }

  const amountWei = body.amount;

  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, buildFunctionTx({
      contractName: extractContractName(CDPEngine),
      contractAddress: registry.cdpEngine.address,
      method: "withdraw",
      args: { asset: body.asset, amount: amountWei },
    }))
  );
};

export const getMaxWithdraw = async (
  accessToken: string,
  userAddress: string,
  body: { asset: string }
): Promise<{ maxAmount: string }> => {
  console.log(`🔍 [CDP] getMaxWithdraw called at ${new Date().toISOString()}`, {
    userAddress,
    body
  });
  const registry = await getCDPRegistry(accessToken, userAddress);
  
  if (!registry?.cdpEngine) {
    throw new Error("CDP Engine not found");
  }

  // Find the specific vault from registry data
  const allVaults = await getUserVaults(accessToken, userAddress);
  const vaultEntry = allVaults.find(
    (v: any) => 
      v.asset?.toLowerCase() === body.asset.toLowerCase()
  );

  if (!vaultEntry) {
    return { maxAmount: "0" };
  }

  const vault = vaultEntry.Vault;
  if (!vault) {
    return { maxAmount: "0" };
  }

  // Get asset config and global state
  const config = registry.cdpEngine.collateralConfigs?.find(
    (c: any) => c.asset.toLowerCase() === body.asset.toLowerCase()
  )?.CollateralConfig;
  
  const globalState = registry.cdpEngine.collateralGlobalStates?.find(
    (s: any) => s.asset.toLowerCase() === body.asset.toLowerCase()
  )?.CollateralGlobalState;

  if (!config || !globalState) {
    throw new Error("Asset config or global state not found");
  }

  // Calculate current debt (simulating _accrue effect)
  const scaledDebt = BigInt(vault.scaledDebt || "0");
  const currentRateAccumulator = BigInt(globalState.rateAccumulator);
  const debt = (scaledDebt * currentRateAccumulator) / RAY;

  const collateralAmount = BigInt(vault.collateral || "0");

  let maxAmount: bigint;

  if (debt === 0n) {
    // No debt: user can withdraw all collateral
    maxAmount = collateralAmount;
  } else {
    // Get price from oracle
    const priceEntry = registry.priceOracle?.prices?.find(
      (p: any) => p.asset.toLowerCase() === body.asset.toLowerCase()
    );

    if (!priceEntry) {
      throw new Error("Price not found for asset");
    }

    const price = BigInt(priceEntry.value || "0");
    
    if (price <= 0n) {
      throw new Error("Invalid price");
    }

    // Compute collateral required to keep CR >= LR
    const liquidationRatio = BigInt(config.liquidationRatio);
    const unitScale = BigInt(config.unitScale);
    
    const requiredCollateralValue = (debt * liquidationRatio) / WAD;
    const requiredCollateral = (requiredCollateralValue * unitScale) / price;

    // Enforce a 1 wei buffer when debt exists to protect against rounding
    if (collateralAmount <= requiredCollateral + 1n) {
      maxAmount = 0n; // exactly at buffer or below => nothing withdrawable
    } else {
      maxAmount = collateralAmount - requiredCollateral - 1n;
    }
  }

  return { maxAmount: maxAmount.toString() };
};

export const withdrawMax = async (
  accessToken: string,
  userAddress: string,
  body: { asset: string }
): Promise<{ status: string; hash: string }> => {
  console.log(`🔍 [CDP] withdrawMax called at ${new Date().toISOString()}`, {
    userAddress,
    body
  });
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

export const getMaxMint = async (
  accessToken: string,
  userAddress: string,
  body: { asset: string }
): Promise<{ maxAmount: string }> => {
  console.log(`🔍 [CDP] getMaxMint called at ${new Date().toISOString()}`, {
    userAddress,
    body
  });
  const registry = await getCDPRegistry(accessToken, userAddress);
  
  if (!registry?.cdpEngine) {
    throw new Error("CDP Engine not found");
  }

  // Find the specific vault from registry data
  const allVaults = await getUserVaults(accessToken, userAddress);
  const vaultEntry = allVaults.find(
    (v: any) => 
      v.asset?.toLowerCase() === body.asset.toLowerCase()
  );

  if (!vaultEntry) {
    return { maxAmount: "0" };
  }

  const vault = vaultEntry.Vault;
  if (!vault) {
    return { maxAmount: "0" };
  }

  // Get asset config and global state
  const config = registry.cdpEngine.collateralConfigs?.find(
    (c: any) => c.asset.toLowerCase() === body.asset.toLowerCase()
  )?.CollateralConfig;
  
  const globalState = registry.cdpEngine.collateralGlobalStates?.find(
    (s: any) => s.asset.toLowerCase() === body.asset.toLowerCase()
  )?.CollateralGlobalState;

  if (!config || !globalState) {
    throw new Error("Asset config or global state not found");
  }

  // Calculate current debt (simulating _accrue effect)
  const scaledDebt = BigInt(vault.scaledDebt || "0");
  const currentRateAccumulator = BigInt(globalState.rateAccumulator);
  const currentDebt = (scaledDebt * currentRateAccumulator) / RAY;

  // Get price from oracle
  const priceEntry = registry.priceOracle?.prices?.find(
    (p: any) => p.asset.toLowerCase() === body.asset.toLowerCase()
  );

  if (!priceEntry) {
    throw new Error("Price not found for asset");
  }

  const price = BigInt(priceEntry.value || "0");
  
  if (price <= 0n) {
    throw new Error("Invalid price");
  }

  // Compute borrow headroom from collateral value and liquidation ratio
  const collateralAmount = BigInt(vault.collateral || "0");
  const liquidationRatio = BigInt(config.liquidationRatio);
  const unitScale = BigInt(config.unitScale);
  
  const collateralValueUSD = (collateralAmount * price) / unitScale;
  
  // Calculate max borrowable amount without safety buffer (matches contract's mintMax behavior)
  // This results in CR exactly at liquidation threshold
  const maxBorrowableUSD = (collateralValueUSD * WAD) / liquidationRatio;

  let maxAmount: bigint;

  if (maxBorrowableUSD <= currentDebt) {
    // No borrowing power
    maxAmount = 0n;
  } else {
    const available = maxBorrowableUSD - currentDebt;
    // Apply 1 wei buffer to avoid rounding into liquidation edge
    maxAmount = available > 1n ? (available - 1n) : 0n;
  }

  // Check debt ceiling constraint
  if (maxAmount > 0n && config.debtCeiling && BigInt(config.debtCeiling) > 0n) {
    const assetDebtUSD = (BigInt(globalState.totalScaledDebt) * currentRateAccumulator) / RAY;
    const debtCeiling = BigInt(config.debtCeiling);
    
    if (assetDebtUSD + maxAmount > debtCeiling) {
      maxAmount = debtCeiling > assetDebtUSD ? debtCeiling - assetDebtUSD : 0n;
    }
  }

  // Check debt floor constraint (if user would have debt after minting)
  if (maxAmount > 0n && config.debtFloor && BigInt(config.debtFloor) > 0n) {
    const totalDebtAfter = currentDebt + maxAmount;
    const debtFloor = BigInt(config.debtFloor);
    
    if (totalDebtAfter < debtFloor) {
      // If adding maxAmount would still be below floor, check if we can mint enough to reach floor
      if (currentDebt === 0n && maxAmount >= debtFloor) {
        // No current debt, can mint at least to floor
        maxAmount = maxAmount; // Keep the calculated max
      } else if (currentDebt > 0n) {
        // Already have debt, any amount should be fine
        maxAmount = maxAmount; // Keep the calculated max
      } else {
        // Cannot reach debt floor with available borrowing power
        maxAmount = 0n;
      }
    }
  }

  return { maxAmount: maxAmount.toString() };
};

export const mint = async (
  accessToken: string,
  userAddress: string,
  body: { asset: string; amount: string }
): Promise<{ status: string; hash: string }> => {
  console.log(`🔍 [CDP] mint called at ${new Date().toISOString()}`, {
    userAddress,
    body
  });
  const registry = await getCDPRegistry(accessToken, userAddress, {}, "mint");
  
  if (!registry?.cdpEngine) {
    throw new Error("CDP Engine not found");
  }

  const amountWei = body.amount;


  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, buildFunctionTx({
      contractName: extractContractName(CDPEngine),
      contractAddress: registry.cdpEngine.address,
      method: "mint",
      args: { asset: body.asset, amountUSD: amountWei },
    }))
  );
};

export const mintMax = async (
  accessToken: string,
  userAddress: string,
  body: { asset: string }
): Promise<{ status: string; hash: string }> => {
  console.log(`🔍 [CDP] mintMax called at ${new Date().toISOString()}`, {
    userAddress,
    body
  });
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
  console.log(`🔍 [CDP] repay called at ${new Date().toISOString()}`, {
    userAddress,
    body
  });
  const registry = await getCDPRegistry(accessToken, userAddress);
  
  if (!registry?.cdpEngine) {
    throw new Error("CDP Engine not found");
  }

  // Get USDST address from registry
  const usdstAddress = registry.usdst;
  
  if (!usdstAddress) {
    throw new Error("USDST token not found in registry");
  }

  const amountWei = body.amount;

  const tx: FunctionInput[] = [
    {
      contractName: extractContractName(Token),
      contractAddress: usdstAddress,
      method: "approve",
      args: { spender: registry.cdpEngine.address, value: amountWei },
    },
    {
      contractName: extractContractName(CDPEngine),
      contractAddress: registry.cdpEngine.address,
      method: "repay",
      args: { asset: body.asset, amountUSD: amountWei },
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
  console.log(`🔍 [CDP] repayAll called at ${new Date().toISOString()}`, {
    userAddress,
    body
  });
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
  console.log(`🔍 [CDP] liquidate called at ${new Date().toISOString()}`, {
    userAddress,
    body
  });
  const registry = await getCDPRegistry(accessToken, userAddress);
  
  if (!registry?.cdpEngine) {
    throw new Error("CDP Engine not found");
  }

  // Get USDST address from registry
  const usdstAddress = registry.usdst;
  
  if (!usdstAddress) {
    throw new Error("USDST token not found in registry");
  }

  const debtToCoverWei = body.debtToCover;

  const tx: FunctionInput[] = [
    {
      contractName: extractContractName(Token),
      contractAddress: usdstAddress,
      method: "approve",
      args: { spender: registry.cdpEngine.address, value: debtToCoverWei },
    },
    {
      contractName: extractContractName(CDPEngine),
      contractAddress: registry.cdpEngine.address,
      method: "liquidate",
      args: {
        collateralAsset: body.collateralAsset,
        borrower: body.borrower,
        debtToCover: debtToCoverWei,
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
  console.log(`🔍 [CDP] getLiquidatable called at ${new Date().toISOString()}`, {
    userAddress
  });
  // Get registry info
  const registry = await getCDPRegistry(accessToken, userAddress);
  
  if (!registry?.cdpEngine) {
    throw new Error("CDP Engine not found");
  }

  // For liquidation, we need ALL vaults, not just user-specific ones
  // Query all vaults directly to avoid the massive registry response
  const { data: allVaultEntries } = await cirrus.get(
    accessToken,
    `/${CDPEngine}-vaults`,
    {
      params: {
        select: "user:key,asset:key2,Vault:value"
      }
    }
  ).catch(() => ({ data: [] })); // Graceful fallback
  
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
  console.log(`🔍 [CDP] getAssetConfig called at ${new Date().toISOString()}`, {
    userAddress,
    asset
  });
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
  console.log(`🔍 [CDP] getSupportedAssets called at ${new Date().toISOString()}`, {
    userAddress
  });
  const registry = await getCDPRegistry(accessToken, userAddress, {}, "getSupportedAssets");
  
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
