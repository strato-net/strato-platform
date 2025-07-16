import { cirrus, strato } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { StratoPaths } from "../../config/constants";
import { extractContractName } from "../../utils/utils";

const { AdminRegistry, adminRegistry } = constants;

export const isUserAdmin = async (
  accessToken: string,
  userAddress: string
): Promise<boolean> => {
  try {
    const response = await cirrus.get(accessToken, "/" + AdminRegistry + "-isAdmin", {
      params: {
        key: "eq." + userAddress,
        select: "key,value",
        limit: "1"
      },
    });

    if (response.status !== 200) {
      return false;
    }

    if (!response.data || !Array.isArray(response.data) || response.data.length === 0) {
      return false;
    }

    const adminRecord = response.data[0];
    return adminRecord && adminRecord.value === true;
  } catch (error) {
    return false;
  }
}; 

export const getAdmin = async (
  accessToken: string
): Promise<string[]> => {
  try {
    const response = await cirrus.get(accessToken, "/" + AdminRegistry, {
      params: {
        select: "key,value",
        value: "eq.true"
      },
    });

    if (response.status !== 200) {
      return [];
    }

    if (!response.data || !Array.isArray(response.data)) {
      return [];
    }

    return response.data.map(admin => admin.key);
  } catch (error) {
    return [];
  }
};

// Add a new admin to the registry
export const addAdmin = async (
  accessToken: string,
  adminAddress: string
): Promise<{ status: string; hash: string }> => {
  try {
    const tx = buildFunctionTx({
      contractName: extractContractName(AdminRegistry),
      contractAddress: adminRegistry,
      method: "addAdmin",
      args: {
        admin: adminAddress,
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

// Remove an admin from the registry
export const removeAdmin = async (
  accessToken: string,
  adminAddress: string
): Promise<{ status: string; hash: string }> => {
  try {
    const tx = buildFunctionTx({
      contractName: extractContractName(AdminRegistry),
      contractAddress: adminRegistry,
      method: "removeAdmin",
      args: {
        admin: adminAddress,
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