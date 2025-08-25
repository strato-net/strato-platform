import { config, ZERO_ADDRESS, TRANSFER_EVENT_SIGNATURE } from "../config";
import { 
  getTransactionReceiptsBatch, 
  getInternalTransactionsBatch 
} from "./rpcService";
import { normalizeAddress, safeToBigInt, ensureHexPrefix, convertToStratoDecimals, parseUint256, decodeTopicAddr, isOkStatus } from "../utils/utils";
import { Deposit } from "../types";

const decodeTransferLog = (log: any, sig: string) => {
  if (!log?.topics || log.topics.length < 3) return null;
  if (typeof log.topics[0] !== "string" || log.topics[0].toLowerCase() !== sig) return null;
  
  return {
    tokenAddr: normalizeAddress(log.address),
    toAddr: decodeTopicAddr(log.topics[2]),
    amount: parseUint256(log.data ?? "0x")
  };
};

const findInternalEthTransfer = (traces: any[], toAddr: string, expectedAmount: bigint): boolean => 
  traces.some((trace: any) => {
    if (trace.type === 'call' && trace.action?.to) {
      const traceTo = normalizeAddress(trace.action.to);
      const traceValue = safeToBigInt(trace.action.value || '0');
      return traceTo === toAddr && traceValue === expectedAmount;
    }
    return false;
  });

const validateDeposit = (deposit: Deposit, chainId: number, safe: string) => {
  if (deposit.chainId !== chainId.toString()) {
    return new Error(`Chain mismatch for token ${normalizeAddress(deposit.token)}. Expected: ${chainId}, Got: ${deposit.chainId}`);
  }

  const extTokenNorm = normalizeAddress(ensureHexPrefix(deposit.extToken));
  const routerNorm = normalizeAddress(deposit.depositRouter);
  
  return {
    safe,
    isETH: extTokenNorm === ZERO_ADDRESS,
    expectedAmount: safeToBigInt(deposit.amount),
    extTokenNorm,
    routerNorm,
    extDecimals: deposit.extDecimals
  };
};

const verifyEthDeposit = (receipt: any, traces: any[], ctx: any): Error | null => {
  const to = receipt.to ? normalizeAddress(receipt.to) : "";
  
  if (to !== ctx.routerNorm) {
    return new Error(`ETH receiver mismatch. Expected: ${ctx.routerNorm}, Got: ${to || "null"}`);
  }
  
  if (!findInternalEthTransfer(traces, ctx.safe, ctx.expectedAmount)) {
    return new Error(`No internal ETH transfer to Safe ${ctx.safe} found`);
  }
  
  return null;
};

const verifyErc20Deposit = (receipt: any, ctx: any): Error | null => {
  const sig = TRANSFER_EVENT_SIGNATURE.toLowerCase();
  const logs = Array.isArray(receipt.logs) ? receipt.logs : [];
  
  const validTransfer = logs.some(log => {
    const decoded = decodeTransferLog(log, sig);
    if (!decoded || decoded.tokenAddr !== ctx.extTokenNorm || decoded.toAddr !== ctx.safe) {
      return false;
    }
    
    const convertedAmount = ctx.extDecimals 
      ? convertToStratoDecimals(decoded.amount, ctx.extDecimals)
      : ctx.expectedAmount.toString();
    
    return convertedAmount === ctx.expectedAmount.toString();
  });
  
  if (!validTransfer) {
    return new Error(`No ERC20 Transfer to Safe ${ctx.safe} for token ${ctx.extTokenNorm}`);
  }
  
  return null;
};

const fail = (txHash: string, msg: string): Error => new Error(`${msg} for ${txHash}`);

// Batched verification for multiple deposits
export const verifyDepositsBatch = async (deposits: Deposit[]): Promise<Map<string, Error | null>> => {
  const results = new Map<string, Error | null>();
  
  // Group deposits by chain for batch processing
  const depositsByChain = new Map<number, Deposit[]>();
  deposits.forEach(deposit => {
    const chainId = typeof deposit.srcChainId === "number" 
      ? deposit.srcChainId 
      : Number(deposit.srcChainId);
    
    if (!depositsByChain.has(chainId)) {
      depositsByChain.set(chainId, []);
    }
    depositsByChain.get(chainId)!.push(deposit);
  });

  // Normalize once, reuse everywhere
  const safe = normalizeAddress(config?.safe?.address ?? "");
  if (!safe) {
    const error = new Error("Gnosis Safe address not configured");
    deposits.forEach(d => results.set(d.srcTxHash, error));
    return results;
  }

  // Process each chain's deposits in batches
  for (const [chainId, chainDeposits] of depositsByChain) {
    // Dedupe txHashes
    const txHashes = [...new Set(chainDeposits.map(d => d.srcTxHash))];
    if (txHashes.length === 0) continue;
    
    // Batch fetch receipts and internal transactions
    const [receipts, internalTxsMap] = await Promise.all([
      getTransactionReceiptsBatch(chainId, txHashes),
      getInternalTransactionsBatch(chainId, txHashes)
    ]);

    // Verify each deposit using the batched data
    for (const deposit of chainDeposits) {
      try {
        const receipt = receipts.get(deposit.srcTxHash);
        if (!receipt) {
          results.set(deposit.srcTxHash, fail(deposit.srcTxHash, "No receipt found"));
          continue;
        }

        if (!isOkStatus(receipt)) {
          results.set(deposit.srcTxHash, fail(deposit.srcTxHash, "Deposit transaction failed"));
          continue;
        }

        // Early guard + context object
        const ctx = validateDeposit(deposit, chainId, safe);
        if (ctx instanceof Error) {
          results.set(deposit.srcTxHash, ctx);
          continue;
        }

        // Branch to appropriate verifier
        const error = ctx.isETH 
          ? verifyEthDeposit(receipt, internalTxsMap.get(deposit.srcTxHash) || [], ctx)
          : verifyErc20Deposit(receipt, ctx);

        results.set(deposit.srcTxHash, error);
      } catch (error) {
        results.set(deposit.srcTxHash, error as Error);
      }
    }
  }

  return results;
};