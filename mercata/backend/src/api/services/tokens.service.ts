import { cirrus, strato } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { usc } from "../../utils/importer";
import { extractContractName } from "../../utils/utils";
import { StratoPaths, constants } from "../../config/constants";
import { getPool as getLendingRegistry } from "./lending.service";
import { getCDPRegistry } from "./cdp.service";
import { createCompletePriceMap } from "../helpers/oracle.helper";

const { tokenSelectFields, tokenBalanceSelectFields, Token, PriceOracle, tokenFactory, TokenFactory, CDPEngine, Voucher, AdminRegistry } = constants;

// Helper function to get CDP collateral for a user
const getCDPCollateralForUser = async (accessToken: string, userAddress: string): Promise<Map<string, string>> => {
  try {
    // Get the CDPEngine address from registry to ensure we only query the correct instance
    const registry = await getCDPRegistry(accessToken, userAddress, {}, "getCDPCollateralForUser");
    
    if (!registry?.cdpEngine) {
      return new Map();
    }

    const cdpEngineAddress = registry.cdpEngine.address || registry.cdpEngine;

    // Use direct vault query with specific CDPEngine address
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
      
    const cdpCollateralMap = new Map<string, string>(
      (userVaults || []).map((v: any) => [v.asset, v.Vault.collateral || "0"])
    );
    
    return cdpCollateralMap;
  } catch (error) {
    // Graceful fallback - return empty map if CDP data unavailable
    console.warn(`❌ [CDP] Failed to fetch CDP collateral data:`, error);
    return new Map();
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
      getLendingRegistry(accessToken, undefined, {
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
  try {

    // Filter out undefined
    let params = {
      ...Object.fromEntries(
        Object.entries(rawParams).filter(([_, v]) => v !== undefined)
      ),
      key: `eq.${address}`,
      select: rawParams.select || tokenBalanceSelectFields.join(","),
      ...(rawParams.select
        ? {}
        : {
            "token.balances.key": `eq.${address}`
          }),
    };

    const response = await cirrus.get(accessToken, "/" + Token + "-_balances", {
      params,
    });

    if (response.status !== 200) {
      throw new Error(`Error fetching balance: ${response.statusText}`);
    }

    if (!response.data) {
      throw new Error("Balance data is empty");
    }

    // Fetch collateral vault balances for the user
    
    const collateralData = await getLendingRegistry(accessToken, undefined, {
      select: `collateralVault:collateralVault_fkey(userCollaterals:${constants.CollateralVault}-userCollaterals(user:key,asset:key2,amount:value::text))`,
      "collateralVault.userCollaterals.key": `eq.${address}`
    });

    const userCollaterals = collateralData.collateralVault?.userCollaterals || [];
    const lendingCollateralMap = new Map(userCollaterals.map((c: any) => [c.asset, c.amount]));

    // Fetch CDP collateral for the user
    const cdpCollateralMap = await getCDPCollateralForUser(accessToken, address);

    // Combine both collateral types
    
    const combinedCollateralMap = new Map();
    // Add lending collateral
    lendingCollateralMap.forEach((amount, asset) => {
      combinedCollateralMap.set(asset, amount);
    });
    // Add CDP collateral (sum if exists)
    cdpCollateralMap.forEach((amount, asset) => {
      const existing = combinedCollateralMap.get(asset) || "0";
      const sum = (BigInt(existing) + BigInt(amount)).toString();
      combinedCollateralMap.set(asset, sum);
    });
    const lendingInfo = await getLendingRegistry(accessToken, undefined, {
      select: `oracle:priceOracle_fkey(address,prices:${PriceOracle}-prices(key,value::text))`,
    });
  
    const rawPrices = lendingInfo.oracle?.prices || [];
    
    const priceMap = await createCompletePriceMap(accessToken, rawPrices);

    
    const finalTokens = response.data
      .map((token: any) => {
        const collateralBalance = combinedCollateralMap.get(token.address) || "0";
        
        return {
          ...token,
          price: priceMap.get(token.address) || "0",
          collateralBalance: collateralBalance,
        };
      })
      .filter((token: any) => token.balance !== "0" || token.collateralBalance !== "0");
    return finalTokens;
  } catch (error) {
    console.error(`❌ [BALANCE] Error in getBalance for user ${address}:`, error);
    throw error;
  }
};

/**
 * Get transferable tokens according to Token.sol logic (whenNotPausedOrOwner modifier)
 * A token is transferable if:
 * 1. User has positive balance, AND
 * 2. One of the following:
 *    a. Token is not paused, OR
 *    b. Token is paused AND user is the owner, OR
 *    c. Token is paused AND user is whitelisted in AdminRegistry
 */
export const getTransferableTokens = async (accessToken: string, userAddress: string) => {
  // Get tokens with enhanced select to include _paused, _owner, and tokenFactory fields
  const tokens = await getBalance(accessToken, userAddress, {
    select: `address,user:key,balance:value::text,token:${Token}(address,_name,_symbol,_owner,_totalSupply::text,customDecimals,description,status,_paused,tokenFactory,images:${Token}-images(value),attributes:${Token}-attributes(key,value))`
  });

  // Pre-filter: only tokens with positive balance
  const tokensWithBalance = tokens.filter((tokenData: any) => {
    const balance = tokenData.balance || "0";
    return balance !== "0" && tokenData.token;
  });

  // Separate tokens into paused and not paused
  const notPausedTokens: any[] = [];
  const pausedTokens: any[] = [];
  
  for (const tokenData of tokensWithBalance) {
    const token = tokenData.token;
    const isPaused = token._paused === true;
    const isOwner = token._owner?.toLowerCase() === userAddress.toLowerCase();
    console.log("isPaused", isPaused);
    console.log("isOwner", isOwner);

    if (!isPaused) {
      // Token not paused - always transferable
      notPausedTokens.push(tokenData);
    } else if (isOwner) {
      // Token paused but user is owner - transferable
      notPausedTokens.push(tokenData);
    } else {
      // Token paused and user is not owner - need to check whitelist
      pausedTokens.push(tokenData);
    }
  }

  // If there are no paused tokens requiring whitelist check, return early
  if (pausedTokens.length === 0) {
    return notPausedTokens;
  }

  // For paused tokens, check AdminRegistry whitelist
  // We need to get the AdminRegistry address from TokenFactory and then check whitelist
  const whitelistedTokens = await checkWhitelistForTokens(
    accessToken,
    pausedTokens,
    userAddress
  );

  return [...notPausedTokens, ...whitelistedTokens];
};

/**
 * Helper function to check AdminRegistry whitelist for paused tokens
 * According to Token.sol:
 * - Get AdminRegistry from TokenFactory owner
 * - Check whitelist(tokenAddress, "transfer", userAddress)
 */
async function checkWhitelistForTokens(
  accessToken: string,
  pausedTokens: any[],
  userAddress: string
): Promise<any[]> {
  try {
    // Get unique TokenFactory addresses
    const tokenFactoryAddresses = new Set(
      pausedTokens
        .map(td => td.token.tokenFactory)
        .filter(addr => addr)
    );

    if (tokenFactoryAddresses.size === 0) {
      return []; // No token factories, no whitelisted tokens
    }

    // Fetch TokenFactory contracts to get their owners (AdminRegistry addresses)
    const tokenFactoryData = await cirrus.get(
      accessToken,
      `/${TokenFactory}`,
      {
        params: {
          address: `in.(${Array.from(tokenFactoryAddresses).join(',')})`,
          select: 'address,_owner'
        }
      }
    );

    // Map tokenFactory address -> AdminRegistry address
    const factoryToAdmin = new Map(
      (tokenFactoryData.data || []).map((tf: any) => [tf.address, tf._owner])
    );

    // Get unique AdminRegistry addresses
    const adminRegistryAddresses = new Set(
      Array.from(factoryToAdmin.values()).filter(addr => addr)
    );

    if (adminRegistryAddresses.size === 0) {
      return []; // No admin registries found
    }

    // Query whitelist for all combinations
    // whitelist mapping: address (token) => string (function) => address (user) => bool
    const tokenAddresses = pausedTokens.map(td => td.token.address);
    
    const whitelistData = await cirrus.get(
      accessToken,
      `/${AdminRegistry}-whitelist`,
      {
        params: {
          address: `in.(${Array.from(adminRegistryAddresses).join(',')})`,
          key: `in.(${tokenAddresses.join(',')})`,
          key2: 'eq.transfer',
          key3: `eq.${userAddress.toLowerCase()}`,
          select: 'address,key,key2,key3,value'
        }
      }
    );

    // Build a set of whitelisted token addresses
    const whitelistedTokenAddresses = new Set(
      (whitelistData.data || [])
        .filter((wl: any) => wl.value === true)
        .map((wl: any) => wl.key)
    );

    // Filter paused tokens to only those that are whitelisted
    return pausedTokens.filter(tokenData => 
      whitelistedTokenAddresses.has(tokenData.token.address)
    );
  } catch (error) {
    console.error('❌ [WHITELIST] Error checking AdminRegistry whitelist:', error);
    // On error, fail closed - don't include paused tokens that we couldn't verify
    return [];
  }
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
