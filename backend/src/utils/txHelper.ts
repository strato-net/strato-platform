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

  if (!response.data || !Array.isArray(response.data)) {
    throw new Error("Strato response data is empty or invalid");
  }

  const result = response.data[0];
  if (!result || !result.hash) {
    throw new Error("Missing transaction result or hash");
  }

  const txHash = result.hash;

  const predicate = (results: any[]) =>
    results.every((r) => r.status !== "Pending");

  const action = async () => {
    const res = await bloc.post(accessToken, StratoPaths.result, [txHash]);
    return res.data;
  };

  const finalResult = await until(predicate, action, timeout);

  const statusInfo = finalResult[0];

  return {
    status: statusInfo.status,
    hash: statusInfo.hash,
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
