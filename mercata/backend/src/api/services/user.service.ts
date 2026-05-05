import { bloc, cirrus, eth, strato } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { StratoPaths } from "../../config/constants";
import { extractContractName } from "../../utils/utils";
import JSONBig from "json-bigint";
const { AdminRegistry, adminRegistry } = constants;

const normalizeIssueArg = (arg: any, typeInfo: any): any => {
  const tag = typeInfo?.tag?.toLowerCase();

  if (tag === "address" && typeof arg === "string" && /^[0-9a-fA-F]{40}$/.test(arg)) {
    return `0x${arg}`;
  }

  if (tag === "array" && Array.isArray(arg)) {
    return arg.map((entry) => normalizeIssueArg(entry, typeInfo?.entry));
  }

  return arg;
};

const normalizeIssueArgs = async (
  accessToken: string,
  target: string,
  func: string,
  args: any[],
): Promise<any[]> => {
  if (!Array.isArray(args)) {
    console.log("[AdminVoteDebug] issue args were not an array", { target, func, args });
    return args;
  }

  const contractDetails = await getContractDetails(accessToken, target);
  const functionInfo = (contractDetails as any)?._functions?.[func];
  const funcArgs = functionInfo?._funcArgs as Array<[string, { type?: any }]> | undefined;

  if (!Array.isArray(funcArgs)) {
    console.log("[AdminVoteDebug] missing function metadata for issue args", {
      target,
      func,
      args,
      functionNames: Object.keys((contractDetails as any)?._functions || {}),
    });
    return args;
  }

  const normalizedArgs = args.map((arg, index) => normalizeIssueArg(arg, funcArgs[index]?.[1]?.type));
  console.log("[AdminVoteDebug] normalized issue args", {
    target,
    func,
    args,
    normalizedArgs,
    funcArgs: funcArgs.map(([name, metadata]) => ({ name, type: metadata?.type })),
  });

  return normalizedArgs;
};

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

