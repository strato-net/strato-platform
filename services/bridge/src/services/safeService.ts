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



import SafeApiKit from "@safe-global/api-kit";
import Safe from "@safe-global/protocol-kit";
import { MetaTransactionData, OperationType } from "@safe-global/types-kit";
import { config } from "../config";
import { Interface } from "ethers";

// Minimal ERC20 ABI
const ERC20_ABI = [
  "function transfer(address to, uint256 amount) public returns (bool)",
];

interface SafeTransactionState {
  safeTxHash?: string;
  protocolKit?: Safe;
  apiKit?: SafeApiKit;
}

type TxType = "eth" | "erc20";

async function* safeTransactionGenerator(
  amount: string,
  toAddress: string,
  type: TxType,
  tokenAddress?: string // required for erc20
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

  // Generate transaction data based on type
  let safeTransactionData: MetaTransactionData;

  if (type === "eth") {
    console.log("eth transfer called. in safe service....", amount, toAddress);
    safeTransactionData = {
      to: toAddress,
      value: amount.toString(), // already in wei
      data: "0x",
      operation: OperationType.Call,
    };
  } else if (type === "erc20" && tokenAddress) {
    const iface = new Interface(ERC20_ABI);
    const data = iface.encodeFunctionData("transfer", [
      toAddress,
      amount.toString(), // in wei
    ]);

    safeTransactionData = {
      to: tokenAddress,
      value: "0", // ETH value is 0 for ERC20 transfer
      data,
      operation: OperationType.Call,
    };
  } else {
    throw new Error("Invalid transaction type or missing tokenAddress");
  }

  const safeTransaction = await state.protocolKit.createTransaction({
    transactions: [safeTransactionData],
  });

  state.safeTxHash = await state.protocolKit.getTransactionHash(
    safeTransaction
  );

  yield { step: "generate", hash: state.safeTxHash };

  // Propose transaction
  state.apiKit = new SafeApiKit({ chainId: 11155111n });

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
  console.log("checkEthTransaction  bridgeOut flow called.....", transactionHash);
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


// For ETH Transfer:
// const gen = safeTransactionGenerator("100000000000000000", "0xRecipient", "eth");

// For ERC20 Transfer:
// const gen = safeTransactionGenerator(
//   "1000000000000000000", // 1 token with 18 decimals
//   "0xRecipient",
//   "erc20",
//   "0xTokenAddress"
// );

export default safeTransactionGenerator;
