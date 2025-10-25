import { config, ZERO_ADDRESS, TRANSFER_EVENT_SIGNATURE } from "../config";
import { 
  getTransactionReceiptsBatch, 
  getInternalTransactionsBatch 
} from "./rpcService";
import { normalizeAddress, safeToBigInt, ensureHexPrefix, convertToStratoDecimals, parseUint256, decodeTopicAddr, isOkStatus } from "../utils/utils";
import { DepositInfo } from "../types";

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

const validateDeposit = (deposit: DepositInfo, chainId: Number, safe: string) => {
  if (Number(deposit.externalChainId) !== chainId) {
    return new Error(`Chain mismatch for token ${normalizeAddress(deposit.externalToken)}. Expected: ${chainId}, Got: ${deposit.externalChainId}`);
  }

  const externalToken = normalizeAddress(ensureHexPrefix(deposit.externalToken));
  const depositRouter = normalizeAddress(deposit.depositRouter);
  
  return {
    safe,
    isETH: externalToken === ZERO_ADDRESS,
    externalToken,
    depositRouter,
    stratoTokenAmount: safeToBigInt(deposit.stratoTokenAmount),
    externalDecimals: deposit.externalDecimals
  };
};

const verifyEthDeposit = (receipt: any, traces: any[], ctx: any): Error | null => {
  const to = receipt.to ? normalizeAddress(receipt.to) : "";
  
  if (to !== ctx.depositRouter) {
    return new Error(`ETH receiver mismatch. Expected: ${ctx.depositRouter}, Got: ${to || "null"}`);
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
    if (!decoded || decoded.tokenAddr !== ctx.externalToken || decoded.toAddr !== ctx.safe) {
      return false;
    }
    
    const convertedAmount = convertToStratoDecimals(decoded.amount, ctx.externalDecimals)
    
    return convertedAmount === ctx.stratoTokenAmount;
  });
  
  if (!validTransfer) {
    return new Error(`No ERC20 Transfer to Safe ${ctx.safe} for token ${ctx.externalToken}`);
  }
  
  return null;
};

const fail = (txHash: string, msg: string): Error => new Error(`${msg} for ${txHash}`);

// Batched verification for multiple deposits
export const verifyDepositsBatch = async (deposits: DepositInfo[]): Promise<Map<string, Error | null>> => {
  const results = new Map<string, Error | null>();
  
  // Group deposits by chain for batch processing
  const depositsByChain = new Map<number, DepositInfo[]>();
  deposits.forEach(deposit => {
    const externalChainId = typeof deposit.externalChainId === "number" 
      ? deposit.externalChainId 
      : Number(deposit.externalChainId);
    
    if (!depositsByChain.has(externalChainId)) {
      depositsByChain.set(externalChainId, []);
    }
    depositsByChain.get(externalChainId)!.push(deposit);
  });

  // Normalize once, reuse everywhere
  const safe = normalizeAddress(config?.safe?.address ?? "");
  if (!safe) {
    const error = new Error("Gnosis Safe address not configured");
    deposits.forEach(d => results.set(d.externalTxHash, error));
    return results;
  }

  // Process each chain's deposits in batches
  for (const [chainId, chainDeposits] of depositsByChain) {
    // Dedupe txHashes
    const txHashes = [...new Set(chainDeposits.map(d => d.externalTxHash))];
    if (txHashes.length === 0) continue;
    
    // Batch fetch receipts and internal transactions
    const [receipts, internalTxsMap] = await Promise.all([
      getTransactionReceiptsBatch(chainId, txHashes),
      getInternalTransactionsBatch(chainId, txHashes)
    ]);

    // Verify each deposit using the batched data
    for (const deposit of chainDeposits) {
      try {
        const receipt = receipts.get(deposit.externalTxHash);
        if (!receipt) {
          results.set(deposit.externalTxHash, fail(deposit.externalTxHash, "No receipt found"));
          continue;
        }

        if (!isOkStatus(receipt)) {
          results.set(deposit.externalTxHash, fail(deposit.externalTxHash, "Deposit transaction failed"));
          continue;
        }

        // Early guard + context object
        const ctx = validateDeposit(deposit, chainId, safe);
        if (ctx instanceof Error) {
          results.set(deposit.externalTxHash, ctx);
          continue;
        }

        // Branch to appropriate verifier
        const error = ctx.isETH 
          ? verifyEthDeposit(receipt, internalTxsMap.get(deposit.externalTxHash) || [], ctx)
          : verifyErc20Deposit(receipt, ctx);

        results.set(deposit.externalTxHash, error);
      } catch (error) {
        results.set(deposit.externalTxHash, error as Error);
      }
    }
  }

  return results;
};