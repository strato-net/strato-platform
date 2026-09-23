import {
  bloc,
  strato,
  relayerBloc,
  relayerStrato,
  extractErrorMessage,
} from "./api";
import { config } from "../config";
import { logError, logInfo } from "./logger";
import {
  FunctionInput,
  BuiltTx,
  TxResult,
  TxResponse,
  ApiClient,
} from "../types";

// ============================================================================
// Core Transaction Functions
// ============================================================================

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

const getTxFailureMessage = (result: any): string => {
  return (
    result?.txResult?.status?.details ||
    result?.txResult?.status?.type?.contents ||
    result?.txResult?.message ||
    result?.txResult?.response ||
    result?.error ||
    result?.message ||
    "Transaction failed"
  );
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

/**
 * Evaluate immediate status from resolve=true response
 * Returns TxResponse if definitive result, undefined if polling needed
 */
const getImmediateResult = (
  response: any[],
): TxResponse | undefined => {
  const first = response[0];
  const status = first?.status;

  switch (status) {
    case "Success":
      return { status: "Success", hash: first.hash };
    case "Failed":
    case "Failure": {
      const msg = getTxFailureMessage(first);
      logError("StratoHelper", new Error(extractErrorMessage(msg)), {
        operation: "immediateTransactionFailure",
        result: getTxFailureDetails(first),
      });
      throw new Error(extractErrorMessage(msg));
    }
    case "Pending":
    case undefined:
    default:
      // Pending, undefined, or unknown status: fall back to polling
      return undefined;
  }
};

/**
 * Post transaction and wait for completion
 */
export const postAndWaitForTx = async (
  postFn: () => Promise<any>,
  timeout = config.strato.polling.defaultTimeout,
  resultsClient: ApiClient = bloc,
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

  // Check for immediate result from resolve=true
  const immediate = getImmediateResult(response);
  if (immediate) {
    return immediate;
  }

  // Fallback to polling for results
  const results = await until(
    (res: TxResult[]) => {
      const failed = res.find((r) => r?.status === "Failure");
      if (failed) {
        const msg = getTxFailureMessage(failed);
        logError("StratoHelper", new Error(extractErrorMessage(msg)), {
          operation: "polledTransactionFailure",
          result: getTxFailureDetails(failed),
          txHashes,
        });
        throw new Error(extractErrorMessage(msg));
      }
      return res.every((r) => r?.status !== "Pending");
    },
    () => resultsClient.post("/transactions/results", txHashes),
    { timeout },
  );

  return {
    status: results[0].status as TxResponse["status"],
    hash: results[0].hash,
  };
};

/**
 * Execute transaction(s) with logging
 */
const executeWithClients = async (
  inputs: FunctionInput | FunctionInput[],
  transactionClient: ApiClient,
  resultsClient: ApiClient,
  authority: "operator" | "relayer",
  timeout?: number,
): Promise<TxResponse> => {
  const inputArray = Array.isArray(inputs) ? inputs : [inputs];
  const { method = "unknown", contractName = "unknown" } = inputArray[0] || {};
  const context = `${method} on ${contractName}`;

  return enqueueStratoWrite(async () => {
    logInfo(
      "StratoHelper",
      `Executing ${context} as ${authority} (${inputArray.length} tx)`,
    );

    const result = await postAndWaitForTx(
      () =>
        transactionClient.post(
          "/transaction/parallel?resolve=true",
          buildFunctionTx(inputs),
        ),
      timeout,
      resultsClient,
    );

    logInfo(
      "StratoHelper",
      `${result.status}: ${context} as ${authority} (${result.hash})`,
    );
    return result;
  });
};

export const execute = (
  inputs: FunctionInput | FunctionInput[],
  timeout?: number,
): Promise<TxResponse> =>
  executeWithClients(inputs, strato, bloc, "operator", timeout);

export const executeAsRelayer = (
  inputs: FunctionInput | FunctionInput[],
  timeout?: number,
): Promise<TxResponse> =>
  executeWithClients(
    inputs,
    relayerStrato,
    relayerBloc,
    "relayer",
    timeout,
  );

// ============================================================================
// Exports
// ============================================================================

export default {
  buildFunctionTx,
  until,
  postAndWaitForTx,
  execute,
  executeAsRelayer,
};
