/**
 * CDP Service - Handles Collateralized Debt Position operations
 */

import { strato, cirrus } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { FunctionInput } from "../../types/types";
import { postAndWaitForTx } from "../../utils/txHelper";
import { extractContractName } from "../../utils/utils";
import { StratoPaths, constants } from "../../config/constants";
import { getBalance as getTokenBalances } from "./tokens.service";

// Helper function for fixed-point exponentiation (matches contract's _rpow)
const rpow = (x: bigint, n: bigint, ray: bigint): bigint => {
  let z = n % 2n !== 0n ? x : ray;
  let xCopy = x;
  let nCopy = n;
  for (nCopy = nCopy / 2n; nCopy !== 0n; nCopy = nCopy / 2n) {
    xCopy = (xCopy * xCopy) / ray;
    if (nCopy % 2n !== 0n) {
      z = (z * xCopy) / ray;
    }
  }
  return z;
};

const convertStabilityFeeRateToAnnualPercentage = (stabilityFeeRateRay: string | bigint): number => {
  const secondsPerYear = 31536000n; // 365 * 24 * 60 * 60
  const annualFactorRay = rpow(BigInt(stabilityFeeRateRay), secondsPerYear, RAY);
  const factorMinusOne = annualFactorRay - RAY;
  const integerPart = factorMinusOne / RAY;
  const remainder = factorMinusOne % RAY;
  const PRECISION_SCALE = BigInt(1e18);
  const fractionalPart = (remainder * PRECISION_SCALE) / RAY;
  const annualPercentage = (Number(integerPart) + Number(fractionalPart) / Number(PRECISION_SCALE)) * 100;
  return annualPercentage;
};

// Helper function for compound interest calculation (matches contract's per-second compounding)
const getCompoundInterest = (
  debtUSD: bigint,
  stabilityFeeRate: bigint, // per-second rate in RAY
  seconds: bigint
): bigint => {
  const factor = rpow(stabilityFeeRate, seconds, RAY);
  return (debtUSD * (factor - RAY)) / RAY;
};

