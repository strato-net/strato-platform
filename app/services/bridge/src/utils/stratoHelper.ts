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
  const { method = "unknown", contractName = "unknown" } = inputArray[0] || {};
  const context = `${method} on ${contractName}`;

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
// Exports
// ============================================================================

export default {
  buildFunctionTx,
  until,
  postAndWaitForTx,
  execute,
};
