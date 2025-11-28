import { bloc, cirrus } from "./mercataApiHelper";
import { StratoPaths } from "../config/constants";
import { StratoError } from "../errors";

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

// Helper function to extract error message from SString format
const extractErrorMessage = (errorData: string): string => {
  const sStringMatch = errorData.match(/SString "([^"]+)"/);
  if (sStringMatch) {
    return sStringMatch[1];
  }
  // If no SString format found, return the original error message
  return errorData;
};

export const postAndWaitForTx = async (
  accessToken: string,
  stratoPostFn: () => Promise<any>,
  timeout: number = 60000
): Promise<{ status: string; hash: string }> => {
  try {
    const response = await stratoPostFn();

    if (response.status !== 200) {
      throw new StratoError(`Strato error: ${response.statusText}`, 500);
    }

    const results = response.data;
    if (!Array.isArray(results) || !results.length) {
      throw new StratoError("Invalid or empty transaction results", 400);
    }

    const txHashes = results.map(result => {
      if (!result?.hash) throw new StratoError("Invalid transaction result", 400);
      return result.hash;
    });

    const finalResults = await until(
      (results: any[]) => {
        const failedTx = results.find(r => r?.status === "Failure");
        if (failedTx) {
          // Extract the actual error message from the failed transaction
          const errorMessage = failedTx.txResult?.message || failedTx.error || failedTx.message || "Transaction failed";
          const extractedMessage = extractErrorMessage(errorMessage);
          // Blockchain errors are typically client errors (400) since they're due to user input/state
          throw new StratoError(extractedMessage, 400);
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
  } catch (error: any) {
    // If it's already a StratoError, re-throw it
    if (error instanceof StratoError) {
      throw error;
    }

    // Check if this is an Axios error with response data
    if (error.response?.data && typeof error.response.data === 'string') {
      const extractedMessage = extractErrorMessage(error.response.data);
      throw new StratoError(extractedMessage, 400);
    }

    // Re-throw the original error if it doesn't match the expected format
    throw error;
  }
};

// export const waitOnCirrus = async (
//   accessToken: string,
//   tableName: string,
//   txHash: string,
//   timeout: number = 60000
// ): Promise<{ status: string; hash: string }> => {
//   const predicate = (results: any[]) =>
//     results.every((r) => r.status !== "Pending");

//   const action = async () => {
//     const res = await cirrus.get(accessToken, tableName, {
//       params: { transaction_hash: txHash },
//     });
//     return res.data;
//   };

//   const finalResult = await until(predicate, action, timeout);

//   const statusInfo = finalResult[0];

//   return {
//     status: statusInfo.status,
//     hash: statusInfo.hash,
//   };
// };

/**
 * Executes a transaction and returns the result
 */
export const executeTransaction = async (accessToken: string, tx: any): Promise<{ status: string; hash: string }> => {
  const { status, hash } = await postAndWaitForTx(accessToken, () =>
    bloc.post(accessToken, StratoPaths.transactionParallel, tx)
  );

  return { status, hash };
};
