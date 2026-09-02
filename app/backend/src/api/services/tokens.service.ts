import { cirrus, strato, eth } from "../../utils/appApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { usc } from "../../utils/importer";
import { extractContractName } from "../../utils/utils";
import { StratoPaths, constants } from "../../config/constants";
import { getPool as getLendingRegistry } from "./lending.service";
import { getCompletePriceMap } from "../helpers/oracle.helper";
import { getOraclePrices, getTokenPriceMetrics } from "./oracle.service";
import { getTokenDetails } from "../helpers/cirrusHelpers";
import * as config from "../../config/config";
import { listVaultDefs } from "./yieldVault.service";

const {
  tokenSelectFields,
  tokenBalanceSelectFields,
  Token,
  PriceOracle,
  tokenFactory,
  TokenFactory,
  CDPEngine,
  Voucher,
  CollateralVault,
  YieldVault,
  SaveUSDSTVault,
} = constants;

const normalizeAddress = (address?: string | null) =>
  (address || "").toLowerCase().replace(/^0x/, "");

/**
 * Market cap in USD = (price_wei * totalSupply_wei) / 10^36.
 * Divided by 10^36 because both values carry 18 decimals.
 * Returns a decimal string with 2 decimal places.
 */
const calculateMarketCap = (
  price?: string | bigint | null,
  totalSupply?: string | bigint | null
): string => {
  try {
    const priceWei = BigInt(price || "0");
    const totalSupplyWei = BigInt(totalSupply || "0");
    if (priceWei === 0n || totalSupplyWei === 0n) return "0";

    const marketCapWei = priceWei * totalSupplyWei;
    const wholePart = (marketCapWei / BigInt(10) ** BigInt(36)).toString();
    const fractionalWei = marketCapWei % (BigInt(10) ** BigInt(36));
    const fractionalPart = (fractionalWei * BigInt(100) / (BigInt(10) ** BigInt(36))).toString().padStart(2, '0');

    return `${wholePart}.${fractionalPart}`;
  } catch (error) {
    console.error(`Error calculating market cap for price=${price} totalSupply=${totalSupply}:`, error);
    return "0.00";
  }
};

const getConfiguredYieldVaultDefs = () =>
  listVaultDefs()
    .filter((vault) => Boolean(vault.address));

const isConfiguredYieldVault = (address?: string | null) => {
  const normalized = normalizeAddress(address);
  if (!normalized) return false;
  return getConfiguredYieldVaultDefs().some((vault) => normalizeAddress(vault.address) === normalized);
};

const isConfiguredSaveUsdstVault = (address?: string | null) => {
  const vault = config.saveUsdstVault;
  if (!vault) return false;
  return normalizeAddress(address) === normalizeAddress(vault);
};

const getTransferContractName = (address?: string | null) => {
  if (isConfiguredSaveUsdstVault(address)) return "SaveUSDSTVault";
  if (isConfiguredYieldVault(address)) return "YieldVault";
  return extractContractName(Token);
};

const getYieldVaultTransferableTokens = async (accessToken: string, userAddress: string) => {
  const vaultDefs = getConfiguredYieldVaultDefs();
  const vaultAddresses = vaultDefs.map((vault) => vault.address);
  if (vaultAddresses.length === 0) return [];

  try {
    const { data: balanceRows } = await cirrus.get(accessToken, `/${YieldVault}-_balances`, {
      params: {
        address: `in.(${vaultAddresses.join(",")})`,
        key: `eq.${userAddress}`,
        value: "gt.0",
        select: "address,user:key,balance:value::text",
      },
    });

    const balances = (balanceRows || []).filter((row: any) => row.balance !== "0");
    if (balances.length === 0) return [];

    const heldVaultAddresses = Array.from(new Set(balances.map((row: any) => row.address).filter(Boolean)));
    const { data: vaultRows } = await cirrus.get(accessToken, `/${YieldVault}`, {
      params: {
        address: `in.(${heldVaultAddresses.join(",")})`,
        select: "address,_name,_symbol,_paused",
      },
    });

    const vaultByAddress = new Map((vaultRows || []).map((vault: any) => [normalizeAddress(vault.address), vault]));
    const defByAddress = new Map(vaultDefs.map((vault) => [normalizeAddress(vault.address), vault]));

    return balances.map((row: any) => {
      const vault = (vaultByAddress.get(normalizeAddress(row.address)) || {}) as any;
      const def = defByAddress.get(normalizeAddress(row.address));
      const paused = vault._paused === true;

      return {
        address: row.address,
        user: row.user || userAddress,
        balance: row.balance,
        collateralBalance: "0",
        token: {
          address: row.address,
          _name: vault._name || def?.name || "Yield Vault",
          _symbol: vault._symbol || def?.shareSymbol || "YV",
          status: paused ? "1" : "2",
          _paused: paused,
        },
      };
    });
  } catch {
    return [];
  }
};