// Add a new guardian to the registry
export const addGuardian = async (
  accessToken: string,
  userAddress: string,
  guardianAddress: string
): Promise<{ status: string; hash: string }> => {
  try {
    const tx = await buildFunctionTx({
      contractName: extractContractName(AdminRegistry),
      contractAddress: adminRegistry,
      method: "addGuardian",
      args: {
        _guardian: guardianAddress,
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

// Remove a guardian from the registry
export const removeGuardian = async (
  accessToken: string,
  userAddress: string,
  guardianAddress: string
): Promise<{ status: string; hash: string }> => {
  try {
    const tx = await buildFunctionTx({
      contractName: extractContractName(AdminRegistry),
      contractAddress: adminRegistry,
      method: "removeGuardian",
      args: {
        _guardian: guardianAddress,
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

export const executeIssue = async (
  accessToken: string,
  userAddress: string,
  target: string,
  func: string,
  args: any[],
): Promise<{ status: string; hash: string }> => {
  console.log("[AdminVoteDebug] executeIssue service input", { userAddress, target, func, args });
  const normalizedArgs = await normalizeIssueArgs(accessToken, target, func, args);

  const tx = await buildFunctionTx({
    contractName: extractContractName(AdminRegistry),
    contractAddress: adminRegistry,
    method: "executeIssue",
    args: {
      _target: target,
      _func: func,
      _args: normalizedArgs,
    },
  }, userAddress, accessToken);
  console.log("[AdminVoteDebug] executeIssue tx args", tx.txs?.[0]?.payload?.args);

  const { status, hash } = await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, tx)
  );

  return { status, hash };
};

export const withdrawVote = async (
  accessToken: string,
  userAddress: string,
  target: string,
  func: string,
  args: any[],
): Promise<{ status: string; hash: string }> => {
  console.log("[AdminVoteDebug] withdrawVote service input", { userAddress, target, func, args });
  const normalizedArgs = await normalizeIssueArgs(accessToken, target, func, args);

  const tx = await buildFunctionTx({
    contractName: extractContractName(AdminRegistry),
    contractAddress: adminRegistry,
    method: "withdrawVote",
    args: {
      _target: target,
      _func: func,
      _args: normalizedArgs,
    },
  }, userAddress, accessToken);
  console.log("[AdminVoteDebug] withdrawVote tx args", tx.txs?.[0]?.payload?.args);

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

    // If func is _addGuardian, call the addGuardian endpoint directly
    if (func === '_addGuardian') {
      const guardianAddress = Array.isArray(args) ? args[0] : args._guardian;
      if (!guardianAddress) {
        throw new Error('Guardian address not found in args');
      }
      return await addGuardian(accessToken, userAddress, guardianAddress);
    }

    // If func is _removeGuardian, call the removeGuardian endpoint directly
    if (func === '_removeGuardian') {
      const guardianAddress = Array.isArray(args) ? args[0] : args._guardian;
      if (!guardianAddress) {
        throw new Error('Guardian address not found in args');
      }
      return await removeGuardian(accessToken, userAddress, guardianAddress);
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

const parseTimelock = (row: any) => {
  const raw = row?.timelock || row?.value || {};
  return {
    issueId: row?.issueId || row?.key,
    queuedAt: Number(row?.queuedAt ?? raw?.queuedAt ?? 0),
    executableAt: Number(row?.executableAt ?? raw?.executableAt ?? 0),
    expiresAt: Number(row?.expiresAt ?? raw?.expiresAt ?? 0),
  };
};

export const getOpenIssues = async (
  accessToken: string,
): Promise<object> => {
  try {
    const response = await cirrus.get(accessToken, "/" + AdminRegistry, {
      params: {
        address: `eq.${adminRegistry}`,
        select: `*,admins:${AdminRegistry}-admins(address:value),guardians:${AdminRegistry}-guardians(address:value),votes:${AdminRegistry}-votes(block_timestamp,issueId:key,index:key2,voter:value),thresholds:${AdminRegistry}-votingThresholds(target:key,func:key2,threshold:value)`,
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

    const { admins: adminsRaw = [], guardians: guardiansRaw = [], votes: votesRaw = [], defaultVotingThresholdBps, thresholds = [] } = response.data[0];
    const votes = Array.isArray(votesRaw) ? votesRaw : [];
    const admins = adminsRaw.filter((admin: any) => admin.address && admin.address !== 'Unknown'); // remove blank admins
    const guardians = (guardiansRaw || []).filter((guardian: any) => guardian.address && guardian.address !== 'Unknown'); // remove blank guardians

    const issueIds = new Set(votes.map((v: any) => v.issueId));

    const [issuesResponse, timelocksResponse] = await Promise.all([
      issueIds.size > 0
        ? cirrus.get(accessToken, "/" + AdminRegistry + "-IssueCreated", {
            params: {
              issueId: `in.(${[...issueIds].join(',')})`
            },
          })
        : Promise.resolve({ data: [] }),
      issueIds.size > 0
        ? cirrus.get(accessToken, "/" + AdminRegistry + "-timelocks", {
            params: {
              key: `in.(${[...issueIds].join(',')})`,
              select: "issueId:key,timelock:value,queuedAt:value->>queuedAt,executableAt:value->>executableAt,expiresAt:value->>expiresAt",
            },
          })
        : Promise.resolve({ data: [] }),
    ]);

    const timelocksMap = new Map(
      (timelocksResponse?.data || [])
        .map(parseTimelock)
        .filter((timelock: any) => timelock.issueId)
        .map((timelock: any) => [timelock.issueId, timelock])
    );

    // Deduplicate issues by issueId, keeping the most recent one based on block_number
    const issuesMap = new Map();
    (issuesResponse?.data || []).forEach((issue: any) => {
      const existingIssue = issuesMap.get(issue.issueId);
      if (!existingIssue || 
          (issue.block_number && existingIssue.block_number && 
           Number(issue.block_number) > Number(existingIssue.block_number))) {
        issuesMap.set(issue.issueId, {
          ...issue,
          timelock: timelocksMap.get(issue.issueId) || { queuedAt: 0, executableAt: 0, expiresAt: 0 },
        });
      }
    });
    const uniqueIssues = Array.from(issuesMap.values()).sort((a, b) => {
      // Sort by block_number descending (newest first)
      if (a.block_number && b.block_number) {
        return Number(b.block_number) - Number(a.block_number);
      }
      return 0;
    });
    const queuedIssues = uniqueIssues.filter((issue: any) => Number(issue.timelock?.executableAt || 0) > 0);
    const openIssues = uniqueIssues.filter((issue: any) => Number(issue.timelock?.executableAt || 0) === 0);

    return { 
      admins, 
      guardians,
      votes, 
      globalThreshold: defaultVotingThresholdBps, 
      thresholds, 
      issues: openIssues,
      queuedIssues,
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
