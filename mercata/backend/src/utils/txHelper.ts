import axios, { AxiosRequestConfig } from "axios";
import { createHash } from "crypto";
import { bloc, cirrus } from "./mercataApiHelper";
import { StratoPaths } from "../config/constants";
import { StratoError } from "../errors";
import { requestContext } from "./requestContext";

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

const withSequentialUnsignedNonces = (results: any[]): any[] => {
  const firstNonce = results[0]?.data?.nonce;
  if (firstNonce === undefined || firstNonce === null) return results;

  const baseNonce = BigInt(firstNonce);
  return results.map((result, index) => {
    if (result?.data?.nonce === undefined || result?.data?.nonce === null) return result;

    const nonce = baseNonce + BigInt(index);
    const nextNonce = typeof firstNonce === "number" && nonce <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(nonce)
      : nonce.toString();

    return {
      ...result,
      data: {
        ...result.data,
        nonce: nextNonce,
      },
    };
  });
};

const lowNonceExpected = (value: unknown): number | null => {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const match = text.match(/low tx nonce\s*\(expected:\s*(\d+),\s*actual:\s*(\d+)\)/i);
  if (!match) return null;

  const nonce = Number(match[1]);
  return Number.isSafeInteger(nonce) ? nonce : null;
};

const retryNonceFromResults = (results: any): number | null => {
  if (!Array.isArray(results)) return null;

  const hasAcceptedResult = results.some((result) =>
    result?.status && result.status !== "Failure"
  );
  if (hasAcceptedResult) return null;

  for (const result of results) {
    const message = result?.txResult?.message || result?.error || result?.message || result;
    const nonce = lowNonceExpected(message);
    if (nonce !== null) return nonce;
  }
  return lowNonceExpected(results);
};

const requestConfigWithNonce = (
  config: AxiosRequestConfig | undefined,
  nonce: number
): AxiosRequestConfig | null => {
  if (!config) return null;

  let data: any;
  try {
    data = typeof config.data === "string" ? JSON.parse(config.data) : config.data;
  } catch {
    return null;
  }

  if (!data || typeof data !== "object") return null;

  const headers: Record<string, any> = { ...(config.headers as any) };
  Object.keys(headers).forEach((key) => {
    if (key.toLowerCase() === "content-length") {
      delete headers[key];
    }
  });

  return {
    ...config,
    headers,
    data: {
      ...data,
      txParams: {
        ...(data.txParams || {}),
        nonce,
      },
    },
  };
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const submitWithLowNonceRetry = async (
  stratoPostFn: () => Promise<any>,
  allowRetry: boolean
): Promise<any> => {
  const maxRetries = allowRetry ? 2 : 0;
  let retryConfig: AxiosRequestConfig | null = null;

  for (let attempt = 0; ; attempt++) {
    try {
      const response: any = retryConfig ? await axios.request(retryConfig) : await stratoPostFn();
      const retryNonce: number | null = attempt < maxRetries ? retryNonceFromResults(response.data) : null;
      const nextConfig: AxiosRequestConfig | null = retryNonce !== null
        ? requestConfigWithNonce(response.config, retryNonce)
        : null;

      if (nextConfig) {
        retryConfig = nextConfig;
        await wait(1000);
        continue;
      }

      return response;
    } catch (error: any) {
      const retryNonce = attempt < maxRetries
        ? lowNonceExpected(error?.response?.data ?? error?.message)
        : null;
      const nextConfig = retryNonce !== null
        ? requestConfigWithNonce(error?.response?.config || error?.config, retryNonce)
        : null;

      if (nextConfig) {
        retryConfig = nextConfig;
        await wait(1000);
        continue;
      }

      throw error;
    }
  }
};

const txQueues = new Map<string, Promise<void>>();

const withTxQueue = async <T>(key: string, action: () => Promise<T>): Promise<T> => {
  const previous = txQueues.get(key) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => current);
  txQueues.set(key, tail);

  await previous.catch(() => undefined);
  try {
    return await action();
  } finally {
    release();
    tail.finally(() => {
      if (txQueues.get(key) === tail) {
        txQueues.delete(key);
      }
    });
  }
};

const txQueueKey = (accessToken: string): string =>
  createHash("sha256").update(accessToken).digest("hex");

const postAndWaitForTxUnlocked = async (
  accessToken: string,
  stratoPostFn: () => Promise<any>,
  timeout: number = 60000
): Promise<{ status: string; hash: string }> => {
  try {
    const store = requestContext.getStore();
    const response = await submitWithLowNonceRetry(stratoPostFn, !store?.externalSigning);
    
    if (response.status !== 200) {
      throw new StratoError(`Strato error: ${response.statusText}`, 500);
    }

    const results = response.data;
    if (!Array.isArray(results) || !results.length) {
      throw new StratoError("Invalid or empty transaction results", 400);
    }

    if (store?.externalSigning && results[0]?.data !== undefined && results[0]?.status === undefined) {
      const unsignedTxs = withSequentialUnsignedNonces(results);
      store.unsignedTxs = unsignedTxs;
      return { status: "unsigned", hash: unsignedTxs[0].hash };
    }

    const txHashes = results.map(result => {
      if (!result?.hash) throw new StratoError("Invalid transaction result", 400);
      return result.hash;
    });

    const done = (results: any[]) => {
      const failedTx = results.find(r => r?.status === "Failure");
      if (failedTx) {
        // Extract the actual error message from the failed transaction
        const errorMessage = failedTx.txResult?.message || failedTx.error || failedTx.message || "Transaction failed";
        const extractedMessage = extractErrorMessage(errorMessage);
        // Blockchain errors are typically client errors (400) since they're due to user input/state
        throw new StratoError(extractedMessage, 400);
      }
      return results.every(r => r?.status !== "Pending");
    };

    const finalResults = done(results) ? results : await until(
      done,
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

export const postAndWaitForTx = async (
  accessToken: string,
  stratoPostFn: () => Promise<any>,
  timeout: number = 60000
): Promise<{ status: string; hash: string }> => {
  const store = requestContext.getStore();
  if (store?.externalSigning) {
    return postAndWaitForTxUnlocked(accessToken, stratoPostFn, timeout);
  }

  return withTxQueue(txQueueKey(accessToken), () =>
    postAndWaitForTxUnlocked(accessToken, stratoPostFn, timeout)
  );
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