const getSaveUsdstVaultTransferableTokens = async (accessToken: string, userAddress: string) => {
  const vaultAddress = config.saveUsdstVault;
  if (!vaultAddress) return [];

  try {
    const { data: balanceRows } = await cirrus.get(accessToken, `/${SaveUSDSTVault}-_balances`, {
      params: {
        address: `eq.${vaultAddress}`,
        key: `eq.${userAddress}`,
        value: "gt.0",
        select: "address,user:key,value::text",
      },
    });

    const balances = (balanceRows || []).filter((row: any) => row.value && row.value !== "0");
    if (balances.length === 0) return [];

    const { data: vaultRows } = await cirrus.get(accessToken, `/${SaveUSDSTVault}`, {
      params: {
        address: `eq.${vaultAddress}`,
        select: "address,_name,_symbol,_paused",
      },
    });

    const vault = (vaultRows?.[0] || {}) as any;
    const paused = vault._paused === true;

    return balances.map((row: any) => ({
      address: row.address || vaultAddress,
      user: row.user || userAddress,
      balance: row.value,
      collateralBalance: "0",
      token: {
        address: row.address || vaultAddress,
        _name: vault._name || "Save USDST Vault",
        _symbol: vault._symbol || "saveUSDST",
        status: paused ? "1" : "2",
        _paused: paused,
      },
    }));
  } catch {
    return [];
  }
};

// Get all tokens
export const getTokens = async (
  accessToken: string,
  rawParams: Record<string, string | undefined> = {}
) => {
  try {
    // Filter out undefined
    let params = Object.fromEntries(
      Object.entries(rawParams).filter(([_, v]) => v !== undefined)
    ) as Record<string, string>;

    // use tokenBalanceSelectFields if no select is provided
    if (!params.select) {
      params.select = tokenSelectFields.join(",");
    }

    // Fetch tokens and lending data in parallel
    const [response, lendingResponse] = await Promise.all([
      cirrus.get(accessToken, "/" + Token, { params }),
      getLendingRegistry(accessToken, {
        select: `collateralVault:collateralVault_fkey(userCollaterals:${constants.CollateralVault}-userCollaterals(user:key,asset:key2,amount:value::text)),oracle:priceOracle_fkey(address,prices:${PriceOracle}-prices(key,value::text))`
      })
    ]);

    if (response.status !== 200) {
      throw new Error(`Error fetching tokens: ${response.statusText}`);
    }

    if (!response.data) {
      throw new Error("Tokens data is empty");
    }

    // Process collateral data
    const collateralMap = new Map<string, string>();
    const userCollaterals = lendingResponse.collateralVault?.userCollaterals || [];
    userCollaterals
      .filter((c: any) => c.user && c.asset && c.amount && c.amount !== "0")
      .forEach((c: any) => {
        collateralMap.set(`${c.user}-${c.asset}`, c.amount);
      });

    // Process price data
    const priceMap = await getCompletePriceMap(accessToken);

    return (response.data as any[]).map((token) => ({
      ...token,
      price: priceMap.get(token.address) || "0",
      marketCap: calculateMarketCap(priceMap.get(token.address), token._totalSupply),
      balances: (token.balances || []).map((balance: any) => {
        // If this user has collateral for this token, add collateral info
        if (balance.user && token.address) {
          const collateralKey = `${balance.user}-${token.address}`;
          const collateralAmount = collateralMap.get(collateralKey);
          if (collateralAmount) {
            return {
              ...balance,
              collateralBalance: collateralAmount
            };
          }
        }
        return balance;
      })
    }));
  } catch (error) {
    throw error;
  }
};

/**
 * Get a specific token balance for a user
 * Returns the balance as a string, or "0" if not found
 */
