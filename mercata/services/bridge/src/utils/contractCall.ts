import { buildFunctionTx } from "./txBuilder";
import { postAndWaitForTx } from "./txHelper";
import { strato } from "./mercataApiHelper";

export const contractCall = async (
  contractName: string,
  contractAddress: string,
  method: string,
  args: any,
) => {
  const tx = buildFunctionTx({
    contractName,
    contractAddress,
    method,
    args,
  });

  return await postAndWaitForTx(() => 
    strato.post("/transaction/parallel?resolve=true", tx)
  );
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
