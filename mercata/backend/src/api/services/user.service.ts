import { bloc, cirrus, eth, strato } from "../../utils/mercataApiHelper";
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
    const response = await cirrus.get(accessToken, "/" + AdminRegistry + "-adminMap", {
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
    return adminRecord && adminRecord.value > 0;
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
  userAddress: string,
  adminAddress: string
): Promise<{ status: string; hash: string }> => {
  try {
    const tx = await buildFunctionTx({
      contractName: extractContractName(AdminRegistry),
      contractAddress: adminRegistry,
      method: "addAdmin",
      args: {
        admin: adminAddress,
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

// Remove an admin from the registry
export const removeAdmin = async (
  accessToken: string,
  userAddress: string,
  adminAddress: string
): Promise<{ status: string; hash: string }> => {
  try {
    const tx = await buildFunctionTx({
      contractName: extractContractName(AdminRegistry),
      contractAddress: adminRegistry,
      method: "removeAdmin",
      args: {
        admin: adminAddress,
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

// Cast a vote on an issue in the registry
export const castVoteOnIssue = async (
  accessToken: string,
  userAddress: string,
  target: string,
  func: string, 
  args: string[],
): Promise<{ status: string; hash: string }> => {
  try {
    const txArgs: Record<string, any> = {
      _func: func,
      _target: target,
      _args: args
    };
    
    const tx = await buildFunctionTx({
      contractName: extractContractName(AdminRegistry),
      contractAddress: adminRegistry,
      method: "castVoteOnIssue",
      args: txArgs,
    }, userAddress, accessToken);

    const { status, hash } = await postAndWaitForTx(accessToken, () =>
      strato.post(accessToken, StratoPaths.transactionParallel, tx)
    );

    return { status, hash };
  } catch (error) {
    throw error;
  }
};

export const getOpenIssues = async (
  accessToken: string,
): Promise<object> => {
  try {
    const response = await cirrus.get(accessToken, "/" + AdminRegistry, {
      params: {
        address: `eq.${adminRegistry}`,
        select: `*,admins:${AdminRegistry}-admins(address:value),votes:${AdminRegistry}-votes(block_timestamp,issueId:key,index:key2,voter:value),thresholds:${AdminRegistry}-votingThresholds(target:key,func:key2,threshold:value),executed:${AdminRegistry}-IssueExecuted(*)`,
        ['votes.value']: 'neq.""',
        ['executed.limit']: 10,
        ['executed.order']: 'block_timestamp.desc',
      },
    });

    if (response.status !== 200) {
      return {};
    }

    if (!response.data || !Array.isArray(response.data) || response.data.length === 0) {
      return {};
    }

    const { admins: adminsRaw, votes, thresholds, executed } = response.data[0];
    const admins = adminsRaw.filter((admin: any) => admin.address && admin.address !== 'Unknown'); // remove blank admins
    console.log(admins, votes, thresholds);

    const issueIds = new Set(votes.map((v: any) => v.issueId));

    const issuesResponse = await cirrus.get(accessToken, "/" + AdminRegistry + "-IssueCreated", {
      params: {
        issueId: `in.(${[...issueIds].join(',')})`
      },
    });

    return { admins, votes, thresholds, executed, issues: issuesResponse?.data };
  } catch (error) {
    console.log(error);
    return [];
  }
};

export const contractSearch = async (
  accessToken: string,
  search: string,
): Promise<object> => {
  try {
    const accountResponse = await eth.get(accessToken, "/account", {
      params: {
        search
      },
    });

    const storageResponse = await eth.get(accessToken, "/storage", {
      params: {
        search
      },
    });

    if (storageResponse.status !== 200) {
      return {};
    }

    let responseData: any[] = [];

    if (accountResponse.data && Array.isArray(storageResponse.data)) {
      responseData = [ ...responseData, ...accountResponse.data];
    }

    if (storageResponse.data && Array.isArray(storageResponse.data)) {
      responseData = [ ...responseData, ...storageResponse.data];
    }

    return responseData;
  } catch (error) {
    return [];
  }
};

export const getContractDetails = async (
  accessToken: string,
  address: string,
): Promise<object> => {
  try {
    const response = await bloc.get(accessToken, `/contracts/contract/${address}/details`);

    if (response.status !== 200) {
      return {};
    }

    if (!response.data) {
      return {};
    }

    return response.data;
  } catch (error) {
    return {};
  }
};
