import { cirrus, strato } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { usc } from "../../utils/importer";
import { extractContractName } from "../../utils/utils";
import { StratoPaths, constants } from "../../config/constants";
import { getPool as getLendingRegistry } from "./lending.service";
import { createCompletePriceMap } from "../helpers/oracle.helper";
import { getOraclePrices } from "./oracle.service";

const { tokenSelectFields, tokenBalanceSelectFields, Token, PriceOracle, tokenFactory, TokenFactory, CDPEngine, Voucher, CollateralVault } = constants;

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
  const params = {
    ...Object.fromEntries(Object.entries(rawParams).filter(([_, v]) => v !== undefined)),
    key: `eq.${address}`,
    select: rawParams.select || tokenBalanceSelectFields.join(","),
  };

  const [balanceResponse, collateralResponse, cdpResponse, priceMap] = await Promise.all([
    cirrus.get(accessToken, "/" + Token + "-_balances", { params }),
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
    // Get all oracle prices (could be optimized to filter by token addresses if needed)
    getOraclePrices(accessToken)
  ]);

  const collateralMap = new Map<string, string>();
  (collateralResponse.data || []).forEach((c: any) => collateralMap.set(c.asset, c.amount));
  (cdpResponse.data || []).forEach((v: any) => {
    const existing = collateralMap.get(v.asset) || "0";
    const cdpAmount = v.amount || "0";
    collateralMap.set(v.asset, (BigInt(existing) + BigInt(cdpAmount)).toString());
  });

  return balanceResponse.data
    .map((token: any) => ({
      ...token,
      price: priceMap.get(token.address) || "0",
      collateralBalance: collateralMap.get(token.address) || "0",
    }))
    .filter((token: any) => token.balance !== "0" || token.collateralBalance !== "0");
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
