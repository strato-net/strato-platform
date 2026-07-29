import { bloc, strato, extractErrorMessage } from "./api";
import { config } from "../config";
import { logInfo } from "./logger";
import { FunctionInput, BuiltTx, TxResult, TxResponse } from "../types";

// ============================================================================
// Core Transaction Functions
// ============================================================================

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
 * Post transaction and wait for completion
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

  // Poll for results
  const results = await until(
    (res: TxResult[]) => {
      const failed = res.find((r) => r?.status === "Failure");
      if (failed) {
        const msg =
          failed.txResult?.message ||
          failed.error ||
          failed.message ||
          "Transaction failed";
        throw new Error(extractErrorMessage(msg));
      }
      return res.every((r) => r?.status !== "Pending");
    },
    () => bloc.post("/transactions/results", txHashes),
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
export const execute = async (
  inputs: FunctionInput | FunctionInput[],
  timeout?: number,
): Promise<TxResponse> => {
  const inputArray = Array.isArray(inputs) ? inputs : [inputs];
  const { method = "unknown", contractName = "unknown" } = inputArray[0] || {};
  const context = `${method} on ${contractName}`;

  logInfo("StratoHelper", `Executing ${context} (${inputArray.length} tx)`);

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
