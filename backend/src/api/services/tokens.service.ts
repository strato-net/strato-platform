import { cirrus, strato, bloc } from "../../utils/mercataApiHelper";
import { buildDeployTx, buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { combine, usc, cwd } from "../../utils/importer";
import { StratoPaths } from "../../config/constants";

const ERC20 = "Demo";
const TokenFaucet = "TokenFaucet";
const contractPath = `${cwd}/src/api/contracts/${ERC20}.sol`;


// Get all tokens with optional filtering
export const getTokens = async (
  accessToken: string,
  rawParams: Record<string, string | undefined> = {}
) => {
  try {
    // Filter out undefined values (cleaning for axios)
    let params = Object.fromEntries(
      Object.entries(rawParams).filter(([_, v]) => v !== undefined)
    ) as Record<string, string>;

    // Handle select param for balances
    if (params.select) {
      // Append BlockApps-Mercata-ERC20-_balances(*) if not already present
      const selectParts = params.select.split(",");
      if (!selectParts.includes("BlockApps-Mercata-ERC20-_balances(key,value)")) {
        selectParts.push("BlockApps-Mercata-ERC20-_balances(key,value)");
        params.select = selectParts.join(",");
      }
    } else {
      params.select = "*,BlockApps-Mercata-ERC20-_balances(key,value)";
    }

    const response = await cirrus.get(accessToken, `/BlockApps-Mercata-ERC20`, {
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

// Get all faucet contract addresses
export const getFaucetAddresses = async (
  accessToken: string,
  rawParams: Record<string, string | undefined> = {}
) => {
  try {
    const response = await cirrus.get(accessToken, `/BlockApps-Mercata-${TokenFaucet}`, {
      params: {
        isActive: 'eq.true',
        select: 'address'
      }
    });

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

export const getBalance = async (
  accessToken: string,
  rawParams: Record<string, string | undefined> = {}
) => {
  try {
    // Filter out undefined values (cleaning for axios)
    const params = Object.fromEntries(
      Object.entries(rawParams).filter(([_, v]) => v !== undefined)
    ) as Record<string, string>;
    const response = await cirrus.get(
      accessToken,
      `/BlockApps-Mercata-ERC20-_balances`,
      {
        params: { select: "*,BlockApps-Mercata-ERC20(*)", ...params },
      }
    );
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

// Fetch state data
export const getState = async (
  accessToken: string,
  address: string
) => {
  try {
    const response = await bloc.get(
      accessToken,
      StratoPaths.state.replace(":contractAddress", address)
    );
    if (response.status !== 200) {
      throw new Error(`Error fetching allowance: ${response.statusText}`);
    }
    if (!response.data) {
      throw new Error("Allowance data is empty");
    }
    return response.data;
  } catch (error) {
    console.error("Error fetching allowance:", error);
    throw error;
  }
};

export const createToken = async (
  accessToken: string,
  body: Record<string, string | undefined>
) => {
  try {
    const tx = buildDeployTx({
      contractName: ERC20,
      source: await combine(contractPath),
      args: usc({
        ...body,
        createdDate: Date.now(),
      }),
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

export const faucetTokens = async (
  accessToken: string,
  body: Record<string, string | undefined>
) => {
  try {
    const tx = buildFunctionTx({
      contractName: TokenFaucet,
      contractAddress: body.address || "",
      method: "faucet",
      args: {
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

export const transferToken = async (
  accessToken: string,
  body: Record<string, string | undefined>
) => {
  try {
    const tx = buildFunctionTx({
      contractName: ERC20,
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
      contractName: ERC20,
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
      contractName: ERC20,
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
