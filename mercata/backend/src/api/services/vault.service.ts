/**
 * Vault Service - Handles Multi-Asset Vault operations
 */

import { strato, cirrus } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { FunctionInput } from "../../types/types";
import { postAndWaitForTx } from "../../utils/txHelper";
import { extractContractName } from "../../utils/utils";
import { StratoPaths, constants } from "../../config/constants";
import * as config from "../../config/config";

const {
  Vault,
  VaultFactory,
  Token,
  PriceOracle,
} = constants;

const WAD = BigInt(10) ** BigInt(18);

/**
 * Safely convert a string to BigInt, returning 0n for invalid inputs.
 * Handles empty strings, scientific notation, and other formats.
 */
const safeBigInt = (value: string | null | undefined): bigint => {
  if (!value) return 0n;
  const trimmed = value.trim();
  if (trimmed === "") return 0n;
  
  // Pure integer string - direct conversion
  if (/^-?\d+$/.test(trimmed)) {
    return BigInt(trimmed);
  }
  
  // Scientific notation (e.g., "5e+22", "1.5e10", "3E18")
  const sciMatch = trimmed.match(/^(-?\d+\.?\d*)[eE]([+-]?\d+)$/);
  if (sciMatch) {
    const [, mantissa, exponent] = sciMatch;
    const exp = parseInt(exponent, 10);
    
    // Split mantissa into integer and decimal parts
    const [intPart, decPart = ""] = mantissa.replace("-", "").split(".");
    const isNegative = mantissa.startsWith("-");
    
    // Combine and shift decimal point
    const combined = intPart + decPart;
    const shift = exp - decPart.length;
    
    let result: string;
    if (shift >= 0) {
      result = combined + "0".repeat(shift);
    } else {
      // Truncate decimals (floor toward zero)
      const cutPoint = combined.length + shift;
      result = cutPoint > 0 ? combined.slice(0, cutPoint) : "0";
    }
    
    return BigInt(isNegative ? "-" + result : result);
  }
  
  // Decimal number without exponent - truncate to integer
  if (/^-?\d+\.\d+$/.test(trimmed)) {
    const intPart = trimmed.split(".")[0];
    return BigInt(intPart || "0");
  }
  
  return 0n;
};

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface VaultAsset {
  address: string;
  symbol: string;
  name: string;
  balance: string;
  minReserve: string;
  withdrawable: string;
  priceUsd: string;
  valueUsd: string;
  images?: { value: string }[];
}

export interface VaultInfo {
  totalEquity: string;
  withdrawableEquity: string;
  totalShares: string;
  navPerShare: string;
  apy: string;
  paused: boolean;
  assets: VaultAsset[];
  deficitAssets: string[];
  shareTokenSymbol: string;
  shareTokenAddress: string;
  botExecutor: string;
}

export interface UserPosition {
  userShares: string;
  userValueUsd: string;
  allTimeEarnings: string;
}

export interface WithdrawalBasketItem {
  token: string;
  symbol: string;
  amount: string;
}