export const getTokenBalanceForUser = async (
  accessToken: string,
  tokenAddress: string,
  userAddress: string
): Promise<string> => {
  const tokenData = await getTokens(accessToken, {
    address: `eq.${tokenAddress}`,
    select: `address,balances:${Token}-_balances(user:key,balance:value::text)`,
    "balances.key": `eq.${userAddress}`
  });

  const token = tokenData?.[0];
  const userBalance = token?.balances?.find((b: any) => b.user === userAddress)?.balance;
  return userBalance || "0";
};

// Get user tokens
export const getBalance = async (
  accessToken: string,
  address: string,
  rawParams: Record<string, string | undefined> = {}
) => {
  const params = {
    ...Object.fromEntries(Object.entries(rawParams).filter(([_, v]) => v !== undefined)),
    key: `eq.${address}`,
    select: rawParams.select || tokenBalanceSelectFields.join(","),
  };
  const includeSaveUsdstVault = !rawParams.address
    || normalizeAddress(rawParams.address).includes(normalizeAddress(config.saveUsdstVault));

  const [balances, saveUsdstVaultTokens, collaterals, cdps, rawPrices] = await Promise.all([
    cirrus.get(accessToken, "/" + Token + "-_balances", { params }),
    includeSaveUsdstVault
      ? getSaveUsdstVaultTransferableTokens(accessToken, address)
      : Promise.resolve([]),
    cirrus.get(accessToken, "/" + CollateralVault + "-userCollaterals", {
      params: {
        select: "user:key,asset:key2,amount:value::text",
        key: `eq.${address}`,
        value: `gt.0`
      }
    }),
    cirrus.get(accessToken, `/${CDPEngine}-vaults`, {
      params: {
        select: "user:key,asset:key2,amount:value->>collateral::text",
        key: `eq.${address}`,
        "value->>collateral": `gt.0`
      }
    }),
    getCompletePriceMap(accessToken)
  ]);

  const collateralMap = new Map<string, bigint>();
  for (const c of collaterals.data || [])
    collateralMap.set(c.asset, BigInt(c.amount));
  for (const v of cdps.data || [])
    collateralMap.set(
      v.asset,
      (collateralMap.get(v.asset) || 0n) + BigInt(v.amount || "0")
    );

  const balanceData = balances.data || [];
  const balanceAddresses = new Set(balanceData.map((b: any) => b.address));
  const tokensWithCollateralOnly = [...collateralMap.keys()].filter(a => !balanceAddresses.has(a));

  const tokenDetails =
    tokensWithCollateralOnly.length > 0
      ? await getTokenDetails(accessToken, tokensWithCollateralOnly)
      : new Map();

  const allTokens = [
    ...balanceData.map((t: any) => ({
      ...t,
      price: (rawPrices.get(t.address) || 0n).toString(),
      marketCap: calculateMarketCap(rawPrices.get(t.address), t.token?._totalSupply),
      collateralBalance: (collateralMap.get(t.address) || 0n).toString(),
    })),
    ...tokensWithCollateralOnly.map((a) => ({
      address: a,
      user: address,
      balance: "0",
      price: (rawPrices.get(a) || 0n).toString(),
      marketCap: calculateMarketCap(rawPrices.get(a), tokenDetails.get(a)?._totalSupply),
      collateralBalance: (collateralMap.get(a) || 0n).toString(),
      token: tokenDetails.get(a),
    })),
    ...saveUsdstVaultTokens.map((t: any) => ({
      ...t,
      price: (rawPrices.get(t.address) || 0n).toString(),
      marketCap: "0",
    })),
  ];

  return allTokens.filter(
    (t) => t.balance !== "0" || t.collateralBalance !== "0"
  );
};

/**
 * Get transferable tokens for a user
 * Returns tokens with positive balance that are not paused
 */
export const getTransferableTokens = async (accessToken: string, userAddress: string) => {
  const [tokens, yieldVaultTokens] = await Promise.all([
    getBalance(accessToken, userAddress),
    getYieldVaultTransferableTokens(accessToken, userAddress),
  ]);

  // Filter out paused tokens and ensure nonzero balance
  return [...tokens, ...yieldVaultTokens].filter((tokenData: any) => {
    const hasBalance = tokenData.balance !== "0";
    const isNotPaused = tokenData.token?._paused !== true;
    return hasBalance && isNotPaused;
  });
}

