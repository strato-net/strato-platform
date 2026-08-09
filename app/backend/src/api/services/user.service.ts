import { bloc, cirrus, eth, strato } from "../../utils/appApiHelper";
import { constants } from "../../config/constants";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx, until } from "../../utils/txHelper";
import { StratoPaths } from "../../config/constants";
import { extractContractName } from "../../utils/utils";
import JSONBig from "json-bigint";
import { normalizeLegacyEscapes } from "../helpers/jsonStringParsing.helper";
const { AdminRegistry, adminRegistry, DAY_MS } = constants;
const JSONBigString = JSONBig({ storeAsString: true });
const JSONBigNumber = JSONBig();

type AbiType = {
  tag?: string;
  signed?: boolean;
  bytes?: number;
  entry?: AbiType;
  length?: number;
  actual?: AbiType;
  contents?: string;
  typedef?: string;
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
      strato.post(accessToken, StratoPaths.transactionParallel, tx, {
        transformRequest: [(data) => JSONBigNumber.stringify(data)],
      })
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

const sameAddress = (a: string, b: string): boolean =>
  (a || "").toLowerCase().replace(/^0x/, "") === (b || "").toLowerCase().replace(/^0x/, "");

const solidityTypeName = (type: any): string => {
  switch (type?.tag) {
    case "Int":
      return `${type.signed ? "" : "u"}int${type.bytes ? type.bytes * 8 : ""}`;
    case "String":
    case "Bytes":
    case "Bool":
    case "Address":
    case "Account":
    case "Decimal":
      return type.tag.toLowerCase() + (type.tag === "Bytes" && type.bytes ? type.bytes : "");
    case "Array":
      return `${solidityTypeName(type.entry)}[${type.length ?? ""}]`;
    case "UnknownLabel":
      return type.contents || "";
    case "Struct":
    case "Enum":
    case "Error":
    case "Contract":
      return type.typedef || "";
    case "UserDefined":
      return solidityTypeName(type.actual);
    case "Variadic":
      return "variadic";
    default:
      return "";
  }
};

// Ordered [name, Solidity type] pairs for a function's parameters
const fetchFuncArgs = async (
  accessToken: string,
  address: string,
  func: string,
): Promise<{ contractName: string; funcArgs: [string, AbiType][] }> => {
  let details: any = await getContractDetails(accessToken, address);
  if (details._contractName === "Proxy") {
    const storage = await eth.get(accessToken, "/storage", {
      params: { address, key: "logicContract" },
    });
    const rawLogicAddress = storage.data?.find((row: any) => row.key === "logicContract")?.value;
    const logicAddress = rawLogicAddress?.match(/^address\(([0-9a-fA-F]{40})\)$/)?.[1];
    if (!logicAddress) {
      throw new Error(`Logic contract not found for proxy ${address}`);
    }
    details = await getContractDetails(accessToken, logicAddress);
  }
  const funcArgs = details?._functions?.[func]?._funcArgs;
  if (!Array.isArray(funcArgs)) {
    throw new Error(`Function ${func} not found on contract ${address}`);
  }
  const result: [string, AbiType][] = funcArgs
    .slice()
    .sort((a, b) => (a?.[1]?.index ?? 0) - (b?.[1]?.index ?? 0))
    .map((entry): [string, AbiType] => [entry?.[0] ?? "", entry?.[1]?.type || {}]);
  const contractName = details._contractName || details.contractName;
  if (!contractName) {
    throw new Error(`Contract name not found for ${address}`);
  }
  return { contractName, funcArgs: result };
};

// Parse a textual transaction arg back to a raw value (strings/arrays/numbers are
// JSON-encoded in transaction args); non-JSON text passes through verbatim
const parseTxArg = (text: string): any => {
  try {
    return JSONBigString.parse(normalizeLegacyEscapes(text));
  } catch {
    return text;
  }
};

const formatArg = (type: AbiType, value: any): any => {
  const typeName = solidityTypeName(type);
  if (value === undefined) {
    throw new Error(`Missing ${typeName || "function"} argument`);
  }

  switch (type.tag) {
    case "String":
      return String(value);
    case "Int": {
      const integer = String(value).trim();
      if (!/^-?\d+$/.test(integer) || (!type.signed && integer.startsWith("-"))) {
        throw new Error(`Invalid ${typeName}: ${value}`);
      }
      return JSONBigNumber.parse(integer);
    }
    case "Decimal": {
      const decimal = String(value).trim();
      if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(decimal)) {
        throw new Error(`Invalid decimal: ${value}`);
      }
      return JSONBigNumber.parse(decimal);
    }
    case "Bool":
      if (typeof value === "boolean") return value;
      if (/^true$/i.test(value)) return true;
      if (/^false$/i.test(value)) return false;
      throw new Error(`Invalid bool: ${value}`);
    case "Address":
    case "Account":
    case "Contract": {
      const address = String(value).trim().toLowerCase().replace(/^0x/, "");
      if (!/^[0-9a-f]{1,40}$/.test(address)) {
        throw new Error(`Invalid address: ${value}`);
      }
      return `0x${address}`;
    }
    case "Bytes": {
      const bytes = String(value).trim().replace(/^0x/, "");
      if (!/^(?:[0-9a-fA-F]{2})*$/.test(bytes) || (type.bytes && bytes.length !== type.bytes * 2)) {
        throw new Error(`Invalid ${typeName}: ${value}`);
      }
      return bytes;
    }
    case "Array": {
      if (!Array.isArray(value)) {
        throw new Error(`Invalid ${typeName}: expected an array`);
      }
      if (type.length !== undefined && value.length !== type.length) {
        throw new Error(`Invalid ${typeName}: expected ${type.length} values`);
      }
      return value.map((entry) => formatArg(type.entry || {}, entry));
    }
    case "UserDefined":
      return formatArg(type.actual || {}, value);
    case "Enum":
      return /^-?\d+$/.test(String(value).trim())
        ? JSONBigNumber.parse(String(value).trim())
        : value;
    default:
      return value;
  }
};

