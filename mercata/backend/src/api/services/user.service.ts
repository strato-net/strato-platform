import { bloc, cirrus, eth, strato } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { StratoPaths } from "../../config/constants";
import { extractContractName } from "../../utils/utils";
import JSONBig from "json-bigint";
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
        _admin: adminAddress,
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
        _admin: adminAddress,
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
  args: any[],
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

// Dismiss an issue (only works if proposer is the only voter)
export const dismissIssue = async (
  accessToken: string,
  userAddress: string,
  issueId: string,
): Promise<{ status: string; hash: string }> => {
  const tx = await buildFunctionTx({
    contractName: extractContractName(AdminRegistry),
    contractAddress: adminRegistry,
    method: "dismissIssue",
    args: { _issueId: issueId },
  }, userAddress, accessToken);

  const { status, hash } = await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, tx)
  );

  return { status, hash };
};

// Cast a vote on an issue by issueId
export const castVoteOnIssueById = async (
  accessToken: string,
  userAddress: string,
  issueId: string,
): Promise<{ status: string; hash: string }> => {
  try {
    // Find the issue by issueId
    const issueResponse = await cirrus.get(accessToken, "/" + AdminRegistry + "-IssueCreated", {
      params: {
        issueId: `eq.${issueId}`
      },
    });

    if (issueResponse.status !== 200) {
      throw new Error('Failed to fetch issue');
    }

    if (!issueResponse.data || !Array.isArray(issueResponse.data) || issueResponse.data.length === 0) {
      throw new Error('Issue not found');
    }

    const issue = issueResponse.data[0];
    let { target, func, args: argsRaw } = issue;

    // Parse args keeping large numbers as strings (JSONBig with storeAsString)
    const JSONBigString = JSONBig({ storeAsString: true });
    const args = typeof argsRaw === 'string' ? JSONBigString.parse(argsRaw) : argsRaw;
    // console.log("args in castVoteOnIssueById", args);

    // If func is _addAdmin, call the addAdmin endpoint directly
    if (func === '_addAdmin') {
      const adminAddress = Array.isArray(args) ? args[0] : args._admin;
      if (!adminAddress) {
        throw new Error('Admin address not found in args');
      }
      return await addAdmin(accessToken, userAddress, adminAddress);
    }

    // If func is _removeAdmin, call the removeAdmin endpoint directly
    if (func === '_removeAdmin') {
      const adminAddress = Array.isArray(args) ? args[0] : args._admin;
      if (!adminAddress) {
        throw new Error('Admin address not found in args');
      }
      return await removeAdmin(accessToken, userAddress, adminAddress);
    }

    // Get contract name from Cirrus
    const contractResponse = await cirrus.get(accessToken, "contract", {
      params: {
        address: `eq.${target}`
      },
    });

    

    if (contractResponse.status !== 200 || !contractResponse.data || !Array.isArray(contractResponse.data) || contractResponse.data.length === 0) {
      throw new Error('Failed to fetch contract details for target address');
    }
    const contractName = contractResponse.data[0].contract_name;
  

    // Get contract details to retrieve function parameter names
    const contractDetails = await getContractDetails(accessToken, target);
    const allFunctions = (contractDetails as any)?._functions || {};
    const functionInfo = allFunctions[func];
    
    if (!functionInfo || !functionInfo._funcArgs) {
      throw new Error(`Function ${func} not found in contract ${contractName}`);
    }

    // Convert array args to object with parameter names
    const funcArgs = functionInfo._funcArgs as Array<[string, any]>;
    const argsObject: Record<string, any> = {};
    
    if (Array.isArray(args)) {
      funcArgs.forEach(([paramName], index) => {
        if (index < args.length) {
          argsObject[paramName] = args[index];
        }
      });
    } else {
      // If args is already an object, use it directly
      Object.assign(argsObject, args);
    }


    // Build transaction directly to the target contract
    const tx = await buildFunctionTx({
      contractName,
      contractAddress: target,
      method: func,
      args: argsObject,
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
        select: `*,admins:${AdminRegistry}-admins(address:value),votes:${AdminRegistry}-votes(block_timestamp,issueId:key,index:key2,voter:value),thresholds:${AdminRegistry}-votingThresholds(target:key,func:key2,threshold:value)`,
        ['votes.value']: 'neq.""',
        ['votes.value->>length']: 'is.null',
      },
    });

    if (response.status !== 200) {
      return {};
    }

    if (!response.data || !Array.isArray(response.data) || response.data.length === 0) {
      return {};
    }

    const { admins: adminsRaw, votes, defaultVotingThresholdBps, thresholds } = response.data[0];
    const admins = adminsRaw.filter((admin: any) => admin.address && admin.address !== 'Unknown'); // remove blank admins

    const issueIds = new Set(votes.map((v: any) => v.issueId));

    const issuesResponse = await cirrus.get(accessToken, "/" + AdminRegistry + "-IssueCreated", {
      params: {
        issueId: `in.(${[...issueIds].join(',')})`
      },
    });

    // Deduplicate issues by issueId, keeping the most recent one based on block_number
    const issuesMap = new Map();
    (issuesResponse?.data || []).forEach((issue: any) => {
      const existingIssue = issuesMap.get(issue.issueId);
      if (!existingIssue || 
          (issue.block_number && existingIssue.block_number && 
           Number(issue.block_number) > Number(existingIssue.block_number))) {
        issuesMap.set(issue.issueId, issue);
      }
    });
    const uniqueIssues = Array.from(issuesMap.values()).sort((a, b) => {
      // Sort by block_number descending (newest first)
      if (a.block_number && b.block_number) {
        return Number(b.block_number) - Number(a.block_number);
      }
      return 0;
    });

    return { 
      admins, 
      votes, 
      globalThreshold: defaultVotingThresholdBps, 
      thresholds, 
      issues: uniqueIssues 
    };
  } catch (error) {
    console.log(error);
    return {};
  }
};

export const getExecutedIssues = async (
  accessToken: string,
  page: number = 1,
  limit: number = 10
): Promise<object> => {
  try {
    const offset = (page - 1) * limit;
    const [executedResponse, executedCountResponse] = await Promise.all([
      cirrus.get(accessToken, "/" + AdminRegistry + "-IssueExecuted", {
        params: {
          order: 'block_timestamp.desc',
          limit: limit.toString(),
          offset: offset.toString(),
        },
      }),
      cirrus.get(accessToken, "/" + AdminRegistry + "-IssueExecuted", {
        params: {
          select: 'count()',
        },
      }),
    ]);

    const executed = executedResponse?.data || [];
    const executedTotal = executedCountResponse?.data?.[0]?.count || 0;

    return { 
      executed, 
      executedTotal 
    };
  } catch (error) {
    console.log(error);
    return { executed: [], executedTotal: 0 };
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
