import { bloc, cirrus } from "./mercataApiHelper";
import { StratoPaths } from "../config/constants";

export const until = async (
  predicate: (res: any) => boolean,
  action: () => Promise<any>,
  timeout = 60000, // default to 1 minute
  interval = 5000 // check every 5 seconds
): Promise<any> => {
  const start = Date.now();

  while (true) {
    const result = await action();

    if (predicate(result)) {
      return result;
    }

    if (Date.now() - start >= timeout) {
      console.warn("Timeout reached before predicate was satisfied.");
      return result;
    }

    await new Promise((res) => setTimeout(res, interval));
  }
};

export const postAndWaitForTx = async (
  accessToken: string,
  stratoPostFn: () => Promise<any>,
  timeout: number = 60000
): Promise<{ status: string; hash: string }> => {
  const response = await stratoPostFn();
  
  if (response.status !== 200) {
    throw new Error(`Strato error: ${response.statusText}`);
  }

  const results = response.data;
  if (!Array.isArray(results) || !results.length) {
    throw new Error("Invalid or empty transaction results");
  }

  const txHashes = results.map(result => {
    if (!result?.hash) throw new Error("Invalid transaction result");
    return result.hash;
  });

  const finalResults = await until(
    (results: any[]) => {
      const failedTx = results.find(r => r?.status === "Failure");
      if (failedTx) {
        console.error("[TxHelper] Transaction failed", {
          hash: failedTx.hash,
          vmError: failedTx.vmError || failedTx.VmError,
          revertOutput: failedTx.revertOutput,
          message: failedTx.message,
        });
        throw new Error("Transaction failed");
      }
      return results.every(r => r?.status !== "Pending");
    },
    async () => (await bloc.post(accessToken, StratoPaths.result, txHashes)).data,
    timeout
  );

  return {
    status: finalResults[0].status,
    hash: finalResults[0].hash
  };
};

export const waitOnCirrus = async (
  accessToken: string,
  tableName: string,
  txHash: string,
  timeout: number = 60000
): Promise<{ status: string; hash: string }> => {
  const predicate = (results: any[]) =>
    results.every((r) => r.status !== "Pending");

  const action = async () => {
    const res = await cirrus.get(accessToken, tableName, {
      params: { transaction_hash: txHash },
    });
    return res.data;
  };

  const finalResult = await until(predicate, action, timeout);

  const statusInfo = finalResult[0];

  return {
    status: statusInfo.status,
    hash: statusInfo.hash,
  };
};
