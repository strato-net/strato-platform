import { bloc, strato, extractErrorMessage } from "./api";
import { config } from "../config";
import { logError, logInfo } from "./logger";
import { FunctionInput, BuiltTx, TxResult, TxResponse } from "../types";

// ============================================================================
// Core Transaction Functions
// ============================================================================

/**
 * A posted transaction had no result when the wait ran out. Its outcome is unknown: it may still
 * be mined, or a later transaction may take its nonce and evict it, so nothing that depends on it
 * may proceed as if it succeeded.
 */
export class TxPendingError extends Error {
  constructor(readonly hashes: string[]) {
    super(`Transaction outcome unknown, still pending after the wait: ${hashes.join(", ")}`);
    this.name = "TxPendingError";
  }
}

let stratoWriteQueue: Promise<void> = Promise.resolve();

const enqueueStratoWrite = async <T>(task: () => Promise<T>): Promise<T> => {
  const run = stratoWriteQueue.then(task, task);
  stratoWriteQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
};

/**
 * Build transaction from inputs (single or batch)
 */
export const buildFunctionTx = (
  inputs: FunctionInput | FunctionInput[],
): BuiltTx => ({
  txs: (Array.isArray(inputs) ? inputs : [inputs]).map(
    ({ contractName, contractAddress, method, args }) => ({
      type: config.strato.tx.type,
      payload: { contractName, contractAddress, method, args },
    }),
  ),
  txParams: {
    gasLimit: config.strato.gas.limit,
    gasPrice: config.strato.gas.price,
  },
});

// The node reports failure reasons as plain strings, e.g. "solidity require failed: MB: bad state";
// callers match on them, so they must reach the thrown Error unchanged
const getTxFailureMessage = (result: any): string => {
  const reason =
    result?.txResult?.status?.details ||
    result?.txResult?.status?.type?.contents ||
    result?.txResult?.message ||
    result?.txResult?.response ||
    result?.error ||
    result?.message ||
    "Transaction failed";
  return typeof reason === "string" ? reason : extractErrorMessage(reason);
};

const getTxFailureDetails = (result: any) => ({
  hash: result?.hash,
  status: result?.status,
  message: result?.message,
  error: result?.error,
  txResultMessage: result?.txResult?.message,
  txResultResponse: result?.txResult?.response,
  txResultStatus: result?.txResult?.status,
  blockHash: result?.txResult?.blockHash,
  transactionHash: result?.txResult?.transactionHash,
});

/**
 * Poll until condition met or timeout
 */
export const until = async <T>(
  predicate: (result: T) => boolean,
  action: () => Promise<T>,
  {
    timeout = config.strato.polling.defaultTimeout,
    interval = config.strato.polling.defaultInterval,
  }: { timeout?: number; interval?: number } = {},
): Promise<T> => {
  const deadline = Date.now() + timeout;

  while (true) {
    const result = await action();
    if (predicate(result) || Date.now() >= deadline) return result;
    await new Promise((r) => setTimeout(r, interval));
  }
};

const isFailure = (result: any) =>
  result?.status === "Failure" || result?.status === "Failed";

const throwTxFailure = (failed: any, operation: string, txHashes: string[]): never => {
  const error = new Error(getTxFailureMessage(failed));
  logError("StratoHelper", error, {
    operation,
    result: getTxFailureDetails(failed),
    txHashes,
  });
  throw error;
};

/**
 * Post transaction(s) and wait until every one of them has succeeded.
 * Throws on any failure, and throws TxPendingError when the wait runs out first.
 */
export const postAndWaitForTx = async (
  postFn: () => Promise<any>,
  timeout = config.strato.polling.defaultTimeout,
): Promise<TxResponse> => {
  // Post and validate
  const response = await postFn();
  if (!Array.isArray(response) || !response.length) {
    throw new Error("Invalid transaction response");
  }

  const txHashes = response.map((r, i) => {
    if (!r?.hash) throw new Error(`Invalid tx result at index ${i}`);
    return r.hash;
  });

  // resolve=true may already carry the outcome of every transaction
  const immediateFailure = response.find(isFailure);
  if (immediateFailure) {
    throwTxFailure(immediateFailure, "immediateTransactionFailure", txHashes);
  }
  if (response.every((r) => r?.status === "Success")) {
    return { status: "Success", hash: txHashes[0] };
  }

  const results = await until(
    (res: TxResult[]) => {
      const failed = res.find(isFailure);
      if (failed) {
        throwTxFailure(failed, "polledTransactionFailure", txHashes);
      }
      return res.length === txHashes.length && res.every((r) => r?.status !== "Pending");
    },
    () => bloc.post("/transactions/results", txHashes),
    { timeout },
  );

  if (results.length === txHashes.length && results.every((r) => r?.status === "Success")) {
    return { status: "Success", hash: txHashes[0] };
  }

  const unresolved = txHashes.filter((_, i) => results[i]?.status !== "Success");
  const unexpected = results.find((r) => r && r.status !== "Pending" && r.status !== "Success");
  if (unexpected) {
    throw new Error(`Unexpected transaction status ${unexpected.status} for ${unexpected.hash}`);
  }
  throw new TxPendingError(unresolved);
};

