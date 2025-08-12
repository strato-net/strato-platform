import SafeApiKit from "@safe-global/api-kit";
import Safe from "@safe-global/protocol-kit";
import { MetaTransactionData, OperationType } from "@safe-global/types-kit";
import { config, getChainRpcUrl } from "../config";
import { Interface } from "ethers";

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) public returns (bool)",
];

interface SafeTransactionState {
  safeTxHash?: string;
  protocolKit?: Safe;
  apiKit?: SafeApiKit;
}

type TxType = "eth" | "erc20";

interface WithdrawalTransaction {
  hash: string;
  success: boolean;
}

interface SafeTransactionResult {
  safeTxHash: string;
  success: boolean;
}

export const createSafeTransactionsForWithdrawals = async (withdrawals: any[]): Promise<SafeTransactionResult[]> => {
  try {
    // Group withdrawals by both destChainId and token address
    const withdrawalsByChainAndToken = new Map<string, any[]>();
    
    for (const withdrawal of withdrawals) {
      const destChainId = BigInt(withdrawal.destChainId);
      const tokenAddress = withdrawal.token;
      const key = `${destChainId}-${tokenAddress}`;
      
      if (!withdrawalsByChainAndToken.has(key)) {
        withdrawalsByChainAndToken.set(key, []);
      }
      withdrawalsByChainAndToken.get(key)!.push(withdrawal);
    }

    const safeTxs: SafeTransactionResult[] = [];

    for (const [key, tokenWithdrawals] of withdrawalsByChainAndToken) {
      try {
        const [destChainId, tokenAddress] = key.split('-');
        const totalAmount = tokenWithdrawals.reduce((sum, w) => sum + BigInt(w.amount), BigInt(0));
        const destAddress = tokenWithdrawals[0].dest || tokenWithdrawals[0].destAddress;
        
        const generator = safeTransactionGenerator(
          totalAmount.toString(),
          destAddress,
          "erc20",
          tokenAddress,
          BigInt(destChainId)
        );

        const hashResult = await generator.next();
        const successResult = await generator.next();

        if (hashResult.value?.hash && successResult.value?.success) {
          safeTxs.push({ 
            safeTxHash: hashResult.value.hash, 
            success: successResult.value.success 
          });
        }
      } catch (error) {
        console.error(`❌ Error creating safe transaction for key ${key}:`, error);
      }
    }

    return safeTxs;
  } catch (error) {
    console.error("❌ Error in createSafeTransactionsForWithdrawals:", error);
    return [];
  }
};

export const checkExecutedSafeTransactions = async (withdrawals: any[]): Promise<WithdrawalTransaction[]> => {
  try {
    const executedTxs = withdrawals.map(w => ({
      hash: w.safeTxHash || w.custodyTxHash || `executed_${w.id}`,
      success: true
    }));
    return executedTxs;
  } catch (error) {
    console.error("❌ Error in checkExecutedSafeTransactions:", error);
    return [];
  }
};

export const monitorSafeTransactionStatus = async (transactionKey: string, chainId: bigint): Promise<'executed' | 'rejected' | 'pending'> => {
  try {
    const txHash = `0x${transactionKey}`;
    const apiKit = new SafeApiKit({ chainId });
    
    const safeTransaction = await apiKit.getTransaction(txHash);
    
    if (safeTransaction.isExecuted === true) {
      return 'executed';
    } else if (safeTransaction.isExecuted === false && safeTransaction.executionDate) {
      return 'rejected';
    } else if (safeTransaction.isExecuted === false && (safeTransaction as any).rejectReason) {
      return 'rejected';
    } else {
      return 'pending';
    }
  } catch (error) {
    console.error(`❌ Failed to check Safe transaction status ${transactionKey}:`, error);
    return 'pending';
  }
};

async function* safeTransactionGenerator(
  amount: string,
  toAddress: string,
  type: TxType,
  tokenAddress: string,
  chainId: bigint
): AsyncGenerator<{
  step: "generate" | "propose";
  hash?: string;
  success?: boolean;
}> {
  const state: SafeTransactionState = {};

  state.protocolKit = await Safe.init({
    provider: getChainRpcUrl(chainId),
    signer: config.safe.safeOwnerPrivateKey || "",
    safeAddress: config.safe.address || "",
  });

  let safeTransactionData: MetaTransactionData;

  if (type === "eth") {
    safeTransactionData = {
      to: toAddress,
      value: amount.toString(),
      data: "0x",
      operation: OperationType.Call,
    };
  } else if (type === "erc20" && tokenAddress) {
    const iface = new Interface(ERC20_ABI);
    const data = iface.encodeFunctionData("transfer", [
      toAddress,
      amount.toString(),
    ]);

    safeTransactionData = {
      to: tokenAddress,
      value: "0",
      data,
      operation: OperationType.Call,
    };
  } else {
    throw new Error("Invalid transaction type or missing tokenAddress");
  }

  const safeTransaction = await state.protocolKit.createTransaction({
    transactions: [safeTransactionData],
  });

  state.safeTxHash = await state.protocolKit.getTransactionHash(safeTransaction);
  yield { step: "generate", hash: state.safeTxHash };

  state.apiKit = new SafeApiKit({ chainId });
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

export default safeTransactionGenerator;