const hintedArg = (type: AbiType, value: any): any => {
  const typeName = solidityTypeName(type);
  const formattedValue = formatArg(type, value);

  return typeName && type.tag !== "Variadic"
    ? { type: typeName, value: formattedValue }
    : formattedValue;
};

// Direct call to target.func(args). When the caller doesn't own the target, the
// Ownable fallback routes msg.sig/msg.data into AdminRegistry.castVoteOnIssue, so
// the issueId is keccak256(target, func, args) over the exact call args
const callTargetFunction = async (
  accessToken: string,
  userAddress: string,
  contractName: string,
  contractAddress: string,
  method: string,
  args: Record<string, any>,
): Promise<{ status: string; hash: string }> => {
  const tx = await buildFunctionTx({
    contractName,
    contractAddress,
    method,
    args,
  }, userAddress, accessToken);

  return postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, tx, {
      transformRequest: [(data) => JSONBigNumber.stringify(data)],
    })
  );
};

type ContractCall = {
  contractName: string;
  contractAddress: string;
  method: string;
  args: Record<string, any>;
};

// The registry call a vote resolves to, whose args it hashes into the issueId
const castVoteCall = (target: string, func: string, typedArgs: any[]): ContractCall => ({
  contractName: extractContractName(AdminRegistry),
  contractAddress: adminRegistry,
  method: "castVoteOnIssue",
  args: { _func: func, _target: target, _args: typedArgs },
});

// Resolve an issue into the call that creates it, plus its args coerced to the
// target's declared Solidity types. Creating one normally calls the target function
// directly (SMD-style): the Ownable fallback hands the registry msg.sig/msg.data,
// which the VM has already coerced, so applying the same coercion here keeps the
// issueId aligned across voters. The AdminRegistry is the exception: it owns itself,
// so its onlyOwner functions can't reach the fallback and go via castVoteOnIssue
const resolveIssueCall = async (
  accessToken: string,
  target: string,
  func: string,
  args: any[],
): Promise<{ call: ContractCall; typedArgs: any[] }> => {
  const { contractName, funcArgs } = await fetchFuncArgs(accessToken, target, func);
  if (sameAddress(target, adminRegistry)) {
    const typedArgs = args.map((arg, i) =>
      hintedArg(funcArgs[i]?.[1] || {}, arg));
    return { call: castVoteCall(target, func, typedArgs), typedArgs };
  }
  const typedArgs = funcArgs.map(([, type], i) => hintedArg(type, args[i]));
  const namedArgs = Object.fromEntries(funcArgs.map(([name], i) => [name, typedArgs[i]]));
  return { call: { contractName, contractAddress: target, method: func, args: namedArgs }, typedArgs };
};

