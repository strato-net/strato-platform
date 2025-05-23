import { cirrus, strato } from "../../utils/mercataApiHelper";
import { buildDeployTx, buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { usc } from "../../utils/importer";
import { StratoPaths, constants } from "../../config/constants";

const { tokenSelectFields, tokenBalanceSelectFields } = constants;

const Token = "Token";
const TokenFaucet = "TokenFaucet";

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
    const response = await cirrus.get(accessToken, "/" + Token, {
      params,
    });

    if (response.status !== 200) {
      throw new Error(`Error fetching tokens: ${response.statusText}`);
    }

    if (!response.data) {
      throw new Error("Tokens data is empty");
    }

    return response.data;
  } catch (error) {
    console.error("Error fetching tokens:", error);
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
    let params = Object.fromEntries(
      Object.entries(rawParams).filter(([_, v]) => v !== undefined)
    ) as Record<string, string>;

    // use tokenBalanceSelectFields if no select is provided
    if (!params.select) {
      params.select = tokenBalanceSelectFields.join(",");
    }

    // Add user address to params
    const response = await cirrus.get(accessToken, "/" + Token + "-_balances", {
      params: { ...params, key: "eq." + address },
    });
    if (response.status !== 200) {
      throw new Error(`Error fetching balance: ${response.statusText}`);
    }
    if (!response.data) {
      throw new Error("Balance data is empty");
    }
    return response.data;
  } catch (error) {
    console.error("Error fetching balance:", error);
    throw error;
  }
};

export const createToken = async (
  accessToken: string,
  body: Record<string, string | undefined>
) => {
  try {
    const tx = buildDeployTx({
      contractName: Token,
      source: `import <${process.env.BASE_CODE_COLLECTION}>;`,
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
    console.error("Error creating token:", error);
    throw error;
  }
};

export const transferToken = async (
  accessToken: string,
  body: Record<string, string | undefined>
) => {
  try {
    const tx = buildFunctionTx({
      contractName: Token,
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
    console.error("Unknown error:", error);
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
      contractName: Token,
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
    console.error("Error approving token:", error);
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
      contractName: Token,
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
    console.error("Error in transferFrom:", error);
    throw error;
  }
};

// Get tokens from faucet
export const faucetTokens = async (
  accessToken: string,
  body: Record<string, string | undefined>
) => {
  try {
    const tx = buildFunctionTx({
      contractName: TokenFaucet,
      contractAddress: body.address || "",
      method: "faucet",
      args: {},
    });

    const { status, hash } = await postAndWaitForTx(accessToken, () =>
      strato.post(accessToken, StratoPaths.transactionParallel, tx)
    );

    return {
      status,
      hash,
    };
  } catch (error) {
    console.error("Unknown error:", error);
    throw error;
  }
};

// Get all faucet contract addresses
export const getFaucetAddresses = async (accessToken: string) => {
  try {
    const response = await cirrus.get(
      accessToken,
      `/BlockApps-Mercata-${TokenFaucet}`,
      {
        params: {
          isActive: "eq.true",
          select: "address",
        },
      }
    );

    if (response.status !== 200) {
      throw new Error(`Error fetching faucets: ${response.statusText}`);
    }

    if (!response.data) {
      throw new Error("Faucets data is empty");
    }

    return response.data;
  } catch (error) {
    console.error("Error fetching faucets:", error);
    throw error;
  }
};