// Time constants for compound interest calculations
const SECONDS_PER_DAY = 86400n;
const SECONDS_PER_WEEK = 604800n;
const SECONDS_PER_MONTH = 2592000n; // 30 days

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
      "cdpReserve",
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
  try {
    const registry = await getCDPRegistry(accessToken, userAddress, {}, "getUserVaults");
    
    if (!registry?.cdpEngine) {
      return [];
    }

    // Get the specific CDPEngine address from registry
    const cdpEngineAddress = registry.cdpEngine.address || registry.cdpEngine;
    
    // Query vaults directly with user filter and specific CDPEngine address
    const { data: userVaults } = await cirrus.get(
      accessToken,
      `/${CDPEngine}-vaults`,
      {
        params: {
          select: "user:key,asset:key2,Vault:value",
          key: `eq.${userAddress.toLowerCase()}`,
          address: `eq.${cdpEngineAddress}`
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

// Helper function to check if a single token is active (status === 2 and in factory)
const isTokenActive = async (
  accessToken: string,
  tokenAddress: string
): Promise<boolean> => {
  const tokenData = await cirrus.get(accessToken, `/${Token}`, {
    params: {
      address: `eq.${tokenAddress}`,
      select: "status",
    }
  });

  const token = tokenData.data?.[0];
  
  return (
    token?.status !== undefined &&
    Number(token.status) === 2
  );
};

// Helper function to get only active tokens (status === 2) with their info
const getActiveTokens = async (
  accessToken: string,
  tokenAddresses: string[]
): Promise<Record<string, { symbol: string; decimals: number }>> => {
  if (tokenAddresses.length === 0) {
    return {};
  }

  // Fetch all tokens in parallel
  const tokenResults = await Promise.all(
    tokenAddresses.map(async (address) => {
      const { data } = await cirrus.get(accessToken, `/${Token}`, {
        params: {
          address: "eq." + address,
          select: "_symbol,customDecimals,status",
        }
      });
      return { address, token: data?.[0] };
    })
  );

  // Filter for only active tokens (status = '2') and build the map
  return tokenResults.reduce((map, { address, token }) => {
    if (token && token.status === '2') {
      map[address] = {
        symbol: token._symbol || "UNKNOWN",
        decimals: token.customDecimals || 18,
      };
    }
    return map;
  }, {} as Record<string, { symbol: string; decimals: number }>);
};



interface VaultData {
  asset: string;
  symbol: string;
  collateralAmount: string;
  collateralAmountDecimals: number;
  collateralValueUSD: string;
  debtAmount: string;
  collateralizationRatio: number;
  liquidationRatio: number;
  healthFactor: number;
  stabilityFeeRate: number;
  borrower?: string;
  scaledDebt: string;
  rateAccumulator: string;
}

interface AssetConfig {
  asset: string;
  symbol: string;
  liquidationRatio: number;
  minCR: number;
  liquidationPenaltyBps: number;
  closeFactorBps: number;
  stabilityFeeRate: number;
  debtFloor: string;
  debtCeiling: string;
  unitScale: string;
  isPaused: boolean;
  isSupported: boolean;
}

// RefinedVaultCandidate - All bigint values in their smallest unit (wei for 18-decimal tokens, satoshi for 8-decimal, etc.)
// "Collateral" = native asset units, "Debt/Mint" = USDST (always 18 decimals)
export interface RefinedVaultCandidate {
  assetAddress: string;
  symbol: string;                 // Asset symbol (e.g., "ETH", "WBTC")
  assetScale: string;             // 10^decimals as string (e.g., "1000000000000000000" for 18-decimal assets)
  minCR: string;                  // WAD format as string (1.5e18 = 150% CR)
  stabilityFeeRate: string;       // Per-second rate as string (RAY format)
  oraclePrice: string;            // Price per unit in USDST as string (18 decimals)
  currentCollateral: string;      // User's current collateral as string (native asset units)
  potentialCollateral: string;    // User's available balance as string (native asset units)
  currentDebt: string;            // User's current debt as string (USDST, 18 decimals)
  globalDebt: string;             // Global debt for this asset as string (USDST, 18 decimals)
  debtFloor: string;              // Minimum debt per vault as string (USDST, 18 decimals)
  debtCeiling: string;            // Maximum global debt as string (USDST, 18 decimals)
}
interface BadDebt {
  asset: string;
  badDebt: string;
  symbol?: string; // Token symbol (e.g., "WBTC", "ETHST")
}

export const getVaults = async (
  accessToken: string,
  userAddress: string
): Promise<VaultData[]> => {
  const registry = await getCDPRegistry(accessToken, userAddress, {}, "getVaults");
  
  if (!registry?.cdpEngine) {
    throw new Error("CDP Engine not found");
  }

  // Use efficient user-specific vault query
  const userVaults = await getUserVaults(accessToken, userAddress);

  if (userVaults.length === 0) {
    return [];
  }

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
    
    // Only skip if missing essential data (config or vault), but allow missing globalState
    if (!config || !vault) {
      return null;
    }
    
    // Use the current rate accumulator from the indexed data
    // This is already up-to-date as it's updated on every transaction
    // If no globalState, use default rate accumulator (RAY = 1e27, which means 1:1 scaling)
    const currentRateAccumulator = globalState?.rateAccumulator || RAY;
    
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
    const stabilityFeeRate = convertStabilityFeeRateToAnnualPercentage(config.stabilityFeeRate);
    
    return {
      asset,
      symbol: tokenInfo.symbol,
      collateralAmount: collateralAmount.toString(),
      collateralAmountDecimals: tokenInfo.decimals,
      collateralValueUSD: collateralValueUSD.toString(),
      debtAmount: currentDebt.toString(),
      collateralizationRatio: cr,
      liquidationRatio,
      healthFactor,
      stabilityFeeRate,
      scaledDebt: scaledDebt.toString(),
      rateAccumulator: currentRateAccumulator.toString(),
    };
  });

  const vaults = await Promise.all(vaultPromises);
  return vaults.filter((v: VaultData | null): v is VaultData => v !== null);
};

/**
 * Get vault candidates that are fully validated and ready for the greedy mint planning algorithm.
 * 
 * This endpoint performs all validation checks and returns only candidates that meet all criteria:
 * - Not USDST (cannot be used as collateral)
 * - isSupported: true
 * - isPaused: false
 * - oraclePrice > 0
 * - unitScale > 0
 * - Has collateral or balance (existing vaults) OR has non-collateral balance (potential vaults)
 * 
 * The frontend can trust that all returned candidates are valid and ready to be used directly
 * in the greedy algorithm without additional filtering or validation.
 */
export const getVaultCandidates = async (
  accessToken: string,
  userAddress: string
): Promise<{ existingVaults: RefinedVaultCandidate[]; potentialVaults: RefinedVaultCandidate[] }> => {
  // Existing vaults (user already has a CDP vault entry for the asset)
  const [existingVaults, supportedAssets, tokenBalances, registry] = await Promise.all([
    getVaults(accessToken, userAddress),
    getSupportedAssets(accessToken),
    getTokenBalances(accessToken, userAddress),
    getCDPRegistry(accessToken, userAddress, {}, "getVaultCandidates"),
  ]);

  const usdstAddress = (registry?.usdst || "").toLowerCase();

  // Build quick lookup maps
  const existingByAsset = new Map<string, VaultData>();
  for (const v of existingVaults) {
    existingByAsset.set(v.asset.toLowerCase(), v);
  }

  const balanceByAsset = new Map<string, any>();
  for (const t of tokenBalances || []) {
    if (t?.address) {
      balanceByAsset.set(t.address.toLowerCase(), t);
    }
  }

  const globalStateByAsset = new Map<string, any>();
  for (const s of registry?.cdpEngine?.collateralGlobalStates || []) {
    if (s?.asset) {
      globalStateByAsset.set(s.asset.toLowerCase(), s.CollateralGlobalState);
    }
  }

  // Build map of raw configs for accessing stabilityFeeRate in RAY format
  const rawConfigByAsset = new Map<string, any>();
  for (const c of registry?.cdpEngine?.collateralConfigs || []) {
    if (c?.asset) {
      rawConfigByAsset.set(c.asset.toLowerCase(), c.CollateralConfig);
    }
  }

  const existingCandidates: RefinedVaultCandidate[] = [];
  const potentialCandidates: RefinedVaultCandidate[] = [];

  for (const asset of supportedAssets) {
    const assetLower = asset.asset.toLowerCase();

    // Filter out invalid assets
    // 1. USDST cannot be used as collateral
    if (usdstAddress && assetLower === usdstAddress) {
      continue;
    }

    // 2. Unsupported assets
    if (!asset.isSupported) {
      continue;
    }

    // 3. Paused assets
    if (asset.isPaused) {
      continue;
    }

    const tokenEntry = balanceByAsset.get(assetLower);
    const nonCollateral = BigInt(tokenEntry?.balance || "0");
    const existing = existingByAsset.get(assetLower);
    const collateralAmount = BigInt(existing?.collateralAmount || "0");

    // 4. Must have collateral or balance (for existing vaults, include even if no balance)
    //    For potential vaults, we already check nonCollateral > 0 below
    const hasCollateralOrBalance = collateralAmount > 0n || nonCollateral > 0n;
    if (!hasCollateralOrBalance) {
      continue;
    }

    // 5. Only surface potential vaults if the user can actually open one (has non-collateral balance)
    if (!existing && nonCollateral <= 0n) {
      continue;
    }

    const oraclePrice = BigInt(tokenEntry?.price || "0");
    const unitScale = BigInt(asset.unitScale || WAD.toString());

    // 7. Must have valid oracle price
    if (oraclePrice <= 0n) {
      continue;
    }

    // 8. Must have valid unit scale
    if (unitScale <= 0n) {
      continue;
    }

    const globalState = globalStateByAsset.get(assetLower);
    const rateAccumulatorRay = BigInt(globalState?.rateAccumulator || RAY);
    const totalScaledDebt = BigInt(globalState?.totalScaledDebt || "0");
    const globalDebtUSD = (totalScaledDebt * rateAccumulatorRay) / RAY;

    // Get user's current debt from existing vault
    const userScaledDebt = BigInt(existing?.scaledDebt || "0");
    const userCurrentDebt = (userScaledDebt * rateAccumulatorRay) / RAY;

    // Get raw config for stabilityFeeRate in RAY format
    const rawConfig = rawConfigByAsset.get(assetLower);
    const stabilityFeeRateRay = rawConfig?.stabilityFeeRate || RAY.toString();

    // Convert minCR from percentage to WAD format (e.g., 150% = 1.5 = 1.5e18)
    // asset.minCR is a percentage (e.g., 150 for 150%), convert to decimal then WAD
    // Formula: (percentage / 100) * WAD = (percentage * WAD) / 100
    const minCRWad = (BigInt(Math.floor(asset.minCR)) * WAD) / 100n;

    // Calculate assetScale from unitScale (unitScale is already 10^decimals)
    const assetScale = unitScale;

    // All candidates returned from this endpoint have passed validation:
    // - isSupported: true (filtered out unsupported assets)
    // - isPaused: false (filtered out paused assets)
    // - oraclePrice > 0 (validated)
    // - unitScale > 0 (validated)
    // - has collateral or balance (validated)
    const candidate: RefinedVaultCandidate = {
      assetAddress: asset.asset,
      symbol: asset.symbol,
      assetScale: assetScale.toString(),
      minCR: minCRWad.toString(),
      stabilityFeeRate: stabilityFeeRateRay.toString(),
      oraclePrice: oraclePrice.toString(),
      currentCollateral: (existing?.collateralAmount ?? "0"),
      potentialCollateral: nonCollateral.toString(),
      currentDebt: userCurrentDebt.toString(),
      globalDebt: globalDebtUSD.toString(),
      debtFloor: asset.debtFloor,
      debtCeiling: asset.debtCeiling,
    };

    if (existing) {
      existingCandidates.push(candidate);
    } else {
      potentialCandidates.push(candidate);
    }
  }

  return { existingVaults: existingCandidates, potentialVaults: potentialCandidates };
};

export const getVault = async (
  accessToken: string,
  userAddress: string,
  asset: string
): Promise<VaultData | null> => {
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
    
    if (!config || !vault) {
      return null;
    }
    
    // Use the current rate accumulator from the indexed data
    // This is already up-to-date as it's updated on every transaction
    const currentRateAccumulator = globalState?.rateAccumulator || RAY;
    
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
    const stabilityFeeRate = convertStabilityFeeRateToAnnualPercentage(config.stabilityFeeRate);
    
    return {
      asset,
      symbol: tokenInfo.symbol,
      collateralAmount: collateralAmount.toString(),
      collateralAmountDecimals: tokenInfo.decimals,
      collateralValueUSD: collateralValueUSD.toString(),
      debtAmount: currentDebt.toString(),
      collateralizationRatio: cr,
      liquidationRatio,
      healthFactor,
      stabilityFeeRate,
      scaledDebt: scaledDebt.toString(),
      rateAccumulator: currentRateAccumulator.toString(),
    };
};

export const deposit = async (
  accessToken: string,
  userAddress: string,
  body: { asset: string; amount: string }
): Promise<{ status: string; hash: string }> => {
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

  const builtTx = await buildFunctionTx(tx, userAddress, accessToken);
  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};

export const withdraw = async (
  accessToken: string,
  userAddress: string,
  body: { asset: string; amount: string }
): Promise<{ status: string; hash: string }> => {
  const registry = await getCDPRegistry(accessToken, userAddress, {}, "withdraw");
  
  if (!registry?.cdpEngine) {
    throw new Error("CDP Engine not found");
  }

  const amountWei = body.amount;

  const builtTx = await buildFunctionTx({
      contractName: extractContractName(CDPEngine),
      contractAddress: registry.cdpEngine.address,
      method: "withdraw",
      args: { asset: body.asset, amount: amountWei },
    }, userAddress, accessToken);

  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};

export const getMaxWithdraw = async (
  accessToken: string,
  userAddress: string,
  body: { asset: string }
): Promise<{ maxAmount: string }> => {
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

  if (!config) {
    throw new Error("Asset config not found");
  }

  // Calculate current debt (simulating _accrue effect)
  const scaledDebt = BigInt(vault.scaledDebt || "0");
  const currentRateAccumulator = BigInt(globalState?.rateAccumulator || RAY);
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

    // Compute collateral required to keep CR >= minCR (NOT liquidationRatio)
    const minCR = BigInt(config.minCR || config.liquidationRatio);
    const unitScale = BigInt(config.unitScale);
    
    const requiredCollateralValue = (debt * minCR) / WAD;
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
  const registry = await getCDPRegistry(accessToken, userAddress);
  
  if (!registry?.cdpEngine) {
    throw new Error("CDP Engine not found");
  }

  const builtTx = await buildFunctionTx({
    contractName: extractContractName(CDPEngine),
    contractAddress: registry.cdpEngine.address,
    method: "withdrawMax",
    args: { asset: body.asset },
  }, userAddress, accessToken);

  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};

export const getMaxMint = async (
  accessToken: string,
  userAddress: string,
  body: { asset: string }
): Promise<{ maxAmount: string }> => {
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

  if (!config) {
    throw new Error("Asset config or global state not found");
  }

  // Calculate current debt (simulating _accrue effect)
  const scaledDebt = BigInt(vault.scaledDebt || "0");
  const currentRateAccumulator = BigInt(globalState?.rateAccumulator || RAY);
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

  // Compute borrow headroom from collateral value and minCR (NOT liquidationRatio)
  const collateralAmount = BigInt(vault.collateral || "0");
  const minCR = BigInt(config.minCR || config.liquidationRatio);
  const unitScale = BigInt(config.unitScale);
  
  const collateralValueUSD = (collateralAmount * price) / unitScale;
  
  // Calculate max borrowable amount with minCR safety buffer (matches contract's mintMax behavior)
  const maxBorrowableUSD = (collateralValueUSD * WAD) / minCR;

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
    const assetDebtUSD = (BigInt(globalState?.totalScaledDebt || "0") * currentRateAccumulator) / RAY;
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

export const getAssetDebtInfo = async (
  accessToken: string,
  userAddress: string,
  body: { asset: string }
): Promise<{ currentTotalDebt: string; debtFloor: string; debtCeiling: string }> => {
  const registry = await getCDPRegistry(accessToken, userAddress);
  
  if (!registry?.cdpEngine) {
    throw new Error("CDP Engine not found");
  }

  // Get asset config and global state
  const config = registry.cdpEngine.collateralConfigs?.find(
    (c: any) => c.asset.toLowerCase() === body.asset.toLowerCase()
  )?.CollateralConfig;
  
  const globalState = registry.cdpEngine.collateralGlobalStates?.find(
    (s: any) => s.asset.toLowerCase() === body.asset.toLowerCase()
  )?.CollateralGlobalState;

  if (!config) {
    throw new Error("Asset config or global state not found");
  }

  // Calculate current total debt for this asset
  const currentRateAccumulator = BigInt(globalState?.rateAccumulator || RAY);
  const currentTotalDebt = (BigInt(globalState?.totalScaledDebt || "0") * currentRateAccumulator) / RAY;

  return {
    currentTotalDebt: currentTotalDebt.toString(),
    debtFloor: config.debtFloor || "0",
    debtCeiling: config.debtCeiling || "0"
  };
};

export const mint = async (
  accessToken: string,
  userAddress: string,
  body: { asset: string; amount: string }
): Promise<{ status: string; hash: string }> => {
  const registry = await getCDPRegistry(accessToken, userAddress, {}, "mint");
  
  if (!registry?.cdpEngine) {
    throw new Error("CDP Engine not found");
  }

  const amountWei = body.amount;


  const builtTx = await buildFunctionTx({
    contractName: extractContractName(CDPEngine),
    contractAddress: registry.cdpEngine.address,
    method: "mint",
    args: { asset: body.asset, amountUSD: amountWei },
  }, userAddress, accessToken);

  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
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

  const builtTx = await buildFunctionTx({
    contractName: extractContractName(CDPEngine),
    contractAddress: registry.cdpEngine.address,
    method: "mintMax",
    args: { asset: body.asset },
  }, userAddress, accessToken);

  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
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

  const builtTx = await buildFunctionTx(tx, userAddress, accessToken);

  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
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

  const builtTx = await buildFunctionTx(tx, userAddress, accessToken);
  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
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

  const builtTx = await buildFunctionTx(tx, userAddress, accessToken);
  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};

export const getLiquidatable = async (
  accessToken: string,
  userAddress: string
): Promise<VaultData[]> => {
  // Get registry info
  const registry = await getCDPRegistry(accessToken, userAddress);
  
  if (!registry?.cdpEngine) {
    throw new Error("CDP Engine not found");
  }

  // Get the specific CDPEngine address from registry
  const cdpEngineAddress = registry.cdpEngine.address || registry.cdpEngine;

  // For liquidation, we need ALL vaults from the specific CDPEngine instance, not just user-specific ones
  // Query all vaults directly to avoid the massive registry response
  const { data: allVaultEntries } = await cirrus.get(
    accessToken,
    `/${CDPEngine}-vaults`,
    {
      params: {
        select: "user:key,asset:key2,Vault:value",
        address: `eq.${cdpEngineAddress}`
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
      // Add the borrower address to the vault data for liquidation
      return {
        ...vaultData,
        borrower: vaultOwner
      };
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
  
  // Check isSupportedAsset mapping - if asset is not in the mapping, it's disabled (false)
  // The Cirrus query returns entries with 'key' field (asset address) and 'value' field (boolean)
  const supportedAssetEntry = registry.cdpEngine.isSupportedAsset?.find(
    (entry: any) => {
      const entryKey = entry.key || entry.asset;
      return entryKey?.toLowerCase() === asset.toLowerCase();
    }
  );
  const isSupported = supportedAssetEntry?.value === true;
  
  return {
    asset,
    symbol: tokenInfo.symbol,
    liquidationRatio: Number(config.liquidationRatio) / Number(WAD) * 100,
    minCR: Number(config.minCR) / Number(WAD) * 100,
    liquidationPenaltyBps: parseInt(config.liquidationPenaltyBps),
    closeFactorBps: parseInt(config.closeFactorBps),
    stabilityFeeRate: convertStabilityFeeRateToAnnualPercentage(config.stabilityFeeRate),
    debtFloor: config.debtFloor,
    debtCeiling: config.debtCeiling,
    unitScale: config.unitScale,
    isPaused: config.isPaused,
    isSupported,
  };
};

// Get all collateral assets (regardless of support status) - used by admin
export const getAllCollateralAssets = async (
  accessToken: string,
): Promise<AssetConfig[]> => {
  const [{ data: [registryData] }, { data: symbols }] = await Promise.all([
    cirrus.get(accessToken, `/${CDPRegistry}`, {
      params: {
        select: `cdpEngine:cdpEngine_fkey(collateralConfigs:${CDPEngine}-collateralConfigs(asset:key,CollateralConfig:value),isSupportedAsset:${CDPEngine}-isSupportedAsset!inner(asset:key,value))`,
        address: `eq.${cdpRegistry}`,
      },
    }),
    cirrus.get(accessToken, `/${Token}`, {
      params: {
        select: "address,_symbol",
        "status": "eq.2",
      },
    }),
  ]);

  const supportedMap = new Map(registryData.cdpEngine.isSupportedAsset.map((a: any) => [a.asset, a.value]));
  const symbolMap = new Map(symbols.map((s: any) => [s.address, s._symbol]));

  return registryData.cdpEngine.collateralConfigs
    .filter((config: any) => symbolMap.has(config.asset))
    .map((config: any) => {
      const cfg = config.CollateralConfig;
      return {
        asset: config.asset,
        symbol: symbolMap.get(config.asset),
        liquidationRatio: Number(cfg.liquidationRatio) / Number(WAD) * 100,
        minCR: Number(cfg.minCR) / Number(WAD) * 100,
        liquidationPenaltyBps: parseInt(cfg.liquidationPenaltyBps),
        closeFactorBps: parseInt(cfg.closeFactorBps),
        stabilityFeeRate: convertStabilityFeeRateToAnnualPercentage(cfg.stabilityFeeRate),
        debtFloor: cfg.debtFloor,
        debtCeiling: cfg.debtCeiling,
        unitScale: cfg.unitScale,
        isPaused: cfg.isPaused,
        isSupported: supportedMap.get(config.asset),
      };
    });
};

// Get only supported collateral assets (isSupported === true) - used by user-facing components
export const getSupportedAssets = async (
  accessToken: string,
): Promise<AssetConfig[]> => {
  const { data: [registryData] } = await cirrus.get(
    accessToken,
    `/${CDPRegistry}`,
    {
      params: {
        select: `cdpEngine:cdpEngine_fkey(collateralConfigs:${CDPEngine}-collateralConfigs(asset:key,CollateralConfig:value),isSupportedAsset:${CDPEngine}-isSupportedAsset!inner(asset:key,value))`,
        "cdpEngine.isSupportedAsset.value": "eq.true",
        address: `eq.${cdpRegistry}`,
      },
    }
  );

  const supportedAssetAddresses = registryData.cdpEngine.isSupportedAsset.map(
    (asset: any) => asset.asset
  );

  const { data: symbols } = await cirrus.get(accessToken, `/${Token}`, {
    params: {
      select: "address,_symbol",
      "status": "eq.2",
      address: `in.(${supportedAssetAddresses.join(",")})`,
    },
  });

  const symbolMap = new Map(symbols.map((s: any) => [s.address, s._symbol]));

  return registryData.cdpEngine.collateralConfigs
    .filter((config: any) => symbolMap.has(config.asset))
    .map((config: any) => {
      const cfg = config.CollateralConfig;
      return {
        asset: config.asset,
        symbol: symbolMap.get(config.asset),
        liquidationRatio: Number(cfg.liquidationRatio) / Number(WAD) * 100,
        minCR: Number(cfg.minCR) / Number(WAD) * 100,
        liquidationPenaltyBps: parseInt(cfg.liquidationPenaltyBps),
        closeFactorBps: parseInt(cfg.closeFactorBps),
        stabilityFeeRate: convertStabilityFeeRateToAnnualPercentage(cfg.stabilityFeeRate),
        debtFloor: cfg.debtFloor,
        debtCeiling: cfg.debtCeiling,
        unitScale: cfg.unitScale,
        isPaused: cfg.isPaused,
        isSupported: true,
      };
    });
};

export const getMaxLiquidatable = async (
  accessToken: string,
  userAddress: string,
  body: { collateralAsset: string; borrower: string }
): Promise<{ maxAmount: string }> => {
  
  const registry = await getCDPRegistry(accessToken, userAddress);
  
  if (!registry?.cdpEngine) {
    throw new Error("CDP Engine not found");
  }

  // Get vault data for the borrower
  const vaultData = await getVault(accessToken, body.borrower, body.collateralAsset);
  if (!vaultData || vaultData.healthFactor >= 1.0) {
    return { maxAmount: "0" };
  }

  // Get global state to calculate full debt amount
  const globalState = registry.cdpEngine.collateralGlobalStates?.find(
    (s: any) => s.asset.toLowerCase() === body.collateralAsset.toLowerCase()
  )?.CollateralGlobalState;

  if (!globalState) {
    throw new Error("Asset global state not found");
  }

  // Get collateral config to access close factor
  const config = registry.cdpEngine.collateralConfigs?.find(
    (c: any) => c.asset.toLowerCase() === body.collateralAsset.toLowerCase()
  )?.CollateralConfig;

  if (!config) {
    throw new Error("Asset config not found");
  }

  // Calculate total debt amount (Cap 1)
  const rateAccumulator = BigInt(globalState.rateAccumulator);
  const scaledDebt = BigInt(vaultData.scaledDebt);
  const totalDebtUSD = (scaledDebt * rateAccumulator) / RAY;
  
  // Apply close factor cap (Cap 2)
  const closeFactorBps = BigInt(config.closeFactorBps);
  const closeFactorCap = (totalDebtUSD * closeFactorBps) / 10000n;
  
  // Calculate coverage cap (Cap 3) - ensures collateral can cover repay + penalty
  const priceEntry = registry.priceOracle?.prices?.find(
    (p: any) => p.asset.toLowerCase() === body.collateralAsset.toLowerCase()
  );
  
  if (!priceEntry) {
    throw new Error("Price not found for collateral asset");
  }
  
  const price = BigInt(priceEntry.value || "0");
  if (price <= 0n) {
    throw new Error("Invalid collateral price");
  }
  
  const collateralAmount = BigInt(vaultData.collateralAmount);
  const unitScale = BigInt(config.unitScale);
  const liquidationPenaltyBps = BigInt(config.liquidationPenaltyBps);
  
  const collateralUSD = (collateralAmount * price) / unitScale;
  const coverageCap = (collateralUSD * 10000n) / (10000n + liquidationPenaltyBps);
  
  // Apply close factor and coverage caps
  const actualMaxLiquidatable = BigInt(Math.min(
    Number(closeFactorCap), 
    Number(coverageCap)
  ));
  
  // Add a small buffer to prevent dust issues when liquidating the maximum amount
  // This ensures we can liquidate slightly more than the pure mathematical result
  const bufferWei = 100000n; // 100k wei buffer
  const maxLiquidatableWithBuffer = actualMaxLiquidatable + bufferWei;
  
  // Final safety: ensure we never exceed the total debt amount
  const finalMaxLiquidatable = maxLiquidatableWithBuffer > totalDebtUSD 
    ? totalDebtUSD 
    : maxLiquidatableWithBuffer;
  
  return { maxAmount: finalMaxLiquidatable.toString() };
};

// ----- Admin Service Methods (Owner Only) -----

export const setCollateralConfig = async (
  accessToken: string,
  userAddress: string,
  configData: {
    asset: string;
    liquidationRatio: string;
    minCR: string;
    liquidationPenaltyBps: string;
    closeFactorBps: string;
    stabilityFeeRate: string;
    debtFloor: string;
    debtCeiling: string;
    unitScale: string;
    isPaused: boolean;
  }
): Promise<{ status: string; hash: string }> => {
  const registry = await getCDPRegistry(accessToken, userAddress, {}, "setCollateralConfig");
  
  if (!registry?.cdpEngine) {
    throw new Error("CDP Engine not found");
  }
  
  const tx: FunctionInput = {
    contractName: extractContractName(CDPEngine),
    contractAddress: registry.cdpEngine.address,
    method: "setCollateralAssetParams",
    args: {
      asset: configData.asset,
      liquidationRatio: configData.liquidationRatio,
      minCR: configData.minCR,
      liquidationPenaltyBps: configData.liquidationPenaltyBps,
      closeFactorBps: configData.closeFactorBps,
      stabilityFeeRate: configData.stabilityFeeRate,
      debtFloor: configData.debtFloor,
      debtCeiling: configData.debtCeiling,
      unitScale: configData.unitScale,
      pause: Boolean(configData.isPaused),
    },
  };

  const builtTx = await buildFunctionTx(tx, userAddress, accessToken);
  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};

export const setAssetPaused = async (
  accessToken: string,
  userAddress: string,
  body: { asset: string; isPaused: boolean }
): Promise<{ status: string; hash: string }> => {
  const registry = await getCDPRegistry(accessToken, userAddress, {}, "setAssetPaused");
  
  if (!registry?.cdpEngine) {
    throw new Error("CDP Engine not found");
  }

  const tx: FunctionInput = {
    contractName: extractContractName(CDPEngine),
    contractAddress: registry.cdpEngine.address,
    method: "setPaused",
    args: {
      asset: body.asset,
      isPaused: body.isPaused,
    },
  };

  const builtTx = await buildFunctionTx(tx, userAddress, accessToken);
  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};

export const setGlobalPaused = async (
  accessToken: string,
  userAddress: string,
  body: { isPaused: boolean }
): Promise<{ status: string; hash: string }> => {
  const registry = await getCDPRegistry(accessToken, userAddress, {}, "setGlobalPaused");
  
  if (!registry?.cdpEngine) {
    throw new Error("CDP Engine not found");
  }

  const tx: FunctionInput = {
    contractName: extractContractName(CDPEngine),
    contractAddress: registry.cdpEngine.address,
    method: "setPausedGlobal",
    args: {
      isPaused: body.isPaused,
    },
  };

  const builtTx = await buildFunctionTx(tx, userAddress, accessToken);
  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};

export const setAssetSupported = async (
  accessToken: string,
  userAddress: string,
  body: { asset: string; supported: boolean }
): Promise<{ status: string; hash: string }> => {
  const registry = await getCDPRegistry(accessToken, userAddress, {}, "setAssetSupported");
  
  if (!registry?.cdpEngine) {
    throw new Error("CDP Engine not found");
  }

  const tx: FunctionInput = {
    contractName: extractContractName(CDPEngine),
    contractAddress: registry.cdpEngine.address,
    method: "setSupportedAsset",
    args: {
      asset: body.asset,
      supported: body.supported,
    },
  };

  const builtTx = await buildFunctionTx(tx, userAddress, accessToken);
  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};

export const getGlobalPaused = async (
  accessToken: string,
  userAddress: string
): Promise<{ isPaused: boolean }> => {
  const registry = await getCDPRegistry(accessToken, userAddress, {}, "getGlobalPaused");
  
  if (!registry?.cdpEngine) {
    throw new Error("CDP Engine not found");
  }

  return { isPaused: registry.cdpEngine.globalPaused || false };
};

export const getAllCollateralConfigs = async (
  accessToken: string,
  userAddress: string
): Promise<AssetConfig[]> => {
  // Return all collateral assets (regardless of support status) for admin view
  return getAllCollateralAssets(accessToken);
};

export const getBadDebt = async (
  accessToken: string,
  userAddress: string
): Promise<BadDebt[]> => {
  const registry = await getCDPRegistry(accessToken, userAddress);
  
  if (!registry?.cdpEngine) {
    throw new Error("CDP Engine not found");
  }

  try {
    // Get the specific CDPEngine address from registry
    const cdpEngineAddress = registry.cdpEngine.address || registry.cdpEngine;
    
    // Query the badDebt mapping from the CDP Engine contract
    // Use ::text to force Cirrus to return large numbers as strings instead of scientific notation
    const { data } = await cirrus.get(
      accessToken,
      `/${CDPEngine}-badDebtUSDST`,
      {
        params: {
          select: "key,value::text",
          address: `eq.${cdpEngineAddress}`
        }
      }
    );


    if (!data || data.length === 0) {
      return [];
    }

    // Filter out zero bad debt entries
    const nonZeroBadDebtEntries = data.filter((entry: any) => entry.value && entry.value !== "0");
    
    if (nonZeroBadDebtEntries.length === 0) {
      return [];
    }


    // Fetch token symbols for each asset with bad debt
    const badDebtEntries: BadDebt[] = [];
    
    for (const entry of nonZeroBadDebtEntries) {
      const assetAddress = entry.key;
      const badDebtAmount = entry.value;
      
      try {
        
        // Query the token contract's symbol
        const symbolResponse = await cirrus.get(
          accessToken,
          `/BlockApps-Token`,
          {
            params: {
              select: "_symbol",
              address: `eq.${assetAddress}`
            }
          }
        );

        let symbol = "UNKNOWN";
        if (symbolResponse.data && symbolResponse.data.length > 0 && symbolResponse.data[0]._symbol) {
          symbol = symbolResponse.data[0]._symbol;
        }

        badDebtEntries.push({
          asset: assetAddress,
          badDebt: badDebtAmount,
          symbol: symbol
        });

      } catch (error: any) {
        console.error(`Error fetching symbol for asset ${assetAddress}:`, error.message);
        
        // Still include the entry without symbol
        badDebtEntries.push({
          asset: assetAddress,
          badDebt: badDebtAmount,
          symbol: "UNKNOWN"
        });
      }
    }

    return badDebtEntries;
  } catch (error: any) {
    console.error("Error fetching bad debt from Cirrus:", {
      error: error.response?.data || error.message,
      cdpEngine: registry.cdpEngine?.address
    });
    throw new Error("Failed to fetch bad debt data from blockchain");
  }
};

interface JuniorNote {
  owner: string;
  capUSDST: string;
  entryIndex: string;
  claimableAmount: string; // Calculated using gas-free Cirrus queries
}

/**
 * Calculate claimable amount using gas-free Cirrus queries
 * Replicates the exact logic from CDPEngine.claimable() function
 */
export const getClaimableAmount = async (
  accessToken: string,
  userAddress: string,
  account: string
): Promise<string> => {
  const registry = await getCDPRegistry(accessToken, userAddress);
  
  if (!registry?.cdpEngine) {
    throw new Error("CDP Engine not found");
  }

  const cdpEngineAddress = registry.cdpEngine.address || registry.cdpEngine;
  const reserveAddress = registry.cdpReserve;
  const usdstAddress = registry.usdst;
  
  try {
    // Get all required data via Cirrus queries (gas-free)
    const [
      juniorNoteData,
      juniorIndexData,
      prevReserveBalanceData,
      totalJuniorOutstandingData,
      reserveBalanceData
    ] = await Promise.all([
      // 1. Get the user's junior note
      cirrus.get(accessToken, `/${CDPEngine}-juniorNotes`, {
        params: {
          select: "key,JuniorNote:value",
          key: `eq.${account}`,
          address: `eq.${cdpEngineAddress}`
        }
      }),
      
      // 2. Get current junior index
      cirrus.get(accessToken, `/${CDPEngine}`, {
        params: {
          select: "juniorIndex::text",
          address: `eq.${cdpEngineAddress}`
        }
      }),
      
      // 3. Get previous reserve balance
      cirrus.get(accessToken, `/${CDPEngine}`, {
        params: {
          select: "prevReserveBalance::text",
          address: `eq.${cdpEngineAddress}`
        }
      }),
      
      // 4. Get total junior outstanding
      cirrus.get(accessToken, `/${CDPEngine}`, {
        params: {
          select: "totalJuniorOutstandingUSDST::text",
          address: `eq.${cdpEngineAddress}`
        }
      }),
      
      // 5. Get current reserve balance from USDST contract
      cirrus.get(accessToken, `/BlockApps-Token-_balances`, {
        params: {
          select: "key,value::text", 
          key: `eq.${reserveAddress}`,
          address: `eq.${usdstAddress}`
        }
      })
    ]);

    // Parse junior note data
    const noteData = juniorNoteData.data?.[0]?.JuniorNote;
    if (!noteData || noteData.owner === "0000000000000000000000000000000000000000") {
      return "0"; // No note exists
    }

    // Parse all the required values
    const capUSDST = BigInt(noteData.capUSDST || "0");
    const entryIndex = BigInt(noteData.entryIndex || "0");
    const juniorIndex = BigInt(juniorIndexData.data?.[0]?.juniorIndex || "1000000000000000000000000000"); // Default to RAY (1e27)
    const prevReserveBalance = BigInt(prevReserveBalanceData.data?.[0]?.prevReserveBalance || "0");
    const totalJuniorOutstanding = BigInt(totalJuniorOutstandingData.data?.[0]?.totalJuniorOutstandingUSDST || "0");
    const currentReserveBalance = BigInt(reserveBalanceData.data?.[0]?.value || "0");

    // Replicate claimable() logic exactly
    let effectiveIndex = juniorIndex === 0n ? 1000000000000000000000000000n : juniorIndex; // RAY = 1e27

    // Check for new inflows and calculate index bump
    if (currentReserveBalance > prevReserveBalance && totalJuniorOutstanding > 0n) {
      const newInflows = currentReserveBalance - prevReserveBalance;
      const indexBump = (newInflows * 1000000000000000000000000000n) / totalJuniorOutstanding; // * RAY / totalOutstanding
      effectiveIndex += indexBump;
    }

    // Calculate entitlement using _entitlement logic
    if (capUSDST === 0n) return "0";
    if (effectiveIndex <= entryIndex) return "0";

    // entitlement = (capUSDST * (effectiveIndex - entryIndex)) / RAY
    const indexDiff = effectiveIndex - entryIndex;
    let entitlement = (capUSDST * indexDiff) / 1000000000000000000000000000n; // Divide by RAY to convert back to wei

    // Cap at remaining cap
    if (entitlement > capUSDST) {
      entitlement = capUSDST;
    }

    return entitlement.toString();
  } catch (error: any) {
    console.error("Failed to calculate claimable amount:", {
      account,
      error: error.response?.data || error.message
    });
    // Don't throw - return 0 to avoid breaking the UI
    return "0";
  }
};

export const getJuniorNotes = async (
  accessToken: string,
  userAddress: string,
  account: string
): Promise<JuniorNote | null> => {
  const registry = await getCDPRegistry(accessToken, userAddress);
  
  if (!registry?.cdpEngine) {
    throw new Error("CDP Engine not found");
  }

  try {
    // Get the specific CDPEngine address from registry
    const cdpEngineAddress = registry.cdpEngine.address || registry.cdpEngine;
    
    // Query the juniorNotes mapping for the specific account
    const { data } = await cirrus.get(
      accessToken,
      `/${CDPEngine}-juniorNotes`,
      {
        params: {
          select: "key,JuniorNote:value",
          key: `eq.${account}`,
          address: `eq.${cdpEngineAddress}`
        }
      }
    );

    if (!data || data.length === 0) {
      return null;
    }

    const noteData = data[0]?.JuniorNote;
    if (!noteData || noteData.owner === "0000000000000000000000000000000000000000") {
      return null;
    }

    // Calculate claimable amount using gas-free Cirrus queries
    let claimableAmount = "0";
    try {
      claimableAmount = await getClaimableAmount(accessToken, userAddress, account);
    } catch (error) {
      console.warn("Failed to calculate claimable amount, using 0:", error);
    }

    return {
      owner: noteData.owner,
      capUSDST: noteData.capUSDST || "0",
      entryIndex: noteData.entryIndex || "0",
      claimableAmount
    };
  } catch (error: any) {
    console.error("Error fetching junior notes:", {
      account,
      error: error.response?.data || error.message
    });
    throw new Error("Error fetching junior notes data from Cirrus");
  }
};

export const claimJuniorNote = async (
  accessToken: string,
  userAddress: string
): Promise<{ status: string; hash: string }> => {
  const registry = await getCDPRegistry(accessToken, userAddress, {}, "claimJuniorNote");
  
  if (!registry?.cdpEngine) {
    throw new Error("CDP Engine not found");
  }

  const cdpEngineAddress = registry.cdpEngine.address;

  const txData = {
    type: "FUNCTION" as const,
    payload: {
      contractName: CDPEngine,
      contractAddress: cdpEngineAddress,
      method: "claimJunior",
      args: {}
    }
  };

  try {
    const txResponse = await strato.post(accessToken, StratoPaths.transactionParallel, {
      txs: [txData]
    });

    const result = txResponse.data?.[0];
    if (result?.status !== "Success") {
      throw new Error(`Transaction failed: ${result?.error || result?.status}`);
    }

    // claimJunior transaction was successful
    // Frontend will use the pre-calculated claimable amount for display
    return {
      status: "success",
      hash: result.hash || ""
    };
  } catch (error: any) {
    console.error("Error claiming junior note:", {
      userAddress,
      error: error.response?.data || error.message
    });
    throw new Error("Error claiming junior note rewards");
  }
};

export const topUpJuniorNote = async (
  accessToken: string,
  userAddress: string,
  body: { amountUSDST: string }
): Promise<{ status: string; hash: string; burnedUSDST?: string; capUSDST?: string }> => {
  const registry = await getCDPRegistry(accessToken, userAddress, {}, "topUpJuniorNote");
  
  if (!registry?.cdpEngine) {
    throw new Error("CDP Engine not found");
  }

  // Get the user's current junior note to confirm they have one
  const juniorNote = await getJuniorNotes(accessToken, userAddress, userAddress);
  if (!juniorNote) {
    throw new Error("No existing junior note found to top up");
  }

  // Get bad debt information to find an asset with bad debt to top up
  const badDebtData = await getBadDebt(accessToken, userAddress);
  if (!badDebtData || badDebtData.length === 0) {
    throw new Error("No bad debt found to top up for");
  }
  
  // Use the first asset with bad debt for the top-up
  const assetWithBadDebt = badDebtData.find(debt => parseFloat(debt.badDebt) > 0);
  if (!assetWithBadDebt) {
    throw new Error("No assets with bad debt available for top-up");
  }

  const { amountUSDST } = body;
  const cdpEngineAddress = registry.cdpEngine.address;

  const txData = {
    type: "FUNCTION" as const,
    payload: {
      contractName: CDPEngine,
      contractAddress: cdpEngineAddress,
      method: "openJuniorNote",
      args: {
        asset: assetWithBadDebt.asset,
        amountUSDST
      }
    }
  };

  try {
    const txResponse = await strato.post(accessToken, StratoPaths.transactionParallel, {
      txs: [txData]
    });

    const result = txResponse.data?.[0];
    if (result?.status !== "Success") {
      throw new Error(`Transaction failed: ${result?.error || result?.status}`);
    }

    // Extract return values from transaction result
    const returnValues = result.data?.contents || [];
    const burnedUSDST = returnValues[0] || "0";
    const capUSDST = returnValues[1] || "0";

    return {
      status: "success",
      hash: result.hash || "",
      burnedUSDST,
      capUSDST
    };
  } catch (error: any) {
    console.error("Error topping up junior note:", {
      amountUSDST,
      error: error.response?.data || error.message
    });
    throw new Error("Failed to top up junior note");
  }
};

// CDP Stats interface for aggregated data
interface CDPStatsData {
  asset: string;
  symbol: string;
  totalCollateral: string;
  totalScaledDebt: string;
  totalDebtUSD: string;
  collateralValueUSD: string;
  collateralizationRatio: number;
  numberOfVaults: number;
}

interface CDPStatsResponse {
  totalCollateralValueUSD: string;
  totalDebtUSD: string;
  globalCollateralizationRatio: number;
  assets: CDPStatsData[];
}

/**
 * Get aggregated CDP statistics by asset
 * Fetches all vaults from CDPEngine and aggregates collateral and debt by asset
 */
export const getCDPStats = async (
  accessToken: string,
  userAddress: string
): Promise<CDPStatsResponse> => {
  try {
    // Get registry to find CDPEngine address
    const registry = await getCDPRegistry(accessToken, userAddress, {}, "getCDPStats");
    
    if (!registry?.cdpEngine) {
      throw new Error("CDP Engine not found");
    }
    const cdpEngineAddress = registry.cdpEngine.address;

    // Fetch all vaults from CDPEngine
    const { data: vaults } = await cirrus.get(
      accessToken,
      `/${CDPEngine}-vaults`,
      {
        params: {
          select: "user:key,asset:key2,Vault:value",
          address: `eq.${cdpEngineAddress}`
        }
      }
    );

    if (!vaults || vaults.length === 0) {
      return {
        totalCollateralValueUSD: "0",
        totalDebtUSD: "0",
        globalCollateralizationRatio: 0,
        assets: []
      };
    }

    // Get all unique assets
    const uniqueAssets = [...new Set(vaults.map((v: any) => v.asset))] as string[];
    // Get token info, prices, and configs for all assets in parallel
    const [tokenInfoMap, priceMap, configMap, globalStateMap] = await Promise.all([
      // Get only active tokens (status = '2')
      getActiveTokens(accessToken, uniqueAssets),

      // Get prices from registry
      Promise.resolve(
        registry.priceOracle?.prices?.reduce((map: Record<string, string>, p: any) => {
          map[p.asset] = p.value || "0";
          return map;
        }, {}) || {}
      ),

      // Get configs from registry
      Promise.resolve(
        registry.cdpEngine.collateralConfigs?.reduce((map: Record<string, any>, c: any) => {
          map[c.asset] = c.CollateralConfig;
          return map;
        }, {}) || {}
      ),

      // Get global states from registry
      Promise.resolve(
        registry.cdpEngine.collateralGlobalStates?.reduce((map: Record<string, any>, s: any) => {
          map[s.asset] = s.CollateralGlobalState;
          return map;
        }, {}) || {}
      )
    ]);
    // Aggregate vaults by asset
    const assetStats: Record<string, {
      collateral: bigint;
      scaledDebt: bigint;
      vaultCount: number;
    }> = {};

    vaults.forEach((vault: any) => {
      const asset = vault.asset.toLowerCase();
      const vaultData = vault.Vault || {};
      
      // Skip inactive tokens (not in tokenInfoMap means status !== '2')
      if (!tokenInfoMap[asset]) {
        return;
      }
      
      if (!assetStats[asset]) {
        assetStats[asset] = {
          collateral: 0n,
          scaledDebt: 0n,
          vaultCount: 0
        };
      }

      assetStats[asset].collateral += BigInt(vaultData.collateral || "0");
      assetStats[asset].scaledDebt += BigInt(vaultData.scaledDebt || "0");
      assetStats[asset].vaultCount += 1;
    });

    // Calculate stats for each asset
    let totalCollateralValueUSD = 0n;
    let totalDebtUSD = 0n;

    const assetsData: CDPStatsData[] = await Promise.all(
      Object.entries(assetStats).map(async ([assetAddress, stats]) => {
        const tokenInfo = tokenInfoMap[assetAddress];
        const price = BigInt(priceMap[assetAddress.toLowerCase()] || "0");
        const config = configMap[assetAddress.toLowerCase()];
        const globalState = globalStateMap[assetAddress.toLowerCase()];

        // Calculate current debt using rate accumulator
        const currentRateAccumulator = BigInt(globalState?.rateAccumulator || RAY.toString());
        const currentDebtUSD = (stats.scaledDebt * currentRateAccumulator) / RAY;

        // Calculate collateral value in USD
        const unitScale = BigInt(config?.unitScale || WAD.toString());
        const collateralValueUSD = (stats.collateral * price) / unitScale;

        totalCollateralValueUSD += collateralValueUSD;
        totalDebtUSD += currentDebtUSD;

        // Calculate collateralization ratio as percentage
        let collateralizationRatio = 0;
        if (currentDebtUSD > 0n) {
          // CR = (collateralValue / debt) * 100
          collateralizationRatio = Number((collateralValueUSD * WAD) / currentDebtUSD) / Number(WAD) * 100;
        } else if (collateralValueUSD > 0n) {
          // If there's collateral but no debt, CR is effectively infinite
          collateralizationRatio = Number.MAX_SAFE_INTEGER;
        }

        return {
          asset: assetAddress,
          symbol: tokenInfo?.symbol || "UNKNOWN",
          totalCollateral: stats.collateral.toString(),
          totalScaledDebt: stats.scaledDebt.toString(),
          totalDebtUSD: currentDebtUSD.toString(),
          collateralValueUSD: collateralValueUSD.toString(),
          collateralizationRatio,
          numberOfVaults: stats.vaultCount
        };
      })
    );

    // Sort assets by collateral value USD (descending)
    assetsData.sort((a, b) => {
      const aValue = BigInt(a.collateralValueUSD);
      const bValue = BigInt(b.collateralValueUSD);
      if (aValue > bValue) return -1;
      if (aValue < bValue) return 1;
      return 0;
    });

    // Calculate global collateralization ratio
    let globalCollateralizationRatio = 0;
    if (totalDebtUSD > 0n) {
      globalCollateralizationRatio = Number((totalCollateralValueUSD * WAD) / totalDebtUSD) / Number(WAD) * 100;
    } else if (totalCollateralValueUSD > 0n) {
      globalCollateralizationRatio = Number.MAX_SAFE_INTEGER;
    }

    return {
      totalCollateralValueUSD: totalCollateralValueUSD.toString(),
      totalDebtUSD: totalDebtUSD.toString(),
      globalCollateralizationRatio,
      assets: assetsData
    };
  } catch (error: any) {
    console.error("Error fetching CDP stats:", {
      error: error.response?.data || error.message
    });
    throw new Error("Failed to fetch CDP statistics");
  }
};

interface InterestData {
  asset: string;
  symbol: string;
  totalDebtUSD: string;
  annualRatePercent: number;
  dailyInterestUSD: string;
  weeklyInterestUSD: string;
  monthlyInterestUSD: string;
  ytdInterestUSD: string;
  allTimeInterestUSD: string;
}

interface InterestResponse {
  totalDailyInterestUSD: string;
  totalWeeklyInterestUSD: string;
  totalMonthlyInterestUSD: string;
  totalYtdInterestUSD: string;
  totalAllTimeInterestUSD: string;
  assets: InterestData[];
}

export const getInterestAccrued = async (
  accessToken: string,
  userAddress: string
): Promise<InterestResponse> => {
  const registry = await getCDPRegistry(accessToken, userAddress, {}, "getInterestAccrued");
  
  if (!registry?.cdpEngine) {
    throw new Error("CDP Engine not found");
  }

  const collateralConfigs = registry.cdpEngine.collateralConfigs || [];
  const globalStates = registry.cdpEngine.collateralGlobalStates || [];

  // Build a map of global states by asset
  const globalStateMap = new Map(
    globalStates.map((s: any) => [s.asset.toLowerCase(), s.CollateralGlobalState])
  );

  let totalDailyInterestUSD = 0n;
  let totalWeeklyInterestUSD = 0n;
  let totalMonthlyInterestUSD = 0n;
  let totalYtdInterestUSD = 0n;
  let totalAllTimeInterestUSD = 0n;

  const assetsData: InterestData[] = [];

  // Calculate days elapsed for YTD
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const daysElapsedYTD = Math.floor((now.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  for (const configEntry of collateralConfigs) {
    const asset = configEntry.asset;
    const config = configEntry.CollateralConfig;
    const globalState = globalStateMap.get(asset.toLowerCase());

    if (!config || !globalState) continue;

    // Get token info for symbol
    const tokenInfo = await getTokenInfo(accessToken, asset);

    // Calculate actual debt: totalScaledDebt * rateAccumulator / RAY
    const totalScaledDebt = BigInt((globalState as any).totalScaledDebt || "0");
    const rateAccumulator = BigInt((globalState as any).rateAccumulator || RAY.toString());
    const actualDebtUSD = (totalScaledDebt * rateAccumulator) / RAY;

    // Get annual rate as percentage (for display)
    const annualRatePercent = convertStabilityFeeRateToAnnualPercentage(config.stabilityFeeRate);

    // Use compound interest (matches contract's per-second compounding via rpow)
    const stabilityFeeRate = BigInt(config.stabilityFeeRate);

    // Compound interest for each period
    const dailyInterestUSD = getCompoundInterest(actualDebtUSD, stabilityFeeRate, SECONDS_PER_DAY);
    const weeklyInterestUSD = getCompoundInterest(actualDebtUSD, stabilityFeeRate, SECONDS_PER_WEEK);
    const monthlyInterestUSD = getCompoundInterest(actualDebtUSD, stabilityFeeRate, SECONDS_PER_MONTH);

    // YTD interest using compound calculation
    const secondsElapsedYTD = BigInt(daysElapsedYTD) * SECONDS_PER_DAY;
    const ytdInterestUSD = getCompoundInterest(actualDebtUSD, stabilityFeeRate, secondsElapsedYTD);

    // All-time interest = total accumulated interest (rateAccumulator - RAY) * totalScaledDebt / RAY
    // This represents the cumulative interest that has accrued since inception
    const allTimeInterestUSD = totalScaledDebt > 0n 
      ? (totalScaledDebt * (rateAccumulator - RAY)) / RAY
      : 0n;

    totalDailyInterestUSD += dailyInterestUSD;
    totalWeeklyInterestUSD += weeklyInterestUSD;
    totalMonthlyInterestUSD += monthlyInterestUSD;
    totalYtdInterestUSD += ytdInterestUSD;
    totalAllTimeInterestUSD += allTimeInterestUSD;

    if (actualDebtUSD > 0n) {
      assetsData.push({
        asset,
        symbol: tokenInfo.symbol,
        totalDebtUSD: actualDebtUSD.toString(),
        annualRatePercent,
        dailyInterestUSD: dailyInterestUSD.toString(),
        weeklyInterestUSD: weeklyInterestUSD.toString(),
        monthlyInterestUSD: monthlyInterestUSD.toString(),
        ytdInterestUSD: ytdInterestUSD.toString(),
        allTimeInterestUSD: allTimeInterestUSD.toString()
      });
    }
  }

  return {
    totalDailyInterestUSD: totalDailyInterestUSD.toString(),
    totalWeeklyInterestUSD: totalWeeklyInterestUSD.toString(),
    totalMonthlyInterestUSD: totalMonthlyInterestUSD.toString(),
    totalYtdInterestUSD: totalYtdInterestUSD.toString(),
    totalAllTimeInterestUSD: totalAllTimeInterestUSD.toString(),
    assets: assetsData
  };
};

export const openJuniorNote = async (
  accessToken: string,
  userAddress: string,
  body: { asset: string; amountUSDST: string }
): Promise<{ status: string; hash: string; burnedUSDST?: string; capUSDST?: string }> => {
  const registry = await getCDPRegistry(accessToken, userAddress, {}, "openJuniorNote");
  
  if (!registry?.cdpEngine) {
    throw new Error("CDP Engine not found");
  }

  const { asset, amountUSDST } = body;
  const cdpEngineAddress = registry.cdpEngine.address;

  const txData = {
    type: "FUNCTION" as const,
    payload: {
      contractName: CDPEngine,
      contractAddress: cdpEngineAddress,
      method: "openJuniorNote",
      args: {
        asset,
        amountUSDST
      }
    }
  };

  try {
    const txResponse = await strato.post(accessToken, StratoPaths.transactionParallel, {
      txs: [txData]
    });

    const result = txResponse.data?.[0];
    if (result?.status !== "Success") {
      throw new Error(`Transaction failed: ${result?.error || result?.status}`);
    }

    // Extract return values from transaction result
    const returnValues = result.data?.contents || [];
    const burnedUSDST = returnValues[0] || "0";
    const capUSDST = returnValues[1] || "0";

    return {
      status: "success",
      hash: result.hash || "",
      burnedUSDST,
      capUSDST
    };
  } catch (error: any) {
    console.error("Error opening junior note:", {
      asset,
      amountUSDST,
      error: error.response?.data || error.message
    });
    throw new Error("Failed to open junior note");
  }
};