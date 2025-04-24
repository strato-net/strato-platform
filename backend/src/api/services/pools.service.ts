import { cirrus, strato, bloc } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { usc } from "../../utils/importer";
import { StratoPaths, constants } from "../../config/constants";

const Pool = "DemoPool";
const PoolFactory = "DemoPoolFactory";

export const getPools = async (
  accessToken: string,
  rawParams: Record<string, string | undefined> = {}
) => {
  try {
    // Filter out undefined values from query
    const params = Object.fromEntries(
      Object.entries(rawParams).filter(([_, v]) => v !== undefined)
    ) as Record<string, string>;

    // Fetch pool factory data (for allPools only)
    const factoryResponse = await bloc.get(
      accessToken,
      StratoPaths.state.replace(":contractAddress", constants.poolFactory)
    );

    const allPools: string[] =
      factoryResponse?.data?.allPools?.map((p: string) => p.toLowerCase()) ||
      [];

    if (!allPools.length) {
      throw new Error("No pools found in PoolFactory");
    }

    // Fetch all ERC20 tokens (includes pool contracts)
    if (params.address) {
      const rawAddressParam = params.address.trim().toLowerCase();

      let extractedAddresses: string[] = [];

      if (rawAddressParam.startsWith("eq.")) {
        extractedAddresses = [rawAddressParam.slice(3)];
      } else if (rawAddressParam.startsWith("neq.")) {
        extractedAddresses = [rawAddressParam.slice(4)];
      }else if (rawAddressParam.startsWith("in.(")) {
        extractedAddresses = rawAddressParam
          .slice(4)
          .replace(/[()]/g, "")
          .split(",")
          .map((addr) => addr.trim());
      } else if (rawAddressParam.startsWith("not.in.(")) {
        extractedAddresses = rawAddressParam
          .slice(8)
          .replace(/[()]/g, "")
          .split(",")
          .map((addr) => addr.trim());
      } else {
        // fallback: assume it’s a single address
        extractedAddresses = [rawAddressParam];
      }

      // Validate each extracted address
      const invalidAddresses = extractedAddresses.filter(
        (addr) => !allPools.includes(addr)
      );

      if (invalidAddresses.length > 0) {
        throw new Error(
          `Invalid pool address(es) not found in all pools: ${invalidAddresses.join(
            ", "
          )}`
        );
      }
    } else {
      params.address = `in.(${allPools.join(",")})`;
    }

    const cirrusResponse = await cirrus.get(
      accessToken,
      `/BlockApps-Mercata-ERC20`,
      { params }
    );

    if (cirrusResponse.status !== 200 || !Array.isArray(cirrusResponse.data)) {
      throw new Error("Error fetching pool data from Cirrus");
    }

    const poolData = cirrusResponse.data;

    // Filter to only known pool addresses
    const formatted = poolData.map((pool: any) => ({
      poolAddress: pool.address,
      token: pool.data?.token,
      stablecoin: pool.data?.stablecoin,
      locked: pool.data?.locked,
      name: pool?._name,
      symbol: pool?._symbol,
      totalSupply: pool?._totalSupply,
      decimals: pool?.decimals,
    }));

    return formatted;
  } catch (error) {
    console.error("Error fetching pools:", error);
    throw error;
  }
};

export const createPool = async (
  accessToken: string,
  body: Record<string, string | undefined>
) => {
  try {
    const tx = buildFunctionTx({
      contractName: PoolFactory,
      contractAddress: constants.poolFactory,
      method: "createPool",
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
    console.error("Error creating pool:", error);
    throw error;
  }
};

export const addLiquidity = async (
  accessToken: string,
  body: Record<string, string | undefined>
) => {
  try {
    const tx = buildFunctionTx({
      contractName: Pool,
      contractAddress: body.address || "",
      method: "addLiquidity",
      args: {
        stable_amount: body.stable_amount,
        max_tokens: body.max_tokens,
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
    console.error("Error adding liquidity:", error);
    throw error;
  }
};

export const removeLiquidity = async (
  accessToken: string,
  body: Record<string, string | undefined>
) => {
  try {
    const tx = buildFunctionTx({
      contractName: Pool,
      contractAddress: body.address || "",
      method: "removeLiquidity",
      args: {
        amount: body.amount,
        min_stable: body.min_stable,
        min_tokens: body.min_tokens,
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
    console.error("Error removing liquidity:", error);
    throw error;
  }
};

export const swap = async (
  accessToken: string,
  body: Record<string, string | undefined>
) => {
  try {
    const isStableToToken = body.method === "stableToToken";
    const tx = buildFunctionTx({
      contractName: Pool,
      contractAddress: body.address || "",
      method: body.method || "",
      args: {
        [isStableToToken ? "stable_sold" : "tokens_sold"]: body.amount,
        min_stable: body.min_stable,
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
    console.error("Error swapping:", error);
    throw error;
  }
};
