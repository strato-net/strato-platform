import { cirrus, strato } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { usc } from "../../utils/importer";
import { extractContractName } from "../../utils/utils";
import { StratoPaths, constants } from "../../config/constants";
import { getPool as getLendingRegistry } from "./lending.service";
import { createCompletePriceMap } from "../helpers/oracle.helper";

const { tokenSelectFields, tokenBalanceSelectFields, Token, PriceOracle, tokenFactory, TokenFactory } = constants;

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
    const collateralMap = new Map(userCollaterals.map((c: any) => [c.asset, c.amount]));

    const lendingInfo = await getLendingRegistry(accessToken, undefined, {
      select: `oracle:priceOracle_fkey(address,prices:${PriceOracle}-prices(key,value::text))`,
    });
  
    const rawPrices = lendingInfo.oracle?.prices || [];
    const priceMap = await createCompletePriceMap(accessToken, rawPrices);

    return response.data
      .map((token: any) => ({
        ...token,
        price: priceMap.get(token.address) || "0",
        collateralBalance: collateralMap.get(token.address) || "0",
      }))
      .filter((token: any) => token.balance !== "0" || token.collateralBalance !== "0");
  } catch (error) {
    throw error;
  }
};

export const createToken = async (
  accessToken: string,
  body: Record<string, string | undefined>
) => {
  try {
    const tx = buildFunctionTx({
      contractName: extractContractName(TokenFactory),
      contractAddress: tokenFactory,
      method: "createToken",
      args: usc(body),
    });

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
  body: Record<string, string | undefined>
) => {
  try {
    const tx = buildFunctionTx({
      contractName: extractContractName(Token),
      contractAddress: body.address || "",
      method: "transfer",
      args: {
        to: body.to,
        value: body.value,
      },
    });

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
  body: Record<string, string | undefined>
) => {
  try {
    const tx = buildFunctionTx({
      contractName: extractContractName(Token),
      contractAddress: body.address || "",
      method: "approve",
      args: {
        spender: body.spender,
        value: body.value,
      },
    });

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
  body: Record<string, string | undefined>
) => {
  try {
    const tx = buildFunctionTx({
      contractName: extractContractName(Token),
      contractAddress: body.address || "",
      method: "transferFrom",
      args: {
        from: body.from,
        to: body.to,
        value: body.value,
      },
    });

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
  body: Record<string, string | number>
) => {
  try {
    const tx = buildFunctionTx({
      contractName: extractContractName(Token),
      contractAddress: body.address as string,
      method: "setStatus",
      args: {
        newStatus: body.status,
      },
    });

    const { status, hash } = await postAndWaitForTx(accessToken, () =>
      strato.post(accessToken, StratoPaths.transactionParallel, tx)
    );

    return { status, hash };
  } catch (error) {
    throw error;
  }
};