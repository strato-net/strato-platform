import SafeApiKit from "@safe-global/api-kit";
import Safe from "@safe-global/protocol-kit";
import { MetaTransactionData, OperationType } from "@safe-global/types-kit";
import { config } from "../config";

interface SafeTransactionState {
  safeTxHash?: string;
  protocolKit?: Safe;
  apiKit?: SafeApiKit;
}

async function* safeTransactionGenerator(
  amount: string,
  toAddress: string
): AsyncGenerator<{
  step: "generate" | "propose";
  hash?: string;
  success?: boolean;
}> {
  const state: SafeTransactionState = {};

  // Initialize Safe protocol kit
  state.protocolKit = await Safe.init({
    provider: config.ethereum.rpcUrl || "",
    signer: config.safe.safeOwnerPrivateKey || "",
    safeAddress: config.safe.address || "",
  });

  // Step 1: Generate transaction hash
  // already converted to wei in backend service
  // const valueInWei = ethers.parseEther(amount);
  const safeTransactionData: MetaTransactionData = {
    to: toAddress,
    value: amount.toString(),
    data: "0x",
    operation: OperationType.Call,
  };

  const safeTransaction = await state.protocolKit.createTransaction({
    transactions: [safeTransactionData],
  });

  state.safeTxHash = await state.protocolKit.getTransactionHash(
    safeTransaction
  );

  yield { step: "generate", hash: state.safeTxHash };

  // Step 2: Propose transaction
  state.apiKit = new SafeApiKit({
    chainId: 11155111n,
  });

  const signature = await state.protocolKit.signHash(state.safeTxHash);

  await state.apiKit.proposeTransaction({
    safeAddress: config.safe.address || "",
    safeTransactionData: safeTransaction.data,
    safeTxHash: state.safeTxHash,
    senderAddress: config.safe.safeOwnerAddress || "",
    senderSignature: signature.data,
  });

  yield { step: "propose", success: true };
}

export const checkEthTransaction = async (transactionHash: string) => {
  const apiKit = new SafeApiKit({
    chainId: 11155111n,
  });

  // check transaction in every 5 seconds 5 times return when found else return null
  for (let i = 0; i < 5; i++) {
    const allTxs: any = await apiKit.getAllTransactions(
      config.safe.address || "",
      { limit: 100 }
    );
    const transaction = allTxs.results.find(
      (safeTx: any) => transactionHash === safeTx.transactionHash
    );
    if (transaction) {
      return transaction;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  return null;
};

// Example usage:
/*
const generator = safeTransactionGenerator(amount, tokenAddress, userAddress);

// First call - generate hash
const { hash } = await generator.next();
console.log('Generated hash:', hash);

// Second call - propose transaction
const { success } = await generator.next();
console.log('Transaction proposed:', success);
*/

export default safeTransactionGenerator;
