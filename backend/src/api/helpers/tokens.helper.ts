import { postAndWaitForTx } from "../../utils/txHelper";
import { StratoPaths } from "../../config/constants";
import { strato } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";

/**
 * Approves a given ERC20 token for a spender and waits for the transaction to succeed.
 */
export const approveAsset = async (
  accessToken: string,
  tokenAddress: string,
  spender: string,
  value: string
): Promise<{ status: string; hash: string }> => {
  // build the approval transaction
  const tx = buildFunctionTx({
    contractName: "ERC20",
    contractAddress: tokenAddress,
    method: "approve",
    args: { spender, value },
  });
  // post and wait for the transaction
  const { status, hash } = await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, tx)
  );
  if (status !== "Success") {
    throw new Error(`Error approving asset with hash: ${hash}`);
  }
  return { status, hash };
};
