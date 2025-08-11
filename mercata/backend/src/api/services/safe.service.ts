import { Interface } from "ethers";

// Minimal ERC20 ABI
const ERC20_ABI = [
  "function transfer(address to, uint256 amount) public returns (bool)",
];

const showTestnet = process.env.SHOW_TESTNET === "true";

interface SafeTransactionState {
  safeTxHash?: string;
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

  // Validate required environment variables
  const safeAddress = process.env.SAFE_ADDRESS;

  if (!safeAddress) {
    throw new Error("SAFE_ADDRESS environment variable is required");
  }

  try {
    // Generate transaction data based on type
    let transactionData: any;

    if (type === "eth") {
      transactionData = {
        to: toAddress,
        value: amount.toString(), // already in wei
        data: "0x",
      };
    } else if (type === "erc20" && tokenAddress) {
      const iface = new Interface(ERC20_ABI);
      const data = iface.encodeFunctionData("transfer", [
        toAddress,
        amount.toString(), // in wei
      ]);

      transactionData = {
        to: tokenAddress,
        value: "0", // ETH value is 0 for ERC20 transfer
        data,
      };
    } else {
      throw new Error("Invalid transaction type or missing tokenAddress");
    }

    // Generate a mock transaction hash for now
    // In a real implementation, this would integrate with Safe Protocol
    const mockHash = `0x${Math.random().toString(16).substr(2, 64)}`;
    state.safeTxHash = mockHash;

    yield { step: "generate", hash: state.safeTxHash };

    // Mock successful transaction proposal
    // In a real implementation, this would propose to Safe Protocol
    console.log(`Transaction proposed to Safe ${safeAddress}:`, transactionData);

    yield { step: "propose", success: true };
  } catch (error) {
    console.error("Error in safeTransactionGenerator:", error);
    throw new Error(`Safe transaction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export default safeTransactionGenerator; 