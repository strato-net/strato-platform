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
import { computeVaultPerformanceMetrics } from "../helpers/vaultPerformance.helper";

const {
  Vault,
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
  alpha: string;
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
}

export interface WithdrawalBasketItem {
  token: string;
  symbol: string;
  amount: string;
}

export interface VaultTransaction {
  id: string;
  type: "swap" | "liquidation";
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
  liquidation?: {
    borrower: string;
    asset: string;
    assetSymbol: string;
    collateralSeized: string;
    debtBurnedUSD: string;
  };
}

export interface UserActivityItem {
  type: "deposit" | "withdrawal";
  timestamp: string;
  valueUsd: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get the vault address from config (resolved at startup via initNetworkConfig).
 */
const getVaultAddress = (): string | null => {
  return config.vault || null;
};

/**
 * Get vault data from Cirrus
 */
const getVaultData = async (
  accessToken: string,
  vaultAddress: string
): Promise<Record<string, any> | null> => {
  try {
    const [{ data: vaultData }, { data: supportedAssetsData }, { data: minReserveData }] =
      await Promise.all([
        cirrus.get(accessToken, `/${Vault}`, {
          params: {
            select: "address,shareToken,botExecutor,_paused,priceOracle",
            address: `eq.${vaultAddress}`,
          },
        }),
        cirrus.get(accessToken, `/${Vault}-supportedAssets`, {
          params: {
            select: "value",
            address: `eq.${vaultAddress}`,
          },
        }),
        cirrus.get(accessToken, `/${Vault}-minReserve`, {
          params: {
            select: "key,value::text",
            address: `eq.${vaultAddress}`,
          },
        }),
      ]);

    if (!vaultData?.[0]) return null;

    const minReserveMap = new Map<string, string>();
    for (const item of minReserveData || []) {
      if (item.key) {
        minReserveMap.set(item.key.toLowerCase(), item.value || "0");
      }
    }

    return {
      ...vaultData[0],
      supportedAssets: (supportedAssetsData || []).map((a: any) => a.value),
      minReserveMap,
    };
  } catch (error) {
    console.error("Error fetching vault data:", error);
    return null;
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

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH HELPERS — single Cirrus query instead of N
// ═══════════════════════════════════════════════════════════════════════════════

const getBatchTokenInfo = async (
  accessToken: string,
  tokenAddresses: string[]
): Promise<Map<string, { symbol: string; name: string; images?: { value: string }[] }>> => {
  const result = new Map<string, { symbol: string; name: string; images?: { value: string }[] }>();
  if (!tokenAddresses.length) return result;

  try {
    const { data } = await cirrus.get(accessToken, `/${Token}`, {
      params: {
        address: `in.(${tokenAddresses.join(",")})`,
        select: `address,_symbol,_name,images:${Token}-images(value)`,
      },
    });

    for (const token of data || []) {
      result.set(token.address, {
        symbol: token._symbol || "UNKNOWN",
        name: token._name || "Unknown Token",
        images: token.images,
      });
    }
  } catch (error) {
    console.error("Error batch fetching token info:", error);
  }

  for (const addr of tokenAddresses) {
    if (!result.has(addr)) {
      result.set(addr, { symbol: "UNKNOWN", name: "Unknown Token" });
    }
  }
  return result;
};

const getBatchBalances = async (
  accessToken: string,
  tokenAddresses: string[],
  holderAddress: string
): Promise<Map<string, string>> => {
  const result = new Map<string, string>();
  if (!tokenAddresses.length) return result;

  try {
    const { data } = await cirrus.get(accessToken, `/${Token}-_balances`, {
      params: {
        address: `in.(${tokenAddresses.join(",")})`,
        key: `eq.${holderAddress}`,
        select: "address,value::text",
      },
    });

    for (const row of data || []) {
      result.set(row.address, row.value || "0");
    }
  } catch (error) {
    console.error("Error batch fetching balances:", error);
  }

  return result;
};

const getBatchPrices = async (
  accessToken: string,
  oracleAddress: string,
  assetAddresses: string[]
): Promise<Map<string, string>> => {
  const result = new Map<string, string>();
  if (!assetAddresses.length) return result;

  try {
    const { data } = await cirrus.get(accessToken, `/${PriceOracle}-prices`, {
      params: {
        address: `eq.${oracleAddress}`,
        key: `in.(${assetAddresses.join(",")})`,
        select: "key,value::text",
      },
    });

    for (const row of data || []) {
      result.set(row.key, row.value || "0");
    }
  } catch (error) {
    console.error("Error batch fetching prices:", error);
  }

  return result;
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
  const vaultAddress = getVaultAddress();
  if (!vaultAddress) return "";
  const vaultData = await getVaultData(accessToken, vaultAddress);
  return vaultData?.shareToken || "";
};

/**
 * Get vault config for history tracking.
 * Returns shareToken, botExecutor, and supportedAssets needed for portfolio history.
 */
export const getVaultHistoryConfig = async (
  accessToken: string
): Promise<{ shareToken: string; botExecutor: string; supportedAssets: string[] } | null> => {
  const vaultAddress = getVaultAddress();
  if (!vaultAddress) return null;
  const vaultData = await getVaultData(accessToken, vaultAddress);
  if (!vaultData) return null;
  return {
    shareToken: vaultData.shareToken || "",
    botExecutor: vaultData.botExecutor || "",
    supportedAssets: (vaultData.supportedAssets || [])
      .filter((addr: string) => addr && addr !== "0000000000000000000000000000000000000000"),
  };
};

/**
 * Lightweight function to get vault share token price (NAV per share).
 * Calculates totalEquity from supported asset balances and oracle prices,
 * then divides by total shares. 
 */
export const getVaultShareTokenPrice = async (
  accessToken: string
): Promise<{ shareTokenAddress: string; pricePerShare: string }> => {
  const vaultAddress = getVaultAddress();

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

  const [balanceMap, priceMap, totalShares] = await Promise.all([
    getBatchBalances(accessToken, supportedAssetAddresses, botExecutor),
    getBatchPrices(accessToken, priceOracleAddress, supportedAssetAddresses),
    getTokenTotalSupply(accessToken, shareToken),
  ]);

  let totalEquity = 0n;
  for (const assetAddress of supportedAssetAddresses) {
    const balanceBN = safeBigInt(balanceMap.get(assetAddress));
    const priceBN = safeBigInt(priceMap.get(assetAddress));
    if (priceBN > 0n) {
      totalEquity += (balanceBN * priceBN) / WAD;
    }
  }

  const totalSharesBN = safeBigInt(totalShares);
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
  const vaultAddress = getVaultAddress();

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

  const [balanceMap, tokenInfoMap, priceMap] = await Promise.all([
    getBatchBalances(accessToken, supportedAssetAddresses, userAddress),
    getBatchTokenInfo(accessToken, supportedAssetAddresses),
    getBatchPrices(accessToken, priceOracleAddress, supportedAssetAddresses),
  ]);

  const balances: UserTokenBalance[] = [];

  for (const assetAddress of supportedAssetAddresses) {
    const balance = balanceMap.get(assetAddress) || "0";
    if (safeBigInt(balance) > 0n) {
      const info = tokenInfoMap.get(assetAddress) || { symbol: "UNKNOWN", name: "Unknown Token" };
      balances.push({
        address: assetAddress,
        symbol: info.symbol,
        name: info.name,
        balance,
        priceUsd: priceMap.get(assetAddress) || "0",
        images: info.images,
      });
    }
  }

  return { balances };
};

let _vaultInfoCache: { data: VaultInfo; ts: number } | null = null;
const VAULT_INFO_TTL = 30_000;

/**
 * Get comprehensive vault info (global state)
 */
export const getVaultInfo = async (accessToken: string): Promise<VaultInfo> => {
  if (_vaultInfoCache && Date.now() - _vaultInfoCache.ts < VAULT_INFO_TTL) return _vaultInfoCache.data;

  const vaultAddress = getVaultAddress();
  
  if (!vaultAddress) {
    return {
      totalEquity: "0",
      withdrawableEquity: "0",
      totalShares: "0",
      navPerShare: "0",
      apy: "0",
      alpha: "0",
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
  const minReserveMap = vaultData.minReserveMap;

  const supportedAssetAddresses: string[] = (vaultData.supportedAssets || [])
    .filter((addr: string) => addr && addr !== "0000000000000000000000000000000000000000");

  const allTokenAddresses = [shareToken, ...supportedAssetAddresses];

  // Single parallel phase: batch token info + batch balances + batch prices + total supply
  const [tokenInfoMap, balanceMap, priceMap, totalShares] = await Promise.all([
    getBatchTokenInfo(accessToken, allTokenAddresses),
    getBatchBalances(accessToken, supportedAssetAddresses, botExecutor),
    getBatchPrices(accessToken, priceOracleAddress, supportedAssetAddresses),
    getTokenTotalSupply(accessToken, shareToken),
  ]);

  const shareTokenInfo = tokenInfoMap.get(shareToken);
  if (!shareTokenInfo) {
    throw new Error("Share token info not found");
  }

  let totalEquity = 0n;
  let withdrawableEquity = 0n;
  const assets: VaultAsset[] = [];
  const deficitAssets: string[] = [];
  const currentPrices = new Map<string, string>();

  for (const assetAddress of supportedAssetAddresses) {
    const info = tokenInfoMap.get(assetAddress);
    if (!info) continue;
    const balance = balanceMap.get(assetAddress) || "0";
    const balanceBN = safeBigInt(balance);

    const minReserve = minReserveMap.get(assetAddress.toLowerCase()) || "0";
    const minReserveBN = safeBigInt(minReserve);

    const withdrawable = balanceBN > minReserveBN ? (balanceBN - minReserveBN).toString() : "0";
    const withdrawableBN = safeBigInt(withdrawable);

    const priceUsd = priceMap.get(assetAddress) || "0";
    const priceBN = safeBigInt(priceUsd);
    currentPrices.set(assetAddress, priceUsd);

    const valueUsd = priceBN > 0n ? ((balanceBN * priceBN) / WAD).toString() : "0";
    const withdrawableValueUsd = priceBN > 0n ? ((withdrawableBN * priceBN) / WAD) : 0n;

    totalEquity += safeBigInt(valueUsd);
    withdrawableEquity += withdrawableValueUsd;

    if (balanceBN < minReserveBN) {
      deficitAssets.push(assetAddress);
    }

    assets.push({
      address: assetAddress,
      symbol: info.symbol,
      name: info.name,
      balance,
      minReserve,
      withdrawable,
      priceUsd,
      valueUsd,
      images: info.images,
    });
  }

  // Calculate NAV per share
  let navPerShare = WAD.toString();
  const totalSharesBN = safeBigInt(totalShares);
  if (totalSharesBN > 0n && totalEquity > 0n) {
    navPerShare = ((totalEquity * WAD) / totalSharesBN).toString();
  }

  const { apy, alpha } = await computeVaultPerformanceMetrics(
    accessToken,
    vaultAddress,
    totalEquity,
    totalSharesBN,
    shareToken,
    botExecutor,
    priceOracleAddress,
    supportedAssetAddresses,
    currentPrices
  );

  const result: VaultInfo = {
    totalEquity: totalEquity.toString(),
    withdrawableEquity: withdrawableEquity.toString(),
    totalShares,
    navPerShare,
    apy,
    alpha,
    paused,
    assets,
    deficitAssets,
    shareTokenSymbol: shareTokenInfo.symbol,
    shareTokenAddress: shareToken,
    botExecutor,
  };
  _vaultInfoCache = { data: result, ts: Date.now() };
  return result;
};

/**
 * Get user's position in the vault
 */
export const getUserPosition = async (
  accessToken: string,
  userAddress: string
): Promise<UserPosition> => {
  const noPosition: UserPosition = { userShares: "0", userValueUsd: "0" };

  const vaultAddress = getVaultAddress();
  if (!vaultAddress) return noPosition;

  const vaultData = await getVaultData(accessToken, vaultAddress);
  if (!vaultData?.shareToken) return noPosition;

  const shareToken = vaultData.shareToken;
  const botExecutor = vaultData.botExecutor;
  const priceOracleAddress = vaultData.priceOracle || "";
  const supportedAssetAddresses: string[] = (vaultData.supportedAssets || [])
    .filter((addr: string) => addr && addr !== "0000000000000000000000000000000000000000");

  const [userShares, totalShares, balanceMap, priceMap] = await Promise.all([
    getTokenBalance(accessToken, shareToken, userAddress),
    getTokenTotalSupply(accessToken, shareToken),
    getBatchBalances(accessToken, supportedAssetAddresses, botExecutor),
    getBatchPrices(accessToken, priceOracleAddress, supportedAssetAddresses),
  ]);

  const userSharesBN = safeBigInt(userShares);
  const totalSharesBN = safeBigInt(totalShares);

  let totalEquity = 0n;
  for (const assetAddress of supportedAssetAddresses) {
    const balanceBN = safeBigInt(balanceMap.get(assetAddress));
    const priceBN = safeBigInt(priceMap.get(assetAddress));
    if (priceBN > 0n) {
      totalEquity += (balanceBN * priceBN) / WAD;
    }
  }

  let navPerShare = WAD;
  if (totalSharesBN > 0n && totalEquity > 0n) {
    navPerShare = (totalEquity * WAD) / totalSharesBN;
  }

  const userValueUsd = userSharesBN > 0n ? ((userSharesBN * navPerShare) / WAD).toString() : "0";

  return { userShares, userValueUsd };
};

/**
 * Deposit tokens into the vault
 */
export const deposit = async (
  accessToken: string,
  userAddress: string,
  body: { token: string; amount: string }
): Promise<{ status: string; hash: string; sharesMinted?: string }> => {
  const vaultAddress = getVaultAddress();
  
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
  const vaultAddress = getVaultAddress();

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

  const { minReserveMap } = vaultData;
  const amountUsdBN = safeBigInt(amountUsd);

  const [tokenInfoMap, balanceMap, priceMap] = await Promise.all([
    getBatchTokenInfo(accessToken, supportedAssetAddresses),
    getBatchBalances(accessToken, supportedAssetAddresses, botExecutor),
    getBatchPrices(accessToken, priceOracleAddress, supportedAssetAddresses),
  ]);

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
    const info = tokenInfoMap.get(assetAddress) || { symbol: "UNKNOWN", name: "Unknown Token" };
    const balanceBN = safeBigInt(balanceMap.get(assetAddress));
    const minReserve = minReserveMap.get(assetAddress.toLowerCase()) || "0";
    const minReserveBN = safeBigInt(minReserve);
    const priceBN = safeBigInt(priceMap.get(assetAddress));

    const withdrawable = balanceBN > minReserveBN ? balanceBN - minReserveBN : 0n;
    const withdrawableUsd = priceBN > 0n ? (withdrawable * priceBN) / WAD : 0n;

    withdrawableEquity += withdrawableUsd;

    assetData.push({
      address: assetAddress,
      symbol: info.symbol,
      name: info.name,
      balance: balanceBN,
      minReserve: minReserveBN,
      withdrawable,
      price: priceBN,
      withdrawableUsd,
      images: info.images,
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
  const vaultAddress = getVaultAddress();
  
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
  const vaultAddress = getVaultAddress();
  
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
  const vaultAddress = getVaultAddress();
  
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
  const vaultAddress = getVaultAddress();
  
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
  const vaultAddress = getVaultAddress();
  
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
  const vaultAddress = getVaultAddress();
  
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
  const vaultAddress = getVaultAddress();
  
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
  const vaultAddress = getVaultAddress();
  
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
    // Fetch Swap and LiquidationExecuted events in parallel
    const [{ data: swapEvents }, { data: liquidationEvents }] = await Promise.all([
      cirrus.get(accessToken, "/event", {
        params: {
          select: "id,event_name,address,attributes,block_timestamp,transaction_sender",
          event_name: "eq.Swap",
          transaction_sender: `eq.${botAddress}`,
          order: "block_timestamp.desc",
          limit: limit.toString(),
        },
      }),
      cirrus.get(accessToken, "/event", {
        params: {
          select: "id,event_name,address,attributes,block_timestamp,transaction_sender",
          event_name: "eq.LiquidationExecuted",
          transaction_sender: `eq.${botAddress}`,
          order: "block_timestamp.desc",
          limit: limit.toString(),
        },
      }),
    ]);

    // Collect all unique token addresses across both event types
    const tokenAddresses = new Set<string>();
    for (const event of swapEvents || []) {
      const attrs = event.attributes || {};
      if (attrs.tokenIn) tokenAddresses.add(attrs.tokenIn);
      if (attrs.tokenOut) tokenAddresses.add(attrs.tokenOut);
    }
    for (const event of liquidationEvents || []) {
      const attrs = event.attributes || {};
      if (attrs.asset) tokenAddresses.add(attrs.asset);
    }

    const tokenInfoMap = await getBatchTokenInfo(accessToken, Array.from(tokenAddresses));

    for (const event of swapEvents || []) {
      const attrs = event.attributes || {};
      const tokenInInfo = tokenInfoMap.get(attrs.tokenIn) || { symbol: "UNKNOWN", name: "Unknown Token" };
      const tokenOutInfo = tokenInfoMap.get(attrs.tokenOut) || { symbol: "UNKNOWN", name: "Unknown Token" };

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

    for (const event of liquidationEvents || []) {
      const attrs = event.attributes || {};
      const assetInfo = tokenInfoMap.get(attrs.asset) || { symbol: "UNKNOWN", name: "Unknown Token" };

      transactions.push({
        id: event.id || `liq-${event.block_timestamp}-${event.address}`,
        type: "liquidation",
        timestamp: event.block_timestamp || new Date().toISOString(),
        liquidation: {
          borrower: attrs.borrower || "",
          asset: attrs.asset || "",
          assetSymbol: assetInfo.symbol,
          collateralSeized: attrs.collateralOut || "0",
          debtBurnedUSD: attrs.debtBurnedUSD || "0",
        },
      });
    }

    // Sort merged list by timestamp descending, then trim to limit
    transactions.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    if (transactions.length > limit) {
      transactions.length = limit;
    }

    return { transactions };
  } catch (error) {
    console.error("Error fetching bot transactions:", error);
    return { transactions: [] };
  }
};

/**
 * Get user's deposit and withdrawal activity
 */
export const getUserActivity = async (
  accessToken: string,
  userAddress: string,
  limit: number = 20
): Promise<{ activity: UserActivityItem[] }> => {
  const vaultAddress = getVaultAddress();

  if (!vaultAddress) {
    return { activity: [] };
  }

  try {
    const [{ data: depositEvents }, { data: withdrawEvents }] = await Promise.all([
      cirrus.get(accessToken, `/${Vault}-Deposited`, {
        params: {
          select: "depositValueUSD::text,block_timestamp",
          address: `eq.${vaultAddress}`,
          user: `eq.${userAddress}`,
          order: "block_timestamp.desc",
          limit: limit.toString(),
        },
      }),
      cirrus.get(accessToken, `/${Vault}-Withdrawn`, {
        params: {
          select: "withdrawValueUSD::text,block_timestamp",
          address: `eq.${vaultAddress}`,
          user: `eq.${userAddress}`,
          order: "block_timestamp.desc",
          limit: limit.toString(),
        },
      }),
    ]);

    const activity: UserActivityItem[] = [];

    for (const evt of depositEvents || []) {
      activity.push({
        type: "deposit",
        timestamp: evt.block_timestamp || "",
        valueUsd: evt.depositValueUSD || "0",
      });
    }

    for (const evt of withdrawEvents || []) {
      activity.push({
        type: "withdrawal",
        timestamp: evt.block_timestamp || "",
        valueUsd: evt.withdrawValueUSD || "0",
      });
    }

    activity.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    if (activity.length > limit) {
      activity.length = limit;
    }

    return { activity };
  } catch (error) {
    console.error("Error fetching user activity:", error);
    return { activity: [] };
  }
};