/**
 * Execute transaction(s) with logging. Resolves only when every transaction succeeded.
 */
export const execute = async (
  inputs: FunctionInput | FunctionInput[],
  timeout?: number,
): Promise<TxResponse> => {
  const inputArray = Array.isArray(inputs) ? inputs : [inputs];
  const { method = "unknown", contractName = "unknown", args } = inputArray[0] || {};
  const context = method === "castVoteOnIssue"
    ? `${args?._func} via ${contractName}`
    : `${method} on ${contractName}`;

  return enqueueStratoWrite(async () => {
    logInfo("StratoHelper", `Executing ${context} (${inputArray.length} tx)`);

    try {
      const result = await postAndWaitForTx(
        () =>
          strato.post(
            "/transaction/parallel?resolve=true",
            buildFunctionTx(inputs),
          ),
        timeout,
      );

      logInfo("StratoHelper", `${result.status}: ${context} (${result.hash})`);
      return result;
    } catch (error) {
      if (error instanceof TxPendingError) {
        logError("StratoHelper", error, { operation: context });
      }
      throw error;
    }
  });
};

// ============================================================================
// Governed Calls
// ============================================================================

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

// Solidity name of a bloc ABI type, as a {type, value} argument hint spells it
const solidityTypeName = (type: AbiType): string => {
  switch (type.tag) {
    case "Int":
      return `${type.signed ? "" : "u"}int${type.bytes ? type.bytes * 8 : ""}`;
    case "String":
    case "Bool":
    case "Address":
    case "Account":
    case "Decimal":
      return type.tag.toLowerCase();
    case "Bytes":
      return `bytes${type.bytes ?? ""}`;
    case "Array":
      return `${solidityTypeName(type.entry || {})}[${type.length ?? ""}]`;
    case "UnknownLabel":
      return type.contents || "";
    case "UserDefined":
      return solidityTypeName(type.actual || {});
    default:
      return type.typedef || "";
  }
};

const funcArgsCache = new Map<string, Promise<[string, AbiType][]>>();

// A deployed function's [name, type] parameters in declaration order, read once per process
const fetchFuncArgs = (address: string, method: string): Promise<[string, AbiType][]> => {
  const key = `${address.toLowerCase()}.${method}`;
  let funcArgs = funcArgsCache.get(key);
  if (!funcArgs) {
    funcArgs = bloc.get<any>(`/contracts/contract/${address}/details`).then((details) => {
      const params = details?._functions?.[method]?._funcArgs;
      if (!Array.isArray(params)) {
        throw new Error(`Function ${method} not found on contract ${address}`);
      }
      return params
        .slice()
        .sort((a, b) => (a?.[1]?.index ?? 0) - (b?.[1]?.index ?? 0))
        .map((entry): [string, AbiType] => [entry?.[0] ?? "", entry?.[1]?.type || {}]);
    });
    funcArgsCache.set(key, funcArgs);
    funcArgs.catch(() => funcArgsCache.delete(key));
  }
  return funcArgs;
};

/**
 * The AdminRegistry call that runs an onlyOwner function of a registry-owned contract: the registry
 * executes it at once for a whitelisted caller such as this relayer. Its args go positionally into
 * castVoteOnIssue's variadic _args, each hinted with the declared type, since unhinted the node
 * infers them instead (a digit-only address becomes an int). Revert reasons come back unchanged.
 */
export const governed = async ({ contractAddress, method, args }: FunctionInput): Promise<FunctionInput> => {
  const funcArgs = await fetchFuncArgs(contractAddress, method);
  const hintedArgs = funcArgs.flatMap(([name, type]) => {
    if (args[name] === undefined) throw new Error(`Missing ${method} argument ${name}`);
    return type.tag === "Variadic" ? args[name] : [{ type: solidityTypeName(type), value: args[name] }];
  });
  return {
    contractName: "AdminRegistry",
    contractAddress: config.adminRegistry.address,
    method: "castVoteOnIssue",
    args: { _target: contractAddress, _func: method, _args: hintedArgs },
  };
};

/**
 * Execute onlyOwner call(s) on registry-owned contracts through the AdminRegistry.
 */
export const executeGoverned = async (
  inputs: FunctionInput | FunctionInput[],
  timeout?: number,
): Promise<TxResponse> =>
  execute(await Promise.all((Array.isArray(inputs) ? inputs : [inputs]).map(governed)), timeout);

// ============================================================================
// Exports
// ============================================================================

export default {
  buildFunctionTx,
  until,
  postAndWaitForTx,
  execute,
  governed,
  executeGoverned,
};
