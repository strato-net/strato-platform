import { bloc, strato } from "./mercataApiHelper";

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
  stratoPostFn: () => Promise<any>,
  timeout: number = 60000
): Promise<{ status: string; hash: string }> => {
  try {
    const response = await stratoPostFn();
    
    if (!response || !Array.isArray(response) || !response.length) {
      throw new Error("Invalid or empty transaction results");
    }

    const txHashes = response.map(result => {
      if (!result?.hash) throw new Error("Invalid transaction result");
      return result.hash;
    });

    const finalResults = await until(
      (results: any[]) => {
        const failedTx = results.find(r => r?.status === "Failure");
        if (failedTx) {
          // Extract the actual error message from the failed transaction
          const errorMessage = failedTx.txResult?.message || failedTx.error || failedTx.message || "Transaction failed";
          const extractedMessage = extractErrorMessage(errorMessage);
          throw new Error(extractedMessage);
        }
        return results.every(r => r?.status !== "Pending");
      },
      async () => await bloc.post("/transactions/results", txHashes),
      timeout
    );

    return {
      status: finalResults[0].status,
      hash: finalResults[0].hash
    };
  } catch (error: any) {
    // Check if this is an error with response data
    if (error.message && typeof error.message === 'string') {
      const extractedMessage = extractErrorMessage(error.message);
      throw new Error(extractedMessage);
    }
    
    // Re-throw the original error if it doesn't match the expected format
    throw error;
  }
};
