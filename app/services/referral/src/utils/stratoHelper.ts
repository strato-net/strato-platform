import { bloc, eth, extractErrorMessage } from "./api";
import { signerAddress, signStratoTx, type UnsignedStratoTx } from "./signer";
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

/** The chain query, when the Escrow is not on the node's main chain. */
const chainQuery = () => (config.strato_chain.chainId ? `?chainid=${config.strato_chain.chainId}` : "");

/**
 * Submit transaction(s) signed with the service's own key:
 *   1. POST bloc/transaction/unsigned        the node builds the unsigned tx(s)
 *   2. sign each EIP-712 digest locally      (utils/signer.ts)
 *   3. POST strato-api/eth/v1.2/transaction  submit each
 *   4. POST bloc/transactions/results        poll to resolution
 * A bundle gets sequential nonces, since the node hands every tx the same base nonce.
 */
export const execute = async (
  inputs: FunctionInput | FunctionInput[],
  timeout?: number,
): Promise<TxResponse> => {
  const inputArray = Array.isArray(inputs) ? inputs : [inputs];
  const { method = "unknown", contractName = "unknown" } = inputArray[0] || {};
  const context = `${method} on ${contractName}`;
  const from = signerAddress().replace(/^0x/, "").toLowerCase();

  logInfo("StratoHelper", `Executing ${context} (${inputArray.length} tx) as ${from}`);

  const built = buildFunctionTx(inputs);
  const raw = await bloc.post(`/transaction/unsigned${chainQuery()}`, { txs: built.txs, address: from, txParams: built.txParams });
  const unsigned: UnsignedStratoTx[] = Array.isArray(raw) ? raw : Array.isArray(raw?._unsignedTxs) ? raw._unsignedTxs : Array.isArray(raw?.txs) ? raw.txs : [];
  if (!unsigned.length) throw new Error("The node returned no unsigned transactions");

  const result = await postAndWaitForTx(async () => {
    const base = BigInt(unsigned[0].data.nonce ?? 0);
    const out: { hash: string }[] = [];
    for (let i = 0; i < unsigned.length; i++) {
      const tx = unsigned[i];
      tx.data.nonce = (base + BigInt(i)).toString();
      const sig = signStratoTx(tx);
      const submitted = await eth.post(`/transaction${chainQuery()}`, {
        nonce: Number(tx.data.nonce),
        gasLimit: tx.data.gasLimit,
        to: tx.data.to,
        funcName: tx.data.functionName,
        args: tx.data.args,
        network: "STRATO",
        r: sig.r,
        s: sig.s,
        v: sig.v,
        txVersion: 1,
      });
      out.push({ hash: typeof submitted === "string" ? submitted : submitted?.hash ?? tx.hash ?? "" });
    }
    return out;
  }, timeout);

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