export const createToken = async (
  accessToken: string,
  userAddress: string,
  body: Record<string, string | undefined>
) => {
  try {
    const tx = await buildFunctionTx({
      contractName: extractContractName(TokenFactory),
      contractAddress: tokenFactory,
      method: "createToken",
      args: usc(body),
    }, userAddress, accessToken);

    const { status, hash } = await postAndWaitForTx(accessToken, () =>
      strato.post(accessToken, StratoPaths.transactionParallel, tx)
    );

    return {
      status,
      hash,
    };
  } catch (error) {
    throw error;
  }
};

export const transferToken = async (
  accessToken: string,
  userAddress: string,
  body: Record<string, string | undefined>
) => {
  try {
    const tx = await buildFunctionTx({
      contractName: getTransferContractName(body.address),
      contractAddress: body.address || "",
      method: "transfer",
      args: {
        to: body.to,
        value: body.value,
      },
    }, userAddress, accessToken);

    const { status, hash } = await postAndWaitForTx(accessToken, () =>
      strato.post(accessToken, StratoPaths.transactionParallel, tx)
    );

    return {
      status,
      hash,
    };
  } catch (error) {
    throw error;
  }
};

export interface BulkTransferItem {
  to: string;
  value: string;
}

export interface BulkTransferResult {
  to: string;
  value: string;
  status: string;
  hash?: string;
  error?: string;
}

/**
 * Execute bulk transfers for a single token to multiple recipients
 * Processes transfers sequentially to ensure proper nonce handling
 */
export const bulkTransferToken = async (
  accessToken: string,
  userAddress: string,
  tokenAddress: string,
  transfers: BulkTransferItem[]
): Promise<{ results: BulkTransferResult[]; successCount: number; failureCount: number }> => {
  const results: BulkTransferResult[] = [];
  let successCount = 0;
  let failureCount = 0;

  for (const transfer of transfers) {
    try {
      const tx = await buildFunctionTx({
        contractName: getTransferContractName(tokenAddress),
        contractAddress: tokenAddress,
        method: "transfer",
        args: {
          to: transfer.to,
          value: transfer.value,
        },
      }, userAddress, accessToken);

      const { status, hash } = await postAndWaitForTx(accessToken, () =>
        strato.post(accessToken, StratoPaths.transactionParallel, tx)
      );

      results.push({
        to: transfer.to,
        value: transfer.value,
        status,
        hash,
      });
      successCount++;
    } catch (error: any) {
      results.push({
        to: transfer.to,
        value: transfer.value,
        status: "failure",
        error: error.message || "Transfer failed",
      });
      failureCount++;
    }
  }

  return { results, successCount, failureCount };
};

// Approve an allowance for a spender
export const approveToken = async (
  accessToken: string,
  userAddress: string,
  body: Record<string, string | undefined>
) => {
  try {
    const tx = await buildFunctionTx({
      contractName: extractContractName(Token),
      contractAddress: body.address || "",
      method: "approve",
      args: {
        spender: body.spender,
        value: body.value,
      },
    }, userAddress, accessToken);

    const { status, hash } = await postAndWaitForTx(accessToken, () =>
      strato.post(accessToken, StratoPaths.transactionParallel, tx)
    );

    return { status, hash };
  } catch (error) {
    throw error;
  }
};

// Transfer tokens on behalf of another address
export const transferFromToken = async (
  accessToken: string,
  userAddress: string,
  body: Record<string, string | undefined>
) => {
  try {
    const tx = await buildFunctionTx({
      contractName: extractContractName(Token),
      contractAddress: body.address || "",
      method: "transferFrom",
      args: {
        from: body.from,
        to: body.to,
        value: body.value,
      },
    }, userAddress, accessToken);

    const { status, hash } = await postAndWaitForTx(accessToken, () =>
      strato.post(accessToken, StratoPaths.transactionParallel, tx)
    );

    return { status, hash };
  } catch (error) {
    throw error;
  }
};

