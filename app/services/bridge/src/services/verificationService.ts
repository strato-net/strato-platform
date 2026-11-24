import { config, DEPOSIT_EVENT_SIGNATURES, ZERO_ADDRESS, TRANSFER_EVENT_SIGNATURE, WAD } from "../config";
import { 
  getTransactionReceiptsBatch, 
  getInternalTransactionsBatch 
} from "./rpcService";
import { getRebaseFactors } from "./cirrusService";
import { normalizeAddress, safeToBigInt, ensureHexPrefix, convertToStratoDecimals, parseUint256, decodeTopicAddr, isOkStatus } from "../utils/utils";
import { logInfo } from "../utils/logger";
import { DepositInfo } from "../types";
import { depositKeyId, depositKeyTxHash, parseDepositLog, RawDepositLog } from "./depositEventService";

const DEPOSIT_EVENT_TOPICS = new Set(DEPOSIT_EVENT_SIGNATURES.map((sig) => sig.toLowerCase()));

interface ValidEthTransfer {
  index: number;
  from: string;
  to: string;
  value: bigint;
}

interface TxAttributionState {
  usedRouterEventIndices: Set<number>;
  usedEthTraceIndices: Set<number>;
}

const decodeTransferLog = (log: any, sig: string) => {
  if (!log?.topics || log.topics.length < 3) return null;
  if (typeof log.topics[0] !== "string" || log.topics[0].toLowerCase() !== sig) return null;
  
  return {
    tokenAddr: normalizeAddress(log.address),
    toAddr: decodeTopicAddr(log.topics[2]),
    amount: parseUint256(log.data ?? "0x")
  };
};

const hasErroredAncestor = (traceAddress: unknown, failedPaths: Set<string>): boolean => {
  if (!Array.isArray(traceAddress)) return false;
  for (let i = 0; i < traceAddress.length; i++) {
    if (failedPaths.has(traceAddress.slice(0, i).join("."))) return true;
  }
  return false;
};

const findValidEthTransfersToSafe = (traces: any[], safeAddr: string): ValidEthTransfer[] => {
  const failedPaths = new Set(
    traces
      .filter((trace) => Boolean(trace?.error) && Array.isArray(trace?.traceAddress))
      .map((trace) => trace.traceAddress.join(".")),
  );

  const valid: ValidEthTransfer[] = [];
  traces.forEach((trace, index) => {
    if (trace?.type !== "call" || trace?.error) return;
    if (hasErroredAncestor(trace.traceAddress, failedPaths)) return;

    const callType = typeof trace.action?.callType === "string"
      ? trace.action.callType.toLowerCase()
      : "";
    if (callType !== "call" || !trace.action?.to) return;

    const from = trace.action.from ? normalizeAddress(trace.action.from) : "";
    const to = normalizeAddress(trace.action.to);
    if (to !== safeAddr || from === safeAddr) return;

    const value = safeToBigInt(trace.action.value || "0");
    if (value <= 0n) return;

    valid.push({
      index,
      from,
      to,
      value,
    });
  });

  return valid;
};

const extractRouterDepositEvents = (
  receipt: any,
  depositRouter: string,
  chainId: number,
  sourceTxHash: string,
) => {
  const logs = Array.isArray(receipt.logs) ? receipt.logs : [];
  const expectedTxHash = ensureHexPrefix(sourceTxHash).toLowerCase();
  const parsed: ReturnType<typeof parseDepositLog>[] = [];

  for (const log of logs) {
    if (!log?.address || normalizeAddress(log.address) !== depositRouter) continue;
    const topic0 = typeof log.topics?.[0] === "string" ? log.topics[0].toLowerCase() : "";
    if (!DEPOSIT_EVENT_TOPICS.has(topic0)) continue;
    if (log.transactionHash && ensureHexPrefix(log.transactionHash).toLowerCase() !== expectedTxHash) {
      continue;
    }
    parsed.push(
      parseDepositLog(
        {
          ...log,
          transactionHash: log.transactionHash ?? receipt.transactionHash ?? expectedTxHash,
        } as RawDepositLog,
        chainId,
      ),
    );
  }

  return parsed;
};

const expectedStratoAmount = (externalAmount: bigint, ctx: any): bigint => {
  const convertedAmount = convertToStratoDecimals(externalAmount, ctx.externalDecimals);
  if (ctx.rebaseFactor && ctx.rebaseFactor > 0n) {
    const rebasedAmount = (convertedAmount * WAD) / ctx.rebaseFactor;
    // Truncate to external token decimal precision to match oracle's integer truncation
    const precision = 10n ** BigInt(18 - ctx.externalDecimals);
    return (rebasedAmount / precision) * precision;
  }
  return convertedAmount;
};