// Cirrus indexes a block only once it is mined, so the vote's event trails its receipt
const ISSUE_EVENT_TIMEOUT_MS = 8000;

// The issueId from whichever vote event the transaction emitted, or null if it
// emitted neither — meaning nothing reached the registry
const findIssueIdForTx = async (accessToken: string, hash: string): Promise<string | null> => {
  // The vote already succeeded on chain, so a lookup failure must never fail it
  const firstRow = (event: string) =>
    cirrus
      .get(accessToken, "/" + AdminRegistry + "-" + event, {
        params: { transaction_hash: `eq.${hash}`, limit: "1" },
      })
      .then((res) => res.data?.[0])
      .catch(() => undefined);

  const fetchIssueId = async (): Promise<string | null> => {
    const [created, voted] = await Promise.all([firstRow("IssueCreated"), firstRow("IssueVoted")]);
    return created?.issueId ?? voted?.issueId ?? null;
  };

  return until((issueId) => issueId !== null, fetchIssueId, ISSUE_EVENT_TIMEOUT_MS);
};

// An issue only exists if the call reached the registry. A target function without
// onlyOwner has no fallback to catch the call, so it just executes — report what the
// transaction actually did rather than assuming a vote was recorded.
export const createIssue = async (
  accessToken: string,
  userAddress: string,
  target: string,
  func: string,
  args: any[],
): Promise<{ status: string; hash: string; issueId: string | null; governed: boolean }> => {
  const { call } = await resolveIssueCall(accessToken, target, func, args);
  const { status, hash } = await callTargetFunction(
    accessToken, userAddress, call.contractName, call.contractAddress, call.method, call.args);
  const issueId = await findIssueIdForTx(accessToken, hash);

  return { status, hash, issueId, governed: issueId !== null };
};

// Dry-run the issue in the node's VM sandbox (nothing is signed or committed), so
// admins can preview its real impact before voting. Always simulated as the
// registry's castVoteOnIssue, since the node derives the issue's `effect` only for
// that method, using the same typed args the live call sends so both agree on the
// issueId. Forwarded to the node's bloc simulate endpoint, which the UI can't reach.
export const simulateCastVoteOnIssue = async (
  accessToken: string,
  userAddress: string,
  target: string,
  func: string,
  args: any[],
): Promise<any> => {
  const { typedArgs } = await resolveIssueCall(accessToken, target, func, args);
  const body = {
    txs: [{ payload: { ...castVoteCall(target, func, typedArgs), metadata: {} }, type: "FUNCTION" }],
    address: userAddress.replace(/^0x/, ""),
  };
  const response = await bloc.post(accessToken, "/transaction/simulate", body, {
    params: { trace: true },
  });
  const data = response.data;
  return Array.isArray(data) ? data[0] : data;
};

// Cast a vote on an existing issue by replaying the exact transaction that created
// it, so the call hashes to the same issueId instead of opening a new issue
export const castVoteOnIssueById = async (
  accessToken: string,
  userAddress: string,
  issueId: string,
): Promise<{ status: string; hash: string }> => {
  const issueResponse = await cirrus.get(accessToken, "/" + AdminRegistry + "-IssueCreated", {
    params: {
      issueId: `eq.${issueId}`,
      limit: "1",
    },
  });
  const issue = issueResponse.data?.[0];
  if (!issue?.transaction_hash) {
    throw new Error("Issue not found");
  }

  const txResponse = await eth.get(accessToken, "/transaction", { params: { hash: issue.transaction_hash } });
  const tx = Array.isArray(txResponse.data) ? txResponse.data[0] : null;
  if (!tx?.funcName || !Array.isArray(tx.args)) {
    throw new Error("Original issue transaction not found");
  }

  // Fixed args are decoded once from the original transaction source. Variadic
  // tails stay verbatim because their element types cannot be recovered from ABI.
  const { contractName, funcArgs } = await fetchFuncArgs(accessToken, tx.to, tx.funcName);
  const namedArgs = Object.fromEntries(funcArgs.map(([name, type], i) =>
    [name, type.tag === "Variadic" ? tx.args.slice(i) : hintedArg(type, parseTxArg(tx.args[i]))]));

  return callTargetFunction(accessToken, userAddress, contractName, tx.to, tx.funcName, namedArgs);
};

