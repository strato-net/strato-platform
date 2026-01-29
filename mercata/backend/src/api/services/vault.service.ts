/**
 * Vault Service - Handles Multi-Asset Vault operations
 */

import { strato, cirrus } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { FunctionInput } from "../../types/types";
import { postAndWaitForTx } from "../../utils/txHelper";
import { extractContractName } from "../../utils/utils";
import { StratoPaths, constants } from "../../config/constants";

const {
  Vault,
  VaultFactory,
  vaultFactory,
  Token,
  PriceOracle,
} = constants;

const WAD = BigInt(10) ** BigInt(18);

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
 * Get the primary vault address from VaultFactory
 * For now, we use the first vault in the factory's allVaults array
 */
const getVaultAddress = async (accessToken: string): Promise<string | null> => {
  try {
    // In Cirrus, arrays are stored in separate tables: ContractName-arrayName
    const { data } = await cirrus.get(accessToken, `/${VaultFactory}-allVaults`, {
      params: {
        select: "value",
        address: `eq.${vaultFactory}`,
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
    console.log(`[APY DEBUG] getHistoricalTokenBalance: token=${tokenAddress}, holder=${holderAddress}, date=${date}`);
    const { data } = await cirrus.get(accessToken, "/history@mapping", {
      params: {
        address: `eq.${tokenAddress}`,
        collection_name: "eq._balances",
        "key->>key": `eq.${holderAddress}`,
        valid_from: `lte.${date}`,
        valid_to: `gte.${date}`,
      },
    });

    console.log(`[APY DEBUG] getHistoricalTokenBalance response:`, JSON.stringify(data));
    // value is a direct number field
    const value = data?.[0]?.value;
    const result = value ? String(BigInt(Math.floor(value))) : "0";
    console.log(`[APY DEBUG] getHistoricalTokenBalance result: ${result}`);
    return result;
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
    console.log(`[APY DEBUG] getHistoricalAssetPrice: oracle=${oracleAddress}, asset=${assetAddress}, date=${date}`);
    const { data } = await cirrus.get(accessToken, "/history@mapping", {
      params: {
        address: `eq.${oracleAddress}`,
        collection_name: "eq.prices",
        "key->>key": `eq.${assetAddress}`,
        valid_from: `lte.${date}`,
        valid_to: `gte.${date}`,
      },
    });

    console.log(`[APY DEBUG] getHistoricalAssetPrice response:`, JSON.stringify(data));
    // value is a direct number field
    const value = data?.[0]?.value;
    const result = value ? String(BigInt(Math.floor(value))) : "0";
    console.log(`[APY DEBUG] getHistoricalAssetPrice result: ${result}`);
    return result;
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
    // Get historical balance
    const balance = await getHistoricalTokenBalance(accessToken, assetAddress, botExecutor, date);
    const balanceBN = BigInt(balance);

    // Get historical price
    const price = await getHistoricalAssetPrice(accessToken, priceOracleAddress, assetAddress, date);
    const priceBN = BigInt(price);

    // Calculate value: (balance * price) / WAD
    if (priceBN > 0n) {
      totalEquity += (balanceBN * priceBN) / WAD;
    }
  }

  return totalEquity;
};

/**
 * Get the first deposit date for the vault
 */
const getFirstDepositDate = async (
  accessToken: string,
  vaultAddress: string
): Promise<string | null> => {
  try {
    const { data } = await cirrus.get(accessToken, `/${Vault}-Deposited`, {
      params: {
        select: "block_timestamp",
        address: `eq.${vaultAddress}`,
        order: "block_timestamp.asc",
        limit: "1",
      },
    });

    if (!data?.[0]?.block_timestamp) {
      return null;
    }

    // Parse the timestamp and return YYYY-MM-DD format
    const timestamp = data[0].block_timestamp;
    // Timestamp format: "2025-01-28 01:46:31 UTC"
    const date = new Date(timestamp);
    return date.toISOString().split("T")[0];
  } catch (error) {
    console.error("Error fetching first deposit date:", error);
    return null;
  }
};

/**
 * Get APY for the vault based on performance over time
 * Uses 30-day period if available, otherwise uses time since first deposit
 * Formula: profit = (currentEquity - startEquity) + totalWithdrawals - totalDeposits
 * APY = ((1 + periodReturn)^(365/days)) - 1
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
    console.log(`[APY DEBUG] getAPY called with:`);
    console.log(`  vaultAddress: ${vaultAddress}`);
    console.log(`  currentEquity: ${currentEquity.toString()}`);
    console.log(`  botExecutor: ${botExecutor}`);
    console.log(`  priceOracleAddress: ${priceOracleAddress}`);
    console.log(`  supportedAssets: ${JSON.stringify(supportedAssets)}`);

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    let startDate = thirtyDaysAgo.toISOString().split("T")[0]; // YYYY-MM-DD
    let daysInPeriod = 30;

    console.log(`[APY DEBUG] Trying 30-day period, startDate: ${startDate}`);

    // Get historical equity from 30 days ago
    let startEquity = await getHistoricalEquity(
      accessToken,
      vaultAddress,
      botExecutor,
      priceOracleAddress,
      supportedAssets,
      startDate
    );
    console.log(`[APY DEBUG] startEquity (30 days): ${startEquity.toString()}`);

    // If no historical equity from 30 days ago, fall back to first deposit date
    if (startEquity === 0n) {
      console.log(`[APY DEBUG] No data from 30 days ago, finding first deposit date...`);
      
      const firstDepositDate = await getFirstDepositDate(accessToken, vaultAddress);
      console.log(`[APY DEBUG] firstDepositDate: ${firstDepositDate}`);
      
      if (!firstDepositDate) {
        console.log(`[APY DEBUG] No deposits found, returning 0 APY`);
        return "0";
      }

      // Calculate days since first deposit
      const firstDepositTime = new Date(firstDepositDate).getTime();
      const nowTime = now.getTime();
      daysInPeriod = Math.floor((nowTime - firstDepositTime) / (24 * 60 * 60 * 1000));
      console.log(`[APY DEBUG] daysInPeriod since first deposit: ${daysInPeriod}`);

      // Need at least 1 day of data
      if (daysInPeriod < 1) {
        console.log(`[APY DEBUG] Vault is less than 1 day old, returning 0 APY`);
        return "0";
      }

      // Use the day AFTER first deposit as start date (first deposit establishes initial equity)
      const dayAfterFirstDeposit = new Date(firstDepositTime + 24 * 60 * 60 * 1000);
      startDate = dayAfterFirstDeposit.toISOString().split("T")[0];
      console.log(`[APY DEBUG] Using startDate (day after first deposit): ${startDate}`);

      // Get historical equity from that date
      startEquity = await getHistoricalEquity(
        accessToken,
        vaultAddress,
        botExecutor,
        priceOracleAddress,
        supportedAssets,
        startDate
      );
      console.log(`[APY DEBUG] startEquity (from first deposit + 1 day): ${startEquity.toString()}`);

      // If still no equity, use the first deposit value as starting point
      if (startEquity === 0n) {
        console.log(`[APY DEBUG] Still no historical equity, using first deposit total as startEquity`);
        const { totalDepositsUsd: firstDayDeposits } = await getDepositsWithdrawalsInPeriod(
          accessToken,
          vaultAddress,
          firstDepositDate
        );
        // For the first period, startEquity is approximately the deposits made
        // This is a simplification but reasonable for new vaults
        startEquity = firstDayDeposits;
        startDate = firstDepositDate;
        console.log(`[APY DEBUG] Using first deposits as startEquity: ${startEquity.toString()}`);
        
        if (startEquity === 0n) {
          console.log(`[APY DEBUG] No starting equity found, returning 0 APY`);
          return "0";
        }
      }
    }

    // Get deposits and withdrawals in the period
    const { totalDepositsUsd, totalWithdrawalsUsd } = await getDepositsWithdrawalsInPeriod(
      accessToken,
      vaultAddress,
      startDate
    );
    console.log(`[APY DEBUG] totalDepositsUsd: ${totalDepositsUsd.toString()}`);
    console.log(`[APY DEBUG] totalWithdrawalsUsd: ${totalWithdrawalsUsd.toString()}`);

    // Calculate profit: (currentEquity - startEquity) + totalWithdrawals - totalDeposits
    const profit = (currentEquity - startEquity) + totalWithdrawalsUsd - totalDepositsUsd;
    console.log(`[APY DEBUG] profit: ${profit.toString()}`);

    // Calculate period return: profit / startEquity
    const periodReturnScaled = (profit * WAD) / startEquity;
    console.log(`[APY DEBUG] periodReturnScaled: ${periodReturnScaled.toString()}`);

    // Calculate APY: ((1 + periodReturn)^(365/daysInPeriod)) - 1
    const periodReturn = Number(periodReturnScaled) / Number(WAD);
    console.log(`[APY DEBUG] periodReturn: ${periodReturn}`);
    console.log(`[APY DEBUG] daysInPeriod for annualization: ${daysInPeriod}`);
    
    const apy = Math.pow(1 + periodReturn, 365 / daysInPeriod) - 1;
    console.log(`[APY DEBUG] apy (decimal): ${apy}`);

    // Convert back to WAD format (18 decimals)
    const apyWad = BigInt(Math.round(apy * Number(WAD)));
    console.log(`[APY DEBUG] apyWad: ${apyWad.toString()}`);

    return apyWad.toString();
  } catch (error) {
    console.error("Error calculating APY:", error);
    return "0";
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
    const balanceBN = BigInt(balance);
    
    // Get min reserve
    const minReserve = minReserveMap.get(assetAddress.toLowerCase()) || "0";
    const minReserveBN = BigInt(minReserve);
    
    // Calculate withdrawable
    const withdrawable = balanceBN > minReserveBN ? (balanceBN - minReserveBN).toString() : "0";
    const withdrawableBN = BigInt(withdrawable);
    
    // Get price
    const priceUsd = await getAssetPrice(accessToken, priceOracleAddress, assetAddress);
    const priceBN = BigInt(priceUsd);
    
    // Calculate value in USD
    const valueUsd = priceBN > 0n ? ((balanceBN * priceBN) / WAD).toString() : "0";
    const withdrawableValueUsd = priceBN > 0n ? ((withdrawableBN * priceBN) / WAD) : 0n;
    
    totalEquity += BigInt(valueUsd);
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
  const totalSharesBN = BigInt(totalShares);
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
  const userSharesBN = BigInt(userShares);

  // Get total shares
  const totalShares = await getTokenTotalSupply(accessToken, shareToken);
  const totalSharesBN = BigInt(totalShares);

  // Get vault info for NAV calculation
  const vaultInfo = await getVaultInfo(accessToken);
  const navPerShare = BigInt(vaultInfo.navPerShare);

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
  const allTimeEarnings = (BigInt(userValueUsd) - netDeposited).toString();

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