const validateDeposit = (deposit: DepositInfo, chainId: Number, safe: string, rebaseFactor?: bigint) => {
  if (Number(deposit.externalChainId) !== chainId) {
    return new Error(`Chain mismatch for token ${normalizeAddress(deposit.externalToken)}. Expected: ${chainId}, Got: ${deposit.externalChainId}`);
  }

  const externalToken = normalizeAddress(ensureHexPrefix(deposit.externalToken));
  const depositRouter = normalizeAddress(ensureHexPrefix(deposit.depositRouter));
  const externalSender = normalizeAddress(ensureHexPrefix(deposit.externalSender));
  const stratoRecipient = normalizeAddress(ensureHexPrefix(deposit.stratoRecipient));
  const stratoToken = normalizeAddress(ensureHexPrefix(deposit.stratoToken));
  const depositId = depositKeyId(deposit.externalTxHash);
  
  return {
    safe,
    isETH: externalToken === ZERO_ADDRESS,
    externalToken,
    depositRouter,
    externalSender,
    stratoRecipient,
    stratoToken,
    depositId,
    stratoTokenAmount: safeToBigInt(deposit.stratoTokenAmount),
    externalDecimals: deposit.externalDecimals,
    rebaseFactor,
  };
};

const verifyEthDeposit = (
  receipt: any,
  traces: any[],
  ctx: any,
  chainId: number,
  sourceTxHash: string,
  attribution: TxAttributionState,
): Error | null => {
  if (ctx.stratoTokenAmount <= 0n) {
    return new Error(`Invalid ETH deposit amount ${ctx.stratoTokenAmount}`);
  }

  const routerEvents = extractRouterDepositEvents(receipt, ctx.depositRouter, chainId, sourceTxHash);
  const validTransfers = findValidEthTransfersToSafe(traces, ctx.safe);

  // Routed ETH deposit: match the configured router's event and consume a corresponding router-to-custody payment
  if (routerEvents.length > 0 || ctx.depositId !== undefined) {
    if (routerEvents.length === 0) {
      return new Error(`No DepositRouter event found for router ${ctx.depositRouter}`);
    }
    if (ctx.depositId === undefined && routerEvents.length > 1) {
      return new Error(`Ambiguous multi-deposit transaction without #<depositId> suffix`);
    }

    const eventIndex = routerEvents.findIndex((event, idx) => {
      if (attribution.usedRouterEventIndices.has(idx)) return false;
      if (ctx.depositId !== undefined && event.depositId !== ctx.depositId) return false;
      if (event.externalToken !== ctx.externalToken) return false;
      if (event.externalSender !== ctx.externalSender) return false;
      if (event.stratoRecipient !== ctx.stratoRecipient) return false;
      if (event.targetStratoToken !== ctx.stratoToken) return false;
      return expectedStratoAmount(safeToBigInt(event.externalTokenAmount), ctx) === ctx.stratoTokenAmount;
    });

    if (eventIndex === -1) {
      return new Error(
        `No matching DepositRouter event from ${ctx.depositRouter} for deposit ${ctx.depositId ?? sourceTxHash}`,
      );
    }

    const expectedWei = safeToBigInt(routerEvents[eventIndex].externalTokenAmount);
    const ethRouterEventCountForAmount = routerEvents.filter(
      (event) =>
        event.externalToken === ZERO_ADDRESS &&
        safeToBigInt(event.externalTokenAmount) === expectedWei,
    ).length;
    const routerTransfersForAmount = validTransfers.filter(
      (transfer) => transfer.from === ctx.depositRouter && transfer.value === expectedWei,
    );
    if (routerTransfersForAmount.length < ethRouterEventCountForAmount) {
      return new Error(
        `Insufficient ETH transfers from DepositRouter ${ctx.depositRouter} to Safe ${ctx.safe} for amount ${expectedWei}`,
      );
    }

    const transfer = routerTransfersForAmount.find(
      (candidate) => !attribution.usedEthTraceIndices.has(candidate.index),
    );
    if (!transfer) {
      return new Error(
        `No unallocated ETH transfer from DepositRouter ${ctx.depositRouter} to Safe ${ctx.safe} found`,
      );
    }

    attribution.usedRouterEventIndices.add(eventIndex);
    attribution.usedEthTraceIndices.add(transfer.index);
    return null;
  }

  // ETH sent straight to custody carries no router event, so nothing binds it to a recipient
  return new Error(`ETH deposit has no DepositRouter event from ${ctx.depositRouter}`);
};