export const setTokenStatus = async (
  accessToken: string,
  userAddress: string,
  body: Record<string, string | number>
) => {
  try {
    const tx = await buildFunctionTx({
      contractName: extractContractName(Token),
      contractAddress: body.address as string,
      method: "setStatus",
      args: {
        newStatus: body.status,
      },
    }, userAddress, accessToken);

    const { status, hash } = await postAndWaitForTx(accessToken, () =>
      strato.post(accessToken, StratoPaths.transactionParallel, tx)
    );

    return { status, hash };
  } catch (error) {
    throw error;
  }
};

export const getVoucherBalance = async (
  accessToken: string,
  userAddress: string
): Promise<string> => {
  const response = await cirrus.get(accessToken, `/${Voucher}-_balances`, {
    params: {
      address: `eq.${constants.voucher}`,
      key: `eq.${userAddress}`,
      select: "balance:value::text",
    },
  });

  if (response.status !== 200) {
    throw new Error(`Error fetching voucher balance: ${response.statusText}`);
  }

  const rawValue = response.data?.[0]?.balance ?? "0";
  const voucherAsUsdstWei = (BigInt(rawValue) * 100n).toString();
  return voucherAsUsdstWei;
};

/**
 * Check whether a recipient address exists on the STRATO network.
 * Returns the account nonce (0 = no activity).
 */
export const getAccountNonce = async (
  accessToken: string,
  recipientAddress: string
): Promise<number> => {
  const normalizedAddr = recipientAddress.toLowerCase().replace(/^0x/, "");
  const result = await eth.get(accessToken, "/account", {
    params: { address: normalizedAddr },
  }).catch(() => ({ data: [] }));

  const accounts = Array.isArray(result.data) ? result.data : [];
  return accounts[0]?.nonce ?? 0;
};

/**
 * Get all tokens with their total supply for stats
 * Includes price data for market cap calculation
 * Returns all tokens that have an oracle price
 */
export const getTokenStats = async (
  accessToken: string
): Promise<{ tokens: any[], totalMarketCap: string }> => {
  try {
    const [tokensResponse, priceData] = await Promise.all([
      cirrus.get(accessToken, `/${Token}`, {
        params: {
          select: `address,_name,_symbol,_totalSupply::text,images:${Token}-images(value)`,
          status: `eq.2`,
          _totalSupply: `gt.0`
        }
      }),
      getOraclePrices(accessToken)
    ]);

    if (tokensResponse.status !== 200) {
      throw new Error(`Error fetching token stats: ${tokensResponse.statusText}`);
    }

    if (!priceData) {
      throw new Error(`Error fetching price data, no price data found`);
    }

    const tokens = tokensResponse.data || [];

    const filteredTokens = tokens.filter((token: any) => priceData.has(token.address));

    // Optional enrichment — failure must not break existing stats fields
    const metricsMap = await getTokenPriceMetrics(
      accessToken,
      filteredTokens.map((t: any) => t.address),
      priceData
    ).catch(() => new Map());

    const tokensWithMarketCap = filteredTokens.map((token: any) => {
      const totalSupply = BigInt(token._totalSupply || "0");
      const marketCap = calculateMarketCap(priceData.get(token.address), totalSupply);
      const metrics = metricsMap.get(token.address);

      return {
        address: token.address,
        name: token._name,
        symbol: token._symbol,
        image: token.images?.[0]?.value || null,
        totalSupply: totalSupply.toString(),
        price: (priceData.get(token.address) || "0").toString(),
        marketCap,
        // FDV = price × totalSupply on STRATO (no separate max supply)
        fdv: marketCap,
        change1h: metrics?.change1h ?? null,
        change24h: metrics?.change24h ?? null,
        sparkline: metrics?.sparkline ?? [],
      };
    });

    // Sort tokens by market cap descending
    const sortedTokens = tokensWithMarketCap.sort((a: any, b: any) => {
      const marketCapA = parseFloat(a.marketCap);
      const marketCapB = parseFloat(b.marketCap);
      return marketCapB - marketCapA;
    });

    // Calculate total market cap
    const totalMarketCap = sortedTokens.reduce((sum: number, token: any) => {
      return sum + parseFloat(token.marketCap);
    }, 0);

    // Format total market cap with 2 decimal places
    const formattedTotalMarketCap = totalMarketCap.toFixed(2);

    return {
      tokens: sortedTokens,
      totalMarketCap: formattedTotalMarketCap
    };
  } catch (error) {
    throw error;
  }
};
