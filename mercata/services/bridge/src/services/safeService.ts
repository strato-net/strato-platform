import SafeApiKit from "@safe-global/api-kit";
import Safe from "@safe-global/protocol-kit";
import { MetaTransactionData, OperationType } from "@safe-global/types-kit";
import { Interface, getAddress } from "ethers";
import { logError } from "../utils/logger";
import { config, getChainRpcUrl, ZERO_ADDRESS, ERC20_ABI } from "../config";
import { getAssetInfo } from "./cirrusService";
import { 
  TxType, 
  SafeTransactionState, 
  WithdrawalTransaction, 
  SafeTransactionResult 
} from "../types";

// Utility functions
const with0x = (a: string) => (a?.startsWith("0x") ? a : `0x${a}`);
const toChecksum = (a: string) => getAddress(with0x(a));

// Get external token address from cirrus service
async function getExternalTokenAddress(stratoToken: string, chainId: bigint): Promise<string | null> {
  if (!stratoToken) return null;
  
  try {
    const assetInfo = await getAssetInfo(stratoToken);
    if (!assetInfo) return null;
    
    // Check if this asset is enabled for the target chain
    const chainIdStr = chainId.toString();
    const chainMapping = assetInfo.chains?.[chainIdStr];
    if (!chainMapping?.enabled) return null;
    
    return with0x(chainMapping.extToken);
  } catch (error) {
    logError("SafeService", "Failed to get asset info", { 
      stratoToken, 
      chainId: chainId.toString(), 
      error: (error as Error).message 
    });
    return null;
  }
}

// Build Safe transaction data
function buildSafeTxData(params: {
  kind: "eth" | "erc20";
  to: string;
  amount: string;
  token?: string;
}): MetaTransactionData {
  if (params.kind === "eth") {
    return {
      to: toChecksum(params.to),
      value: params.amount,
      data: "0x",
      operation: OperationType.Call,
    };
  }
  
  const token = params.token!;
  if (token.toLowerCase() === ZERO_ADDRESS) {
    throw new Error("ERC20 transfer requested with ZERO_ADDRESS token; use 'eth' kind instead");
  }
  
  const iface = new Interface(ERC20_ABI);
  return {
    to: toChecksum(token),
    value: "0",
    data: iface.encodeFunctionData("transfer", [toChecksum(params.to), params.amount]),
    operation: OperationType.Call,
  };
}