const verifyErc20Deposit = (receipt: any, ctx: any): Error | null => {
  const sig = TRANSFER_EVENT_SIGNATURE.toLowerCase();
  const logs = Array.isArray(receipt.logs) ? receipt.logs : [];

  logInfo("Verification", `ERC20 check: token=${ctx.externalToken} safe=${ctx.safe} expected=${ctx.stratoTokenAmount} decimals=${ctx.externalDecimals} rebaseFactor=${ctx.rebaseFactor ?? 'none'} logCount=${logs.length}`);
  
  const validTransfer = logs.some(log => {
    const decoded = decodeTransferLog(log, sig);
    if (!decoded) return false;

    if (decoded.tokenAddr !== ctx.externalToken || decoded.toAddr !== ctx.safe) {
      logInfo("Verification", `  skip log: addr=${decoded.tokenAddr} to=${decoded.toAddr} amount=${decoded.amount}`);
      return false;
    }
    
    const convertedAmount = convertToStratoDecimals(decoded.amount, ctx.externalDecimals);
    logInfo("Verification", `  match log: amount=${decoded.amount} converted=${convertedAmount} stored=${ctx.stratoTokenAmount}`);

    if (ctx.rebaseFactor && ctx.rebaseFactor > 0n) {
      const rebasedAmount = (convertedAmount * WAD) / ctx.rebaseFactor;
      // Truncate to external token decimal precision to match oracle's integer truncation
      const precision = 10n ** BigInt(18 - ctx.externalDecimals);
      const truncatedRebasedAmount = (rebasedAmount / precision) * precision;
      logInfo("Verification", `  rebased=${rebasedAmount} truncated=${truncatedRebasedAmount} match=${truncatedRebasedAmount === ctx.stratoTokenAmount}`);
      return truncatedRebasedAmount === ctx.stratoTokenAmount;
    }
    
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

  // Fetch rebase factors for all deposits' STRATO tokens
  const allStratoTokens = [...new Set(deposits.map(d => d.stratoToken).filter(Boolean))];
  const rebaseFactorMap = allStratoTokens.length > 0 ? await getRebaseFactors(allStratoTokens) : new Map<string, bigint>();

  // Process each chain's deposits in batches
  for (const [chainId, chainDeposits] of depositsByChain) {
    // Deposit keys may carry a "#<depositId>" suffix; receipts are per source transaction
    const txHashes = [...new Set(chainDeposits.map(d => depositKeyTxHash(d.externalTxHash)))];
    if (txHashes.length === 0) continue;
    
    // Batch fetch receipts and internal transactions
    const [receipts, internalTxsMap] = await Promise.all([
      getTransactionReceiptsBatch(chainId, txHashes),
      getInternalTransactionsBatch(chainId, txHashes)
    ]);

    const txAttributions = new Map<string, TxAttributionState>();
    const getTxAttribution = (txHash: string): TxAttributionState => {
      const key = ensureHexPrefix(txHash).toLowerCase();
      let state = txAttributions.get(key);
      if (!state) {
        state = {
          usedRouterEventIndices: new Set<number>(),
          usedEthTraceIndices: new Set<number>(),
        };
        txAttributions.set(key, state);
      }
      return state;
    };

    // Verify each deposit using the batched data
    for (const deposit of chainDeposits) {
      try {
        const sourceTxHash = depositKeyTxHash(deposit.externalTxHash);
        const receipt = receipts.get(sourceTxHash);
        if (!receipt) {
          results.set(deposit.externalTxHash, fail(deposit.externalTxHash, "No receipt found"));
          continue;
        }

        if (!isOkStatus(receipt)) {
          results.set(deposit.externalTxHash, fail(deposit.externalTxHash, "Deposit transaction failed"));
          continue;
        }

        // Early guard + context object
        const rebaseFactor = rebaseFactorMap.get(deposit.stratoToken);
        const ctx = validateDeposit(deposit, chainId, safe, rebaseFactor);
        if (ctx instanceof Error) {
          results.set(deposit.externalTxHash, ctx);
          continue;
        }

        // Branch to appropriate verifier
        const error = ctx.isETH 
          ? verifyEthDeposit(
              receipt,
              internalTxsMap.get(sourceTxHash) || [],
              ctx,
              chainId,
              sourceTxHash,
              getTxAttribution(sourceTxHash),
            )
          : verifyErc20Deposit(receipt, ctx);

        results.set(deposit.externalTxHash, error);
      } catch (error) {
        results.set(deposit.externalTxHash, error as Error);
      }
    }
  }

  return results;
};