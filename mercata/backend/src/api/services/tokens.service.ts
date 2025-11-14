import { cirrus, strato } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { usc } from "../../utils/importer";
import { extractContractName } from "../../utils/utils";
import { StratoPaths, constants } from "../../config/constants";
import { getPool as getLendingRegistry } from "./lending.service";
import { createCompletePriceMap } from "../helpers/oracle.helper";
import { getOraclePrices } from "./oracle.service";
import { getTokenDetails } from "../helpers/cirrusHelpers";

const { tokenSelectFields, tokenBalanceSelectFields, Token, PriceOracle, tokenFactory, TokenFactory, CDPEngine, Voucher, CollateralVault } = constants;

// Get tokens with conditional pagination
export const getTokens = async (
  accessToken: string,
  rawParams: Record<string, string | undefined> = {}
) => {
  try {
    // Filter out undefined
    let params = Object.fromEntries(
      Object.entries(rawParams).filter(([_, v]) => v !== undefined)
    ) as Record<string, string>;

    // Check if pagination parameters exist
    const hasPagination = params.limit !== undefined || params.offset !== undefined;
    
    if (hasPagination) {
      // Pagination mode - return paginated response
      const limit = parseInt(params.limit || "10");
      const offset = parseInt(params.offset || "0");
      
      // Validate pagination parameters
      if (limit > 100) {
        throw new Error("Limit cannot exceed 100");
      }
      if (offset < 0) {
        throw new Error("Offset cannot be negative");
      }

      // use tokenBalanceSelectFields if no select is provided
      if (!params.select) {
        params.select = tokenSelectFields.join(",");
      }

      // Add pagination to params
      params.limit = limit.toString();
      params.offset = offset.toString();

      // Fetch tokens count and data in parallel
      const countParams = { ...params };
      delete countParams.limit;
      delete countParams.offset;

      const [response, countResponse, lendingResponse] = await Promise.all([
        cirrus.get(accessToken, "/" + Token, { params }),
        cirrus.get(accessToken, "/" + Token, { params: { ...countParams, select: "count()" } }),
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

      const totalCount = countResponse.data?.[0]?.count || 0;
      const currentPage = Math.floor(offset / limit) + 1;
      const totalPages = Math.ceil(totalCount / limit);
      const hasNext = offset + limit < totalCount;

      // Process collateral data
      const collateralMap = new Map<string, string>();
      const userCollaterals = lendingResponse.collateralVault?.userCollaterals || [];
      userCollaterals
        .filter((c: any) => c.user && c.asset && c.amount && c.amount !== "0")
        .forEach((c: any) => {
          collateralMap.set(`${c.user}-${c.asset}`, c.amount);
        });

      // Process price data
      const rawPrices = lendingResponse.oracle?.prices || [];
      const priceMap = await createCompletePriceMap(accessToken, rawPrices);

      const processedTokens = (response.data as any[]).map((token) => ({
        ...token,
        price: priceMap.get(token.address) || "0",
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

      return {
        data: processedTokens,
        pagination: {
          total: totalCount,
          page: currentPage,
          limit: limit,
          totalPages: totalPages,
          hasNext: hasNext,
          hasPrevious: offset > 0
        }
      };
    } else {
      // Non-pagination mode - return simple array (for internal services)
      // use tokenBalanceSelectFields if no select is provided
      if (!params.select) {
        params.select = tokenSelectFields.join(",");
      }

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
      const rawPrices = lendingResponse.oracle?.prices || [];
      const priceMap = await createCompletePriceMap(accessToken, rawPrices);

      return (response.data as any[]).map((token) => ({
        ...token,
        price: priceMap.get(token.address) || "0",
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
    }
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

  // Since no pagination params were passed, getTokens returns an array
  const token = (tokenData as any[])?.[0];
  const userBalance = token?.balances?.find((b: any) => b.user === userAddress)?.balance;
  return userBalance || "0";
};

/**
 * Helper to fetch and process prices
 */
const fetchPrices = async (accessToken: string) => {
  const priceMap = await getOraclePrices(accessToken);
  const rawPriceArray = Array.from(priceMap.entries()).map(([key, value]) => ({
    key,
    value: parseFloat(value)
  }));
  return await createCompletePriceMap(accessToken, rawPriceArray);
};

/**
 * Helper to filter out internal routing parameters and build base params
 */
const buildBaseParams = (
  address: string,
  rawParams: Record<string, string | undefined>,
  tokenAddress?: string
) => {
  const { mode, tokenAddress: _, ...filteredParams } = rawParams;
  return {
    ...Object.fromEntries(Object.entries(filteredParams).filter(([_, v]) => v !== undefined)),
    key: `eq.${address}`,
    select: filteredParams.select || tokenBalanceSelectFields.join(","),
    ...(tokenAddress && { address: `eq.${tokenAddress}` }),
  };
};

/**
 * Helper to fetch and merge collateral from CollateralVault and CDPEngine
 */
const fetchCollateral = async (
  accessToken: string,
  userAddress: string,
  tokenAddress?: string
) => {
  const baseParams = {
    select: "user:key,asset:key2,amount:value::text",
    key: `eq.${userAddress}`,
    value: `gt.0`,
    ...(tokenAddress && { "key2": `eq.${tokenAddress}` }),
  };

  const [collaterals, cdps] = await Promise.all([
    cirrus.get(accessToken, "/" + CollateralVault + "-userCollaterals", { params: baseParams }),
    cirrus.get(accessToken, `/${CDPEngine}-vaults`, {
      params: {
        ...baseParams,
        select: "user:key,asset:key2,amount:value->>collateral::text",
        "value->>collateral": `gt.0`,
      }
    }),
  ]);

  const collateralMap = new Map<string, bigint>();
  [...(collaterals.data || []), ...(cdps.data || [])].forEach((item: any) => {
    const amount = BigInt(item.amount || "0");
    collateralMap.set(item.asset, (collateralMap.get(item.asset) || 0n) + amount);
  });

  return collateralMap;
};

/**
 * Internal: Get balance only (without collateral)
 */
const _getBalanceOnly = async (
  accessToken: string,
  address: string,
  rawParams: Record<string, string | undefined> = {}
) => {
  const params = buildBaseParams(address, rawParams);
  const [balances, rawPrices] = await Promise.all([
    cirrus.get(accessToken, "/" + Token + "-_balances", { params }),
    fetchPrices(accessToken)
  ]);

  return (balances.data || [])
    .filter((t: any) => t.balance !== "0")
    .map((t: any) => ({ ...t, price: rawPrices.get(t.address) || "0" }));
};

/**
 * Internal: Get collateral only (without balance)
 */
const _getCollateralOnly = async (
  accessToken: string,
  address: string,
  rawParams: Record<string, string | undefined> = {}
) => {
  const [collateralMap, rawPrices] = await Promise.all([
    fetchCollateral(accessToken, address),
    fetchPrices(accessToken)
  ]);

  const tokensWithCollateral = [...collateralMap.keys()].filter(a => collateralMap.get(a) !== 0n);
  if (tokensWithCollateral.length === 0) return [];

  const tokenDetails = await getTokenDetails(accessToken, tokensWithCollateral);

  return tokensWithCollateral.map((a) => ({
    address: a,
    user: address,
    price: rawPrices.get(a) || "0",
    collateralBalance: collateralMap.get(a)!.toString(),
    token: tokenDetails.get(a),
  }));
};

/**
 * Internal: Get value data for specific token (balance + collateral + price)
 */
const _getTokenValueData = async (
  accessToken: string,
  userAddress: string,
  tokenAddress: string
) => {
  const [balanceData, collateralMap, rawPrices] = await Promise.all([
    cirrus.get(accessToken, "/" + Token + "-_balances", {
      params: buildBaseParams(userAddress, {}, tokenAddress)
    }),
    fetchCollateral(accessToken, userAddress, tokenAddress),
    fetchPrices(accessToken)
  ]);

  return {
    balance: balanceData.data?.[0]?.balance || "0",
    collateralBalance: collateralMap.get(tokenAddress)?.toString() || "0",
    price: rawPrices.get(tokenAddress) || "0",
  };
};

/**
 * Internal: Get combined balance and collateral (default behavior)
 */
const _getCombined = async (
  accessToken: string,
  address: string,
  rawParams: Record<string, string | undefined> = {}
) => {
  const params = buildBaseParams(address, rawParams);
  const [balances, collateralMap, rawPrices] = await Promise.all([
    cirrus.get(accessToken, "/" + Token + "-_balances", { params }),
    fetchCollateral(accessToken, address),
    fetchPrices(accessToken)
  ]);

  const balanceData = balances.data || [];
  const balanceAddresses = new Set(balanceData.map((b: any) => b.address));
  const tokensWithCollateralOnly = [...collateralMap.keys()].filter(a => !balanceAddresses.has(a));

  const tokenDetails = tokensWithCollateralOnly.length > 0
    ? await getTokenDetails(accessToken, tokensWithCollateralOnly)
    : new Map();

  const allTokens = [
    ...balanceData.map((t: any) => ({
      ...t,
      price: rawPrices.get(t.address) || "0",
      collateralBalance: (collateralMap.get(t.address) || 0n).toString(),
    })),
    ...tokensWithCollateralOnly.map((a) => ({
      address: a,
      user: address,
      balance: "0",
      price: rawPrices.get(a) || "0",
      collateralBalance: collateralMap.get(a)!.toString(),
      token: tokenDetails.get(a),
    })),
  ];

  return allTokens.filter((t) => t.balance !== "0" || t.collateralBalance !== "0");
};

/**
 * Get user tokens with flexible modes
 * Query params:
 *   - mode: "balance" | "collateral" | "combined" (default: "combined")
 *   - tokenAddress: When provided, returns value data for specific token (overrides mode)
 */
export const getBalance = async (
  accessToken: string,
  address: string,
  rawParams: Record<string, string | undefined> = {}
) => {
  const { tokenAddress, mode = "combined" } = rawParams;

  if (tokenAddress) {
    return await _getTokenValueData(accessToken, address, tokenAddress);
  }

  const modeHandlers: Record<string, (a: string, b: string, c: Record<string, string | undefined>) => Promise<any>> = {
    balance: _getBalanceOnly,
    collateral: _getCollateralOnly,
    combined: _getCombined,
  };

  return await (modeHandlers[mode] || modeHandlers.combined)(accessToken, address, rawParams);
};


/**
 * Get transferable tokens for a user
 * Returns tokens with positive balance that are not paused
 */
export const getTransferableTokens = async (accessToken: string, userAddress: string) => {
  // Get normal balance
  const tokens = await getBalance(accessToken, userAddress);

  // Filter out paused tokens and ensure nonzero balance
  return tokens.filter((tokenData: any) => {
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
      contractName: extractContractName(Token),
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