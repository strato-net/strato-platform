import SafeApiKit from "@safe-global/api-kit";
import Safe from "@safe-global/protocol-kit";
import { MetaTransactionData, OperationType } from "@safe-global/types-kit";
import { Interface, getAddress } from "ethers";
import { config, getChainRpcUrl, ZERO_ADDRESS, ERC20_ABI, STRATO_DECIMALS } from "../config";
import { getAssetInfo } from "./cirrusService";
import { convertFromStratoDecimals, convertDecimals, ensureHexPrefix, safeToBigInt } from "../utils/utils";
import {
  TxType,
  SafeTransactionState,
  WithdrawalTransaction,
  SafeTransactionResult,
} from "../types";

// Utility functions
const with0x = (a: string) => (a?.startsWith("0x") ? a : `0x${a}`);
const toChecksum = (a: string) => getAddress(ensureHexPrefix(a));

// Get external token address from cirrus service
async function getExternalTokenAddress(
  stratoToken: string,
  chainId: bigint,
): Promise<string | null> {
  if (!stratoToken) return null;

  const assetInfo = await getAssetInfo(stratoToken);
  if (!assetInfo) return null;

  const chainIdStr = chainId.toString();
  if (assetInfo.chainId !== chainIdStr || !assetInfo.enabled) return null;

  return with0x(assetInfo.extToken);
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
    throw new Error(
      "ERC20 transfer requested with ZERO_ADDRESS token; use 'eth' kind instead",
    );
  }

  const iface = new Interface(ERC20_ABI);
  return {
    to: toChecksum(token),
    value: "0",
    data: iface.encodeFunctionData("transfer", [
      toChecksum(params.to),
      params.amount,
    ]),
    operation: OperationType.Call,
  };
}

// Main functions
export const createSafeTransactionsForWithdrawals = async (
  withdrawals: any[],
): Promise<SafeTransactionResult[]> => {
  const safeTxs: SafeTransactionResult[] = [];

  for (const withdrawal of withdrawals) {
    const destChainId = safeToBigInt(withdrawal.destChainId);
    const stratoToken = withdrawal.token;
    const destAddress = withdrawal.dest || withdrawal.destAddress;

    const externalToken = await getExternalTokenAddress(
      stratoToken,
      destChainId,
    );
    const isEth = externalToken && externalToken.toLowerCase() === ZERO_ADDRESS;
    const txType: TxType = isEth ? "eth" : "erc20";
    const tokenToUse = isEth ? ZERO_ADDRESS : externalToken || stratoToken;

    // Get asset info for decimal conversion
    const assetInfo = await getAssetInfo(stratoToken);
    const extDecimals = assetInfo?.extDecimals
      ? parseInt(assetInfo.extDecimals)
      : STRATO_DECIMALS;

    // Convert amount from STRATO decimals to external token decimals
    // For ETH: keep as decimal string, for ERC20: convert to hex
    const convertedAmount = isEth 
      ? convertDecimals(withdrawal.amount.toString(), STRATO_DECIMALS, extDecimals).toString()
      : convertFromStratoDecimals(withdrawal.amount.toString(), extDecimals);

    const generator = safeTransactionGenerator(
      convertedAmount,
      destAddress,
      txType,
      tokenToUse,
      destChainId,
    );

    const hashResult = await generator.next();
    const successResult = await generator.next();

    if (hashResult.value?.hash && successResult.value?.success) {
      safeTxs.push({ safeTxHash: hashResult.value.hash, success: true });
    }
  }

  return safeTxs;
};

export const checkExecutedSafeTransactions = async (
  withdrawals: any[],
): Promise<WithdrawalTransaction[]> => {
  const results: WithdrawalTransaction[] = [];

  for (const withdrawal of withdrawals) {
    const hash = withdrawal.safeTxHash;
    if (!hash) {
      results.push({ hash: `missing_${withdrawal.id}`, success: false });
      continue;
    }

    const status = await monitorSafeTransactionStatus(
      hash,
      safeToBigInt(withdrawal.destChainId),
    );
    results.push({ hash, success: status === "executed" });
  }

  return results;
};

export const monitorSafeTransactionStatus = async (
  transactionKey: string,
  chainId: bigint,
): Promise<"executed" | "rejected" | "pending"> => {
  if (!transactionKey) return "pending";

  const safeTxHash = transactionKey.startsWith("0x")
    ? transactionKey
    : `0x${transactionKey}`;
  const apiKit = new SafeApiKit({ chainId });

  const tx = await apiKit.getTransaction(safeTxHash);
  if (tx.isExecuted) return "executed";

  try {
    const executed = await apiKit.getMultisigTransactions(tx.safe, {
      nonce: tx.nonce,
      executed: true,
    } as any);
    if (
      (executed as any)?.results?.some(
        (m: any) => m?.nonce === tx.nonce && m?.isExecuted,
      )
    ) {
      return "rejected";
    }
  } catch {
    return "pending";
  }

  return "pending";
};

// Safe transaction generator
async function* safeTransactionGenerator(
  amount: string,
  toAddress: string,
  type: TxType,
  tokenAddress: string,
  chainId: bigint,
): AsyncGenerator<{
  step: "generate" | "propose";
  hash?: string;
  success?: boolean;
}> {
  const state: SafeTransactionState = {};

  const rpcUrl = getChainRpcUrl(chainId);

  state.protocolKit = await Safe.init({
    provider: rpcUrl,
    signer: config.safe.safeOwnerPrivateKey || "",
    safeAddress: config.safe.address || "",
  });

  const signerAddress = config.safe.safeOwnerAddress || "";

  const kind: TxType =
    type === "eth" ||
    (tokenAddress && tokenAddress.toLowerCase() === ZERO_ADDRESS)
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

  state.safeTxHash =
    await state.protocolKit.getTransactionHash(safeTransaction);
  yield { step: "generate", hash: state.safeTxHash };

  state.apiKit = new SafeApiKit({ chainId });
  const signature = await state.protocolKit.signHash(state.safeTxHash);

  await state.apiKit.proposeTransaction({
    safeAddress: config.safe.address || "",
    safeTransactionData: safeTransaction.data,
    safeTxHash: state.safeTxHash,
    senderAddress: signerAddress,
    senderSignature: signature.data,
  });

  yield { step: "propose", success: true };
}

export default safeTransactionGenerator;