export interface VaultTransaction {
  id: string;
  type: "swap";
  timestamp: string;
  tokenIn?: {
    address: string;
    symbol: string;
    amount: string;
  };
  tokenOut?: {
    address: string;
    symbol: string;
    amount: string;
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get vault factory address or throw error
 */
const getVaultFactoryAddress = (): string => {
  if (!config.vaultFactory) {
    throw new Error("Vault factory address not configured");
  }
  return config.vaultFactory;
};

/**
 * Get the primary vault address from VaultFactory
 * For now, we use the first vault in the factory's allVaults array
 */
const getVaultAddress = async (accessToken: string): Promise<string | null> => {
  try {
    const vaultFactoryAddress = getVaultFactoryAddress();
    // In Cirrus, arrays are stored in separate tables: ContractName-arrayName
    const { data } = await cirrus.get(accessToken, `/${VaultFactory}-allVaults`, {
      params: {
        select: "value",
        address: `eq.${vaultFactoryAddress}`,
        order: "key.asc",
        limit: "1",
      },
    });

    if (!data?.length || !data[0]?.value) {
      return null;
    }

    // Return the first vault (primary vault)
    return data[0].value;
  } catch (error) {
    console.error("Error fetching vault address:", error);
    return null;
  }
};

/**
 * Get vault data from Cirrus
 */
const getVaultData = async (
  accessToken: string,
  vaultAddress: string
): Promise<Record<string, any> | null> => {
  try {
    // Get basic vault info
    const { data: vaultData } = await cirrus.get(accessToken, `/${Vault}`, {
      params: {
        select: "address,shareToken,botExecutor,_paused,priceOracle",
        address: `eq.${vaultAddress}`,
      },
    });

    if (!vaultData?.[0]) {
      return null;
    }

    const vault = vaultData[0];

    // Get supported assets from array table
    const { data: supportedAssetsData } = await cirrus.get(accessToken, `/${Vault}-supportedAssets`, {
      params: {
        select: "value",
        address: `eq.${vaultAddress}`,
      },
    });

    const supportedAssets = supportedAssetsData.map((asset: any) => asset.value);
    // Get min reserves from mapping table
    const { data: minReserveData } = await cirrus.get(accessToken, `/${Vault}-minReserve`, {
      params: {
        select: "key,value::text",
        address: `eq.${vaultAddress}`,
      },
    });

    return {
      ...vault,
      supportedAssets: supportedAssets || [],
      minReserve: (minReserveData || []).map((item: any) => ({
        asset: item.key,
        amount: item.value,
      })),
    };
  } catch (error) {
    console.error("Error fetching vault data:", error);
    return null;
  }
};

/**
 * Get token info including symbol, name, and images
 */
const getTokenInfo = async (
  accessToken: string,
  tokenAddress: string
): Promise<{ symbol: string; name: string; images?: { value: string }[] }> => {
  try {
    const { data } = await cirrus.get(accessToken, `/${Token}`, {
      params: {
        address: `eq.${tokenAddress}`,
        select: `_symbol,_name,images:${Token}-images(value)`,
      },
    });

    const token = data?.[0];
    return {
      symbol: token?._symbol || "UNKNOWN",
      name: token?._name || "Unknown Token",
      images: token?.images,
    };
  } catch (error) {
    console.error(`Error fetching token info for ${tokenAddress}:`, error);
    return { symbol: "UNKNOWN", name: "Unknown Token" };
  }
};

/**
 * Get price for an asset from PriceOracle
 */
const getAssetPrice = async (
  accessToken: string,
  oracleAddress: string,
  assetAddress: string
): Promise<string> => {
  try {
    const { data } = await cirrus.get(accessToken, `/${PriceOracle}-prices`, {
      params: {
        select: "value::text",
        address: `eq.${oracleAddress}`,
        key: `eq.${assetAddress}`,
      },
    });

    return data?.[0]?.value || "0";
  } catch (error) {
    console.error(`Error fetching price for ${assetAddress}:`, error);
    return "0";
  }
};

/**
 * Get token balance for an address
 */
const getTokenBalance = async (
  accessToken: string,
  tokenAddress: string,
  holderAddress: string
): Promise<string> => {
  try {
    const { data } = await cirrus.get(accessToken, `/${Token}-_balances`, {
      params: {
        select: "value::text",
        address: `eq.${tokenAddress}`,
        key: `eq.${holderAddress}`,
      },
    });

    return data?.[0]?.value || "0";
  } catch (error) {
    console.error(`Error fetching balance for ${tokenAddress}:`, error);
    return "0";
  }
};

/**
 * Get total supply of a token
 */
const getTokenTotalSupply = async (
  accessToken: string,
  tokenAddress: string
): Promise<string> => {
  try {
    const { data } = await cirrus.get(accessToken, `/${Token}`, {
      params: {
        select: "_totalSupply::text",
        address: `eq.${tokenAddress}`,
      },
    });

    return data?.[0]?._totalSupply || "0";
  } catch (error) {
    console.error(`Error fetching total supply for ${tokenAddress}:`, error);
    return "0";
  }
};

/**
 * Get historical token balance for an address at a specific date
 */
const getHistoricalTokenBalance = async (
  accessToken: string,
  tokenAddress: string,
  holderAddress: string,
  date: string // Format: YYYY-MM-DD
): Promise<string> => {
  try {
    const { data } = await cirrus.get(accessToken, "/history@mapping", {
      params: {
        select: "value::text",
        address: `eq.${tokenAddress}`,
        collection_name: "eq._balances",
        "key->>key": `eq.${holderAddress}`,
        valid_from: `lte.${date}`,
        valid_to: `gte.${date}`,
      },
    });

    const value = data?.[0]?.value;
    // Ensure we always return a valid number string, never empty
    if (!value || value === "") return "0";
    return value;
  } catch (error) {
    console.error(`Error fetching historical balance for ${tokenAddress}:`, error);
    return "0";
  }
};

/**
 * Get historical price for an asset at a specific date
 */
const getHistoricalAssetPrice = async (
  accessToken: string,
  oracleAddress: string,
  assetAddress: string,
  date: string // Format: YYYY-MM-DD
): Promise<string> => {
  try {
    const { data } = await cirrus.get(accessToken, "/history@mapping", {
      params: {
        select: "value::text",
        address: `eq.${oracleAddress}`,
        collection_name: "eq.prices",
        "key->>key": `eq.${assetAddress}`,
        valid_from: `lte.${date}`,
        valid_to: `gte.${date}`,
      },
    });

    const value = data?.[0]?.value;
    // Ensure we always return a valid number string, never empty
    if (!value || value === "") return "0";
    return value;
  } catch (error) {
    console.error(`Error fetching historical price for ${assetAddress}:`, error);
    return "0";
  }
};

/**
 * Get deposits and withdrawals for the vault within a date range
 */
const getDepositsWithdrawalsInPeriod = async (
  accessToken: string,
  vaultAddress: string,
  startDate: string // Format: YYYY-MM-DD
): Promise<{ totalDepositsUsd: bigint; totalWithdrawalsUsd: bigint }> => {
  try {
    // Fetch Deposited events since startDate
    const { data: depositEvents } = await cirrus.get(accessToken, `/${Vault}-Deposited`, {
      params: {
        select: "depositValueUSD::text",
        address: `eq.${vaultAddress}`,
        block_timestamp: `gte.${startDate}`,
      },
    });

    // Fetch Withdrawn events since startDate
    const { data: withdrawEvents } = await cirrus.get(accessToken, `/${Vault}-Withdrawn`, {
      params: {
        select: "withdrawValueUSD::text",
        address: `eq.${vaultAddress}`,
        block_timestamp: `gte.${startDate}`,
      },
    });

    // Sum up deposits
    let totalDepositsUsd = 0n;
    for (const event of depositEvents || []) {
      if (event.depositValueUSD) {
        totalDepositsUsd += BigInt(event.depositValueUSD);
      }
    }

    // Sum up withdrawals
    let totalWithdrawalsUsd = 0n;
    for (const event of withdrawEvents || []) {
      if (event.withdrawValueUSD) {
        totalWithdrawalsUsd += BigInt(event.withdrawValueUSD);
      }
    }

    return { totalDepositsUsd, totalWithdrawalsUsd };
  } catch (error) {
    console.error("Error fetching deposits/withdrawals in period:", error);
    return { totalDepositsUsd: 0n, totalWithdrawalsUsd: 0n };
  }
};

/**
 * Calculate historical equity for the vault at a specific date
 */
const getHistoricalEquity = async (
  accessToken: string,
  vaultAddress: string,
  botExecutor: string,
  priceOracleAddress: string,
  supportedAssets: string[],
  date: string // Format: YYYY-MM-DD
): Promise<bigint> => {
  let totalEquity = 0n;

  for (const assetAddress of supportedAssets) {
    const balance = await getHistoricalTokenBalance(accessToken, assetAddress, botExecutor, date);
    const balanceBN = safeBigInt(balance);

    const price = await getHistoricalAssetPrice(accessToken, priceOracleAddress, assetAddress, date);
    const priceBN = safeBigInt(price);

    if (priceBN > 0n) {
      totalEquity += (balanceBN * priceBN) / WAD;
    }
  }

  return totalEquity;
};


/**
 * Get the first deposit timestamp for the vault
 */
const getFirstDepositDate = async (
  accessToken: string,
  vaultAddress: string
): Promise<{ date: string; timestamp: Date } | null> => {
  try {
    const { data: depositEvents } = await cirrus.get(accessToken, `/${Vault}-Deposited`, {
      params: {
        select: "block_timestamp",
        address: `eq.${vaultAddress}`,
        order: "block_timestamp.asc",
        limit: "1",
      },
    });

    if (!depositEvents?.length || !depositEvents[0]?.block_timestamp) {
      return null;
    }

    const timestamp = new Date(depositEvents[0].block_timestamp);
    const date = timestamp.toISOString().split("T")[0]; // YYYY-MM-DD
    return { date, timestamp };
  } catch (error) {
    console.error("Error fetching first deposit date:", error);
    return null;
  }
};

/**
 * Get APY for the vault based on performance over time.
 * Uses 30-day period if available, otherwise uses time since first deposit.
 * Formula: profit = (currentEquity - startEquity) + totalWithdrawals - totalDeposits
 * APY = ((1 + periodReturn)^(365/30)) - 1
 */
const getAPY = async (
  accessToken: string,
  vaultAddress: string,
  currentEquity: bigint,
  botExecutor: string,
  priceOracleAddress: string,
  supportedAssets: string[]
): Promise<string> => {
  try {
    // ── Step 1: Determine the measurement period ──────────────────────────
    const firstDeposit = await getFirstDepositDate(accessToken, vaultAddress);

    if (!firstDeposit) {
      return "-"; // No deposits yet
    }

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const msSinceFirstDeposit = now.getTime() - firstDeposit.timestamp.getTime();
    const periodDays = msSinceFirstDeposit / (24 * 60 * 60 * 1000);


    // The measurement period must start on or after the day AFTER the first deposit.
    // The first deposit itself is "baked into" startEquity, not counted as a flow.
    const dayAfterFirstDeposit = new Date(firstDeposit.timestamp.getTime() + 24 * 60 * 60 * 1000);
    const earliestStartDate = dayAfterFirstDeposit.toISOString().split("T")[0];
    const todayStr = now.toISOString().split("T")[0];

    let startEquity: bigint;
    let profit: bigint;

    if (earliestStartDate > todayStr) {
      // ── Path A: Vault < 1 calendar day old ──────────────────────────────
      // dayAfterFirstDeposit is in the future, so historical equity is useless.
      // Use total net deposits as starting capital; profit is simply the gain over deposits.
      const { totalDepositsUsd: allDeposits, totalWithdrawalsUsd: allWithdrawals } =
        await getDepositsWithdrawalsInPeriod(accessToken, vaultAddress, firstDeposit.date);

      startEquity = allDeposits - allWithdrawals;

      if (startEquity <= 0n) {
        return "-";
      }

      profit = currentEquity - startEquity;
    } else {
      // ── Path B: Vault >= 1 calendar day old ─────────────────────────────
      // Use historical equity from startDate plus deposit/withdrawal flows in the period.
      let startDate: string;

      if (thirtyDaysAgo >= dayAfterFirstDeposit) {
        startDate = thirtyDaysAgo.toISOString().split("T")[0];
      } else {
        startDate = earliestStartDate;
      }

      // Get starting equity from historical data
      startEquity = await getHistoricalEquity(
        accessToken,
        vaultAddress,
        botExecutor,
        priceOracleAddress,
        supportedAssets,
        startDate
      );

      if (startEquity <= 0n) {
        return "-";
      }

      // Get deposit / withdrawal flows in the period
      const { totalDepositsUsd, totalWithdrawalsUsd } = await getDepositsWithdrawalsInPeriod(
        accessToken,
        vaultAddress,
        startDate
      );

      profit = (currentEquity - startEquity) + totalWithdrawalsUsd - totalDepositsUsd;
    }

    // ── Calculate period return and APY ───────────────────────────────────
    const periodReturnScaled = (profit * WAD) / startEquity;
    const periodReturn = Number(periodReturnScaled) / 1e18;

    if (periodReturn <= -1) {
      return "-";
    }

    // Always annualize over 30 days — profit is measured over a 30-day window
    const apy = Math.pow(1 + periodReturn, 365 / 30) - 1;
    const apyPercent = apy * 100;

    return apyPercent.toFixed(2);
  } catch (error) {
    console.error("Error calculating APY:", error);
    return "-";
  }
};

/**
 * Get user's total deposited and withdrawn USD values from events
 * Used to calculate all-time earnings
 */
const getUserDepositWithdrawTotals = async (
  accessToken: string,
  vaultAddress: string,
  userAddress: string
): Promise<{ totalDepositedUsd: bigint; totalWithdrawnUsd: bigint }> => {
  try {
    // Fetch all Deposited events for this user
    const { data: depositEvents } = await cirrus.get(accessToken, `/${Vault}-Deposited`, {
      params: {
        select: "depositValueUSD::text",
        address: `eq.${vaultAddress}`,
        user: `eq.${userAddress}`,
      },
    });

    // Fetch all Withdrawn events for this user
    const { data: withdrawEvents } = await cirrus.get(accessToken, `/${Vault}-Withdrawn`, {
      params: {
        select: "withdrawValueUSD::text",
        address: `eq.${vaultAddress}`,
        user: `eq.${userAddress}`,
      },
    });

    // Sum up all deposits
    let totalDepositedUsd = 0n;
    for (const event of depositEvents || []) {
      if (event.depositValueUSD) {
        totalDepositedUsd += BigInt(event.depositValueUSD);
      }
    }

    // Sum up all withdrawals
    let totalWithdrawnUsd = 0n;
    for (const event of withdrawEvents || []) {
      if (event.withdrawValueUSD) {
        totalWithdrawnUsd += BigInt(event.withdrawValueUSD);
      }
    }

    return { totalDepositedUsd, totalWithdrawnUsd };
  } catch (error) {
    console.error("Error fetching user deposit/withdraw totals:", error);
    return { totalDepositedUsd: 0n, totalWithdrawnUsd: 0n };
  }
};


// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC SERVICE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

export interface UserTokenBalance {
  address: string;
  symbol: string;
  name: string;
  balance: string;
  priceUsd: string;
  images?: { value: string }[];
}

/**
 * Get the vault share token address.
 */
export const getVaultShareTokenAddress = async (
  accessToken: string
): Promise<string> => {
  const vaultAddress = await getVaultAddress(accessToken);
  if (!vaultAddress) return "";
  const vaultData = await getVaultData(accessToken, vaultAddress);
  return vaultData?.shareToken || "";
};

/**
 * Lightweight function to get vault share token price (NAV per share).
 * Calculates totalEquity from supported asset balances and oracle prices,
 * then divides by total shares. 
 */
export const getVaultShareTokenPrice = async (
  accessToken: string
): Promise<{ shareTokenAddress: string; pricePerShare: string }> => {
  const vaultAddress = await getVaultAddress(accessToken);

  if (!vaultAddress) {
    return { shareTokenAddress: "", pricePerShare: "0" };
  }

  const vaultData = await getVaultData(accessToken, vaultAddress);

  if (!vaultData) {
    return { shareTokenAddress: "", pricePerShare: "0" };
  }

  const shareToken = vaultData.shareToken;
  const botExecutor = vaultData.botExecutor;
  const priceOracleAddress = vaultData.priceOracle || "";
  const supportedAssetAddresses: string[] = (vaultData.supportedAssets || [])
    .filter((addr: string) => addr && addr !== "0000000000000000000000000000000000000000");

  // Calculate total equity: sum of (balance * price) for each asset
  let totalEquity = 0n;
  for (const assetAddress of supportedAssetAddresses) {
    const balance = await getTokenBalance(accessToken, assetAddress, botExecutor);
    const balanceBN = safeBigInt(balance);
    const priceUsd = await getAssetPrice(accessToken, priceOracleAddress, assetAddress);
    const priceBN = safeBigInt(priceUsd);

    if (priceBN > 0n) {
      totalEquity += (balanceBN * priceBN) / WAD;
    }
  }

  // Get total shares
  const totalShares = await getTokenTotalSupply(accessToken, shareToken);
  const totalSharesBN = safeBigInt(totalShares);

  // NAV per share
  let pricePerShare = WAD.toString();
  if (totalSharesBN > 0n && totalEquity > 0n) {
    pricePerShare = ((totalEquity * WAD) / totalSharesBN).toString();
  }

  return { shareTokenAddress: shareToken, pricePerShare };
};

/**
 * Get user's token balances for all supported vault assets
 * Returns only tokens where the user has a positive balance
 */
export const getUserBalances = async (
  accessToken: string,
  userAddress: string
): Promise<{ balances: UserTokenBalance[] }> => {
  const vaultAddress = await getVaultAddress(accessToken);

  if (!vaultAddress) {
    return { balances: [] };
  }

  const vaultData = await getVaultData(accessToken, vaultAddress);

  if (!vaultData) {
    return { balances: [] };
  }

  const priceOracleAddress = vaultData.priceOracle || "";
  const supportedAssetAddresses: string[] = (vaultData.supportedAssets || [])
    .filter((addr: string) => addr && addr !== "0000000000000000000000000000000000000000");

  const balances: UserTokenBalance[] = [];

  for (const assetAddress of supportedAssetAddresses) {
    // Get user's balance for this asset
    const balance = await getTokenBalance(accessToken, assetAddress, userAddress);
    const balanceBN = safeBigInt(balance);

    // Only include tokens where user has a positive balance
    if (balanceBN > 0n) {
      const tokenInfo = await getTokenInfo(accessToken, assetAddress);
      const priceUsd = await getAssetPrice(accessToken, priceOracleAddress, assetAddress);

      balances.push({
        address: assetAddress,
        symbol: tokenInfo.symbol,
        name: tokenInfo.name,
        balance,
        priceUsd,
        images: tokenInfo.images,
      });
    }
  }

  return { balances };
};

/**
 * Get comprehensive vault info (global state)
 */
export const getVaultInfo = async (accessToken: string): Promise<VaultInfo> => {
  const vaultAddress = await getVaultAddress(accessToken);
  
  if (!vaultAddress) {
    return {
      totalEquity: "0",
      withdrawableEquity: "0",
      totalShares: "0",
      navPerShare: "0",
      apy: "0",
      paused: false,
      assets: [],
      deficitAssets: [],
      shareTokenSymbol: "sVAULT",
      shareTokenAddress: "",
      botExecutor: "",
    };
  }

  const vaultData = await getVaultData(accessToken, vaultAddress);
  
  if (!vaultData) {
    throw new Error("Vault not found");
  }

  const shareToken = vaultData.shareToken;
  const botExecutor = vaultData.botExecutor;
  const paused = vaultData._paused || false;
  const priceOracleAddress = vaultData.priceOracle || "";

  // Get supported assets - already extracted as string array from getVaultData
  const supportedAssetAddresses: string[] = (vaultData.supportedAssets || [])
    .filter((addr: string) => addr && addr !== "0000000000000000000000000000000000000000");

  // Get share token info
  const shareTokenInfo = await getTokenInfo(accessToken, shareToken);
  const totalShares = await getTokenTotalSupply(accessToken, shareToken);

  // Build min reserve map
  const minReserveMap = new Map<string, string>();
  for (const entry of vaultData.minReserve || []) {
    if (entry.asset) {
      minReserveMap.set(entry.asset.toLowerCase(), entry.amount || "0");
    }
  }
  // Calculate totals and build asset list
  let totalEquity = 0n;
  let withdrawableEquity = 0n;
  const assets: VaultAsset[] = [];
  const deficitAssets: string[] = [];

  for (const assetAddress of supportedAssetAddresses) {
    // Get token info
    const tokenInfo = await getTokenInfo(accessToken, assetAddress);
    
    // Get balance held by bot executor
    const balance = await getTokenBalance(accessToken, assetAddress, botExecutor);
    const balanceBN = safeBigInt(balance);
    
    // Get min reserve
    const minReserve = minReserveMap.get(assetAddress.toLowerCase()) || "0";
    const minReserveBN = safeBigInt(minReserve);
    
    // Calculate withdrawable
    const withdrawable = balanceBN > minReserveBN ? (balanceBN - minReserveBN).toString() : "0";
    const withdrawableBN = safeBigInt(withdrawable);
    
    // Get price
    const priceUsd = await getAssetPrice(accessToken, priceOracleAddress, assetAddress);
    const priceBN = safeBigInt(priceUsd);
    
    // Calculate value in USD
    const valueUsd = priceBN > 0n ? ((balanceBN * priceBN) / WAD).toString() : "0";
    const withdrawableValueUsd = priceBN > 0n ? ((withdrawableBN * priceBN) / WAD) : 0n;
    
    totalEquity += safeBigInt(valueUsd);
    withdrawableEquity += withdrawableValueUsd;
    
    // Check for deficit
    if (balanceBN < minReserveBN) {
      deficitAssets.push(assetAddress);
    }
    
    assets.push({
      address: assetAddress,
      symbol: tokenInfo.symbol,
      name: tokenInfo.name,
      balance,
      minReserve,
      withdrawable,
      priceUsd,
      valueUsd,
      images: tokenInfo.images,
    });
  }

  // Calculate NAV per share
  let navPerShare = WAD.toString(); // Default to $1 per share
  const totalSharesBN = safeBigInt(totalShares);
  if (totalSharesBN > 0n && totalEquity > 0n) {
    navPerShare = ((totalEquity * WAD) / totalSharesBN).toString();
  }

  // Calculate APY based on 30-day performance
  const apy = await getAPY(
    accessToken,
    vaultAddress,
    totalEquity,
    botExecutor,
    priceOracleAddress,
    supportedAssetAddresses
  );

  return {
    totalEquity: totalEquity.toString(),
    withdrawableEquity: withdrawableEquity.toString(),
    totalShares,
    navPerShare,
    apy,
    paused,
    assets,
    deficitAssets,
    shareTokenSymbol: shareTokenInfo.symbol,
    shareTokenAddress: shareToken,
    botExecutor,
  };
};

/**
 * Get user's position in the vault
 */
export const getUserPosition = async (
  accessToken: string,
  userAddress: string
): Promise<UserPosition> => {
  const vaultAddress = await getVaultAddress(accessToken);
  
  if (!vaultAddress) {
    return {
      userShares: "0",
      userValueUsd: "0",
      allTimeEarnings: "0",
    };
  }

  const vaultData = await getVaultData(accessToken, vaultAddress);
  
  if (!vaultData?.shareToken) {
    return {
      userShares: "0",
      userValueUsd: "0",
      allTimeEarnings: "0",
    };
  }

  const shareToken = vaultData.shareToken;

  // Get user's share balance
  const userShares = await getTokenBalance(accessToken, shareToken, userAddress);
  const userSharesBN = safeBigInt(userShares);

  // Get total shares
  const totalShares = await getTokenTotalSupply(accessToken, shareToken);
  const totalSharesBN = safeBigInt(totalShares);

  // Get vault info for NAV calculation
  const vaultInfo = await getVaultInfo(accessToken);
  const navPerShare = safeBigInt(vaultInfo.navPerShare);

  // Calculate user's USD value
  const userValueUsd = userSharesBN > 0n ? ((userSharesBN * navPerShare) / WAD).toString() : "0";

  // Calculate all-time earnings
  // earnings = currentValueUsd - (totalDepositedUsd - totalWithdrawnUsd)
  const { totalDepositedUsd, totalWithdrawnUsd } = await getUserDepositWithdrawTotals(
    accessToken,
    vaultAddress,
    userAddress
  );
  const netDeposited = totalDepositedUsd - totalWithdrawnUsd;
  const allTimeEarnings = (safeBigInt(userValueUsd) - netDeposited).toString();

  return {
    userShares,
    userValueUsd,
    allTimeEarnings,
  };
};

/**
 * Deposit tokens into the vault
 */
export const deposit = async (
  accessToken: string,
  userAddress: string,
  body: { token: string; amount: string }
): Promise<{ status: string; hash: string; sharesMinted?: string }> => {
  const vaultAddress = await getVaultAddress(accessToken);
  
  if (!vaultAddress) {
    throw new Error("Vault not found");
  }

  const { token, amount } = body;

  // Build transaction: approve + deposit
  const tx: FunctionInput[] = [
    {
      contractName: extractContractName(Token),
      contractAddress: token,
      method: "approve",
      args: { spender: vaultAddress, value: amount },
    },
    {
      contractName: extractContractName(Vault),
      contractAddress: vaultAddress,
      method: "deposit",
      args: { assetIn: token, amountIn: amount },
    },
  ];

  const builtTx = await buildFunctionTx(tx, userAddress, accessToken);
  
  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};

export interface WithdrawBasketItem {
  address: string;
  symbol: string;
  name: string;
  weightPercent: string;
  usdValue: string;
  tokenAmount: string;
  included: boolean;
  images?: { value: string }[];
}

/**
 * Preview withdrawal basket - shows what tokens user will receive
 * Mirrors the smart contract's _executeWithdrawalPayouts logic
 */
export const getWithdrawPreview = async (
  accessToken: string,
  amountUsd: string
): Promise<{ basket: WithdrawBasketItem[] }> => {
  const vaultAddress = await getVaultAddress(accessToken);

  if (!vaultAddress) {
    return { basket: [] };
  }

  const vaultData = await getVaultData(accessToken, vaultAddress);

  if (!vaultData) {
    return { basket: [] };
  }

  const botExecutor = vaultData.botExecutor;
  const priceOracleAddress = vaultData.priceOracle || "";
  const supportedAssetAddresses: string[] = (vaultData.supportedAssets || [])
    .filter((addr: string) => addr && addr !== "0000000000000000000000000000000000000000");

  // Build min reserve map
  const minReserveMap = new Map<string, string>();
  for (const entry of vaultData.minReserve || []) {
    if (entry.asset) {
      minReserveMap.set(entry.asset.toLowerCase(), entry.amount || "0");
    }
  }

  const amountUsdBN = safeBigInt(amountUsd);

  // Calculate withdrawable equity (same as contract)
  let withdrawableEquity = 0n;
  const assetData: Array<{
    address: string;
    symbol: string;
    name: string;
    balance: bigint;
    minReserve: bigint;
    withdrawable: bigint;
    price: bigint;
    withdrawableUsd: bigint;
    images?: { value: string }[];
  }> = [];

  for (const assetAddress of supportedAssetAddresses) {
    const tokenInfo = await getTokenInfo(accessToken, assetAddress);
    const balance = await getTokenBalance(accessToken, assetAddress, botExecutor);
    const balanceBN = safeBigInt(balance);
    const minReserve = minReserveMap.get(assetAddress.toLowerCase()) || "0";
    const minReserveBN = safeBigInt(minReserve);
    const priceUsd = await getAssetPrice(accessToken, priceOracleAddress, assetAddress);
    const priceBN = safeBigInt(priceUsd);

    const withdrawable = balanceBN > minReserveBN ? balanceBN - minReserveBN : 0n;
    const withdrawableUsd = priceBN > 0n ? (withdrawable * priceBN) / WAD : 0n;

    withdrawableEquity += withdrawableUsd;

    assetData.push({
      address: assetAddress,
      symbol: tokenInfo.symbol,
      name: tokenInfo.name,
      balance: balanceBN,
      minReserve: minReserveBN,
      withdrawable,
      price: priceBN,
      withdrawableUsd,
      images: tokenInfo.images,
    });
  }

  // Build basket (mirrors _executeWithdrawalPayouts logic)
  const basket: WithdrawBasketItem[] = assetData.map((asset) => {
    const included = asset.withdrawable > 0n;

    if (!included || withdrawableEquity === 0n) {
      return {
        address: asset.address,
        symbol: asset.symbol,
        name: asset.name,
        weightPercent: "0",
        usdValue: "0",
        tokenAmount: "0",
        included: false,
        images: asset.images,
      };
    }

    // Calculate weight: withdrawableUsd / withdrawableEquity * 100
    const weightPercent = Number((asset.withdrawableUsd * 10000n) / withdrawableEquity) / 100;

    // Calculate payout USD: amountUsd * withdrawableUsd / withdrawableEquity
    const payoutUsd = (amountUsdBN * asset.withdrawableUsd) / withdrawableEquity;

    // Calculate token amount: (payoutUsd * WAD) / price
    const tokenAmount = asset.price > 0n ? (payoutUsd * WAD) / asset.price : 0n;

    return {
      address: asset.address,
      symbol: asset.symbol,
      name: asset.name,
      weightPercent: weightPercent.toFixed(2),
      usdValue: payoutUsd.toString(),
      tokenAmount: tokenAmount.toString(),
      included: true,
      images: asset.images,
    };
  });

  return { basket };
};

/**
 * Withdraw from the vault by USD amount
 */
export const withdraw = async (
  accessToken: string,
  userAddress: string,
  body: { amountUsd: string }
): Promise<{ status: string; hash: string; basket?: WithdrawalBasketItem[] }> => {
  const vaultAddress = await getVaultAddress(accessToken);
  
  if (!vaultAddress) {
    throw new Error("Vault not found");
  }

  const { amountUsd } = body;

  const builtTx = await buildFunctionTx({
    contractName: extractContractName(Vault),
    contractAddress: vaultAddress,
    method: "withdraw",
    args: { amountUSD: amountUsd },
  }, userAddress, accessToken);

  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Pause the vault (admin only)
 */
export const pause = async (
  accessToken: string,
  userAddress: string
): Promise<{ status: string; hash: string }> => {
  const vaultAddress = await getVaultAddress(accessToken);
  
  if (!vaultAddress) {
    throw new Error("Vault not found");
  }

  const builtTx = await buildFunctionTx({
    contractName: extractContractName(Vault),
    contractAddress: vaultAddress,
    method: "pause",
    args: {},
  }, userAddress, accessToken);

  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};

/**
 * Unpause the vault (admin only)
 */
export const unpause = async (
  accessToken: string,
  userAddress: string
): Promise<{ status: string; hash: string }> => {
  const vaultAddress = await getVaultAddress(accessToken);
  
  if (!vaultAddress) {
    throw new Error("Vault not found");
  }

  const builtTx = await buildFunctionTx({
    contractName: extractContractName(Vault),
    contractAddress: vaultAddress,
    method: "unpause",
    args: {},
  }, userAddress, accessToken);

  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};

/**
 * Set minimum reserve for an asset (admin only)
 */
export const setMinReserve = async (
  accessToken: string,
  userAddress: string,
  body: { token: string; minReserve: string }
): Promise<{ status: string; hash: string }> => {
  const vaultAddress = await getVaultAddress(accessToken);
  
  if (!vaultAddress) {
    throw new Error("Vault not found");
  }

  const { token, minReserve } = body;

  const builtTx = await buildFunctionTx({
    contractName: extractContractName(Vault),
    contractAddress: vaultAddress,
    method: "setMinReserve",
    args: { asset: token, newMinReserve: minReserve },
  }, userAddress, accessToken);

  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};

/**
 * Set bot executor address (admin only)
 */
export const setBotExecutor = async (
  accessToken: string,
  userAddress: string,
  body: { executor: string }
): Promise<{ status: string; hash: string }> => {
  const vaultAddress = await getVaultAddress(accessToken);
  
  if (!vaultAddress) {
    throw new Error("Vault not found");
  }

  const { executor } = body;

  const builtTx = await buildFunctionTx({
    contractName: extractContractName(Vault),
    contractAddress: vaultAddress,
    method: "setBotExecutor",
    args: { newBotExecutor: executor },
  }, userAddress, accessToken);

  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};

/**
 * Add a supported asset to the vault (admin only)
 */
export const addSupportedAsset = async (
  accessToken: string,
  userAddress: string,
  body: { token: string }
): Promise<{ status: string; hash: string }> => {
  const vaultAddress = await getVaultAddress(accessToken);
  
  if (!vaultAddress) {
    throw new Error("Vault not found");
  }

  const { token } = body;

  const builtTx = await buildFunctionTx({
    contractName: extractContractName(Vault),
    contractAddress: vaultAddress,
    method: "addSupportedAsset",
    args: { asset: token },
  }, userAddress, accessToken);

  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};

/**
 * Remove a supported asset from the vault (admin only)
 */
export const removeSupportedAsset = async (
  accessToken: string,
  userAddress: string,
  body: { token: string }
): Promise<{ status: string; hash: string }> => {
  const vaultAddress = await getVaultAddress(accessToken);
  
  if (!vaultAddress) {
    throw new Error("Vault not found");
  }

  const { token } = body;

  const builtTx = await buildFunctionTx({
    contractName: extractContractName(Vault),
    contractAddress: vaultAddress,
    method: "removeSupportedAsset",
    args: { asset: token },
  }, userAddress, accessToken);

  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};

/**
 * Get bot swap transactions
 * Returns Swap events where the sender is the vault's bot executor
 */
export const getTransactions = async (
  accessToken: string,
  limit: number = 10
): Promise<{ transactions: VaultTransaction[] }> => {
  const vaultAddress = await getVaultAddress(accessToken);
  
  if (!vaultAddress) {
    return { transactions: [] };
  }

  // Get bot executor address from vault
  const vaultData = await getVaultData(accessToken, vaultAddress);
  if (!vaultData?.botExecutor) {
    return { transactions: [] };
  }
  
  const botAddress = vaultData.botExecutor;
  const transactions: VaultTransaction[] = [];

  try {
    // Fetch Swap events where the transaction sender is the bot
    const { data: swapEvents } = await cirrus.get(accessToken, "/event", {
      params: {
        select: "id,event_name,address,attributes,block_timestamp,transaction_sender",
        event_name: "eq.Swap",
        transaction_sender: `eq.${botAddress}`,
        order: "block_timestamp.desc",
        limit: limit.toString(),
      },
    });

    // Process swap events
    for (const event of swapEvents || []) {
      const attrs = event.attributes || {};
      
      // Get token symbols if addresses are available
      let tokenInInfo = { symbol: "UNKNOWN", name: "Unknown Token" };
      let tokenOutInfo = { symbol: "UNKNOWN", name: "Unknown Token" };
      
      if (attrs.tokenIn) {
        tokenInInfo = await getTokenInfo(accessToken, attrs.tokenIn);
      }
      if (attrs.tokenOut) {
        tokenOutInfo = await getTokenInfo(accessToken, attrs.tokenOut);
      }

      transactions.push({
        id: event.id || `swap-${event.block_timestamp}-${event.address}`,
        type: "swap",
        timestamp: event.block_timestamp || new Date().toISOString(),
        tokenIn: attrs.tokenIn ? {
          address: attrs.tokenIn,
          symbol: tokenInInfo.symbol,
          amount: attrs.amountIn || "0",
        } : undefined,
        tokenOut: attrs.tokenOut ? {
          address: attrs.tokenOut,
          symbol: tokenOutInfo.symbol,
          amount: attrs.amountOut || "0",
        } : undefined,
      });
    }

    return { transactions };
  } catch (error) {
    console.error("Error fetching bot swap transactions:", error);
    return { transactions: [] };
  }
};
