import axios from "axios";
import { getBAUserToken } from "../auth";

export const contractCall = async (
  contractName: string,
  contractAddress: string,
  method: string,
  args: any,
) => {
  const accessToken = await getBAUserToken();

  const txPayload = {
    txs: [
      {
        payload: {
          contractName,
          contractAddress,
          method,
          args,
        },
        type: "FUNCTION",
      },
    ],
    txParams: {
      gasLimit: 150000,
      gasPrice: 30000000000,
    },
  };

  const response = await axios.post(
    `${process.env.NODE_URL}/strato/v2.3/transaction/parallel?resolve=true`,
    txPayload,
    {
      headers: {
        accept: "application/json;charset=utf-8",
        "content-type": "application/json;charset=utf-8",
        authorization: `Bearer ${accessToken}`,
      },
      timeout: 30000,
      maxContentLength: 50 * 1024 * 1024,
      maxBodyLength: 50 * 1024 * 1024,
    }
  );

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


  // Check if the transaction is already complete from the initial response
  if (result.status && result.status !== "Pending") {
    console.log("Transaction already complete, returning result directly");
    return result;
  }

  const txHash = result.hash;

  const predicate = (results: any[]) =>
    results.every((r) => r.status !== "Pending");

  const action = async () => {
    const res = await axios.post(`${process.env.NODE_URL}/bloc/v2.2/transactions/results`, [txHash], {
      headers: {
        accept: "application/json;charset=utf-8",
        "content-type": "application/json;charset=utf-8",
        authorization: `Bearer ${accessToken}`,
      },
    });

    console.log("🚀 res", res.data);
        
    return res.data;
  };

  const finalResult = await until(predicate, action);

  return finalResult[0];
};

export const until = async (
  predicate: (res: any) => boolean,
  action: () => Promise<any>,
  timeout = 60000, // default to 1 minute
  interval = 5000 // check every 5 seconds
): Promise<any> => {
  const start = Date.now();

  // Make initial call to get current status
  let result = await action();
  
  // If predicate is already satisfied, return immediately
  if (predicate(result)) {
    return result;
  }

  while (true) {
    // Check if we've exceeded the timeout
    if (Date.now() - start >= timeout) {
      console.warn("Timeout reached before predicate was satisfied.");
      return result;
    }

    // Wait before next check
    await new Promise((res) => setTimeout(res, interval));

    // Only call action if status is still Pending
    // Check if any result still has "Pending" status
    const hasPendingStatus = result.some((r: any) => r.status === "Pending");
    
    if (hasPendingStatus) {
      result = await action();
    }

    // Check if predicate is satisfied (no more Pending status)
    if (predicate(result)) {
      return result;
    }
  }
};
