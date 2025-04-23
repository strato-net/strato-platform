import { cirrus, strato } from "../../utils/mercataApiHelper";
import axios from "axios";
import { buildDeployTx, buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { combine, usc, cwd } from "../../utils/importer";
import { StratoPaths } from "../../config/constants";

const ERC20 = "Demo";
const contractPath = `${cwd}/src/api/contracts/${ERC20}.sol`;

// Get all tokens with optional filtering
export const getTokens = async (
  accessToken: string,
  rawParams: Record<string, string | undefined> = {}
) => {
  try {
    // Filter out undefined values (cleaning for axios)
    const params = Object.fromEntries(
      Object.entries(rawParams).filter(([_, v]) => v !== undefined)
    ) as Record<string, string>;

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
    if (axios.isAxiosError(error) && error.response?.data) {
      console.error("Blockchain error:", error.response.data);
      throw new Error(
        `Blockchain error: ${
          error.response.data.message || error.response.data
        }`
      );
    }

    if (error instanceof Error) {
      console.error("Transfer error:", error.message);
      throw new Error(`Transfer error: ${error.message}`);
    }

    console.error("Unknown error:", error);
    throw error;
  }
};