// Main functions
export const createSafeTransactionsForWithdrawals = async (withdrawals: any[]): Promise<SafeTransactionResult[]> => {
  try {
    const safeTxs: SafeTransactionResult[] = [];

    // Process each withdrawal individually to handle multiple recipients properly
    for (const withdrawal of withdrawals) {
      try {
        const destChainId = BigInt(withdrawal.destChainId);
        const stratoToken = withdrawal.token;
        const destAddress = withdrawal.dest || withdrawal.destAddress;

        const externalToken = await getExternalTokenAddress(stratoToken, destChainId);
        const isEth = externalToken && externalToken.toLowerCase() === ZERO_ADDRESS;
        const txType: TxType = isEth ? "eth" : "erc20";
        const tokenToUse = isEth ? ZERO_ADDRESS : (externalToken || stratoToken);

        const generator = safeTransactionGenerator(
          withdrawal.amount.toString(),
          destAddress,
          txType,
          tokenToUse,
          destChainId
        );

        const hashResult = await generator.next();
        const successResult = await generator.next();

        if (hashResult.value?.hash && successResult.value?.success) {
          safeTxs.push({ safeTxHash: hashResult.value.hash, success: true });
        } else {
          logError("SafeService", "Safe tx creation returned no hash/success", { id: withdrawal.id });
        }
      } catch (error) {
        logError("SafeService", "Safe tx creation failed", {
          id: withdrawal.id,
          error: (error as Error).message,
        });
        continue;
      }
    }

    return safeTxs;
  } catch (error) {
    logError('SafeService', 'Failed to create Safe transactions', {
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
};

export const checkExecutedSafeTransactions = async (withdrawals: any[]): Promise<WithdrawalTransaction[]> => {
  try {
    const results: WithdrawalTransaction[] = [];
    
    for (const withdrawal of withdrawals) {
      try {
        const hash = withdrawal.safeTxHash;
        if (!hash) {
          results.push({ hash: `missing_${withdrawal.id}`, success: false });
          continue;
        }
        
        const status = await monitorSafeTransactionStatus(hash, BigInt(withdrawal.destChainId));
        results.push({ hash, success: status === "executed" });
      } catch (error) {
        results.push({ hash: withdrawal.safeTxHash || `error_${withdrawal.id}`, success: false });
      }
    }
    
    return results;
  } catch (error) {
    logError('SafeService', 'Failed to check executed Safe transactions', {
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
};

export const monitorSafeTransactionStatus = async (
  transactionKey: string, 
  chainId: bigint
): Promise<'executed' | 'rejected' | 'pending'> => {
  try {
    if (!transactionKey) return "pending";
    
    const txHash = transactionKey.startsWith("0x") ? transactionKey : `0x${transactionKey}`;
    const apiKit = new SafeApiKit({ chainId });
    const tx = await apiKit.getTransaction(txHash);
    
    if (tx.isExecuted) return "executed";
    if (tx.executionDate || (tx as any).rejectReason) return "rejected";
    return "pending";
  } catch (error) {
    logError("SafeService", `Failed to monitor transaction status: ${transactionKey}`, {
      chainId: chainId.toString(),
      error: (error as Error).message,
    });
    return "pending";
  }
};

// Safe transaction generator
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

  try {
    // Use the single Safe address for all chains
    const safeAddress = config.safe.address;
    if (!safeAddress) {
      throw new Error(`No Safe address configured`);
    }

    const rpcUrl = getChainRpcUrl(chainId);
    
    state.protocolKit = await Safe.init({
      provider: rpcUrl,
      signer: config.safe.safeOwnerPrivateKey || "",
      safeAddress: safeAddress,
    });

    const signerAddress = config.safe.safeOwnerAddress || "";

    const kind: TxType = (type === "eth" || (tokenAddress && tokenAddress.toLowerCase() === ZERO_ADDRESS)) 
      ? "eth" 
      : "erc20";
      
    const safeTransactionData = buildSafeTxData({
      kind,
      to: toAddress,
      amount,
      token: kind === "erc20" ? tokenAddress : undefined,
    });

    const nonce = await state.protocolKit.getNonce();
    const safeTransaction = await state.protocolKit.createTransaction({
      transactions: [safeTransactionData],
      options: { nonce },
    });

    state.safeTxHash = await state.protocolKit.getTransactionHash(safeTransaction);
    yield { step: "generate", hash: state.safeTxHash };

    state.apiKit = new SafeApiKit({ chainId });
    const signature = await state.protocolKit.signHash(state.safeTxHash);

    try {
      await state.apiKit.proposeTransaction({
        safeAddress: safeAddress,
        safeTransactionData: safeTransaction.data,
        safeTxHash: state.safeTxHash,
        senderAddress: signerAddress,
        senderSignature: signature.data,
      });
    } catch (apiError: any) {
      const msg = apiError?.response?.data || apiError?.message || "Safe API error";
      logError("SafeService", "Safe propose failed", { 
        msg, 
        safeTxHash: state.safeTxHash, 
        nonce 
      });
      throw apiError;
    }

    yield { step: "propose", success: true };
  } catch (error) {
    logError('SafeService', `Error in safeTransactionGenerator`, {
      amount,
      toAddress,
      type,
      tokenAddress,
      chainId: chainId.toString(),
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    throw error;
  }
}

export default safeTransactionGenerator;