// Deduplicate issues by issueId, keeping the most recent one based on block_number,
// then sort by block_number descending (newest first)
const latestPerIssue = (rows: any[]): any[] => {
  const issuesMap = new Map();
  rows.forEach((issue: any) => {
    const existingIssue = issuesMap.get(issue.issueId);
    if (!existingIssue ||
        (issue.block_number && existingIssue.block_number &&
         Number(issue.block_number) > Number(existingIssue.block_number))) {
      issuesMap.set(issue.issueId, issue);
    }
  });
  return Array.from(issuesMap.values()).sort((a, b) => {
    if (a.block_number && b.block_number) {
      return Number(b.block_number) - Number(a.block_number);
    }
    return 0;
  });
};

export const getOpenIssues = async (
  accessToken: string,
  page: number = 1,
  limit: number = 10
): Promise<object> => {
  try {
    const response = await cirrus.get(accessToken, "/" + AdminRegistry, {
      params: {
        address: `eq.${adminRegistry}`,
        select: `defaultVotingThresholdBps,admins:${AdminRegistry}-admins(address:value),votes:${AdminRegistry}-votes(issueId:key,voter:value),thresholds:${AdminRegistry}-votingThresholds(target:key,func:key2,threshold:value)`,
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

    // The whole open set is needed to deduplicate and order before slicing, but it is
    // fetched without args, which is over 90% of the payload and is only read for the
    // issues on the requested page
    const indexResponse = await cirrus.get(accessToken, "/" + AdminRegistry + "-IssueCreated", {
      params: {
        issueId: `in.(${[...issueIds].join(',')})`,
        select: 'issueId,block_number',
      },
    });

    const orderedIssues = latestPerIssue(indexResponse?.data || []);
    const pageIssueIds = orderedIssues
      .slice((page - 1) * limit, page * limit)
      .map((issue: any) => issue.issueId);

    const issuesResponse = pageIssueIds.length
      ? await cirrus.get(accessToken, "/" + AdminRegistry + "-IssueCreated", {
          params: {
            issueId: `in.(${pageIssueIds.join(',')})`,
            select: 'issueId,target,func,args,block_number',
          },
        })
      : null;

    return { 
      admins, 
      votes, 
      globalThreshold: defaultVotingThresholdBps, 
      thresholds, 
      issues: latestPerIssue(issuesResponse?.data || []),
      issuesTotal: orderedIssues.length
    };
  } catch (error) {
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
    // Both queries sort/aggregate the whole table unless they are bounded. block_timestamp
    // is the only usable bound: block_number is stored as text (so range comparisons are
    // lexicographic) and anchoring on id would need a max(id) lookup that costs as much as
    // the sort it replaces. Read off constants so the network-specific window applies.
    const since = new Date(Date.now() - constants.EXECUTED_ISSUES_LOOKBACK_DAYS * DAY_MS)
      .toISOString()
      .slice(0, 10);
    const [executedResponse, executedCountResponse] = await Promise.all([
      cirrus.get(accessToken, "/" + AdminRegistry + "-IssueExecuted", {
        params: {
          select: 'issueId,target,func,args,executor',
          block_timestamp: `gte.${since}`,
          order: 'block_timestamp.desc',
          limit: limit.toString(),
          offset: offset.toString(),
        },
      }),
      cirrus.get(accessToken, "/" + AdminRegistry + "-IssueExecuted", {
        params: {
          select: 'count()',
          block_timestamp: `gte.${since}`,
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
