import {
  getDepositConfirmationPolicy,
  ZERO_ADDRESS,
  TRANSFER_EVENT_SIGNATURE,
  WAD,
} from "../config";
import { 
  getTransactionReceiptsBatch, 
  getInternalTransactionsBatch 
} from "./rpcService";
import { getRebaseFactors } from "./cirrusService";
import { normalizeAddress, safeToBigInt, ensureHexPrefix, convertToStratoDecimals, parseUint256, decodeTopicAddr, isOkStatus } from "../utils/utils";
import { logInfo } from "../utils/logger";
import { ActionDepositArgs, DepositArgs, DepositInfo } from "../types";
import { parseDepositLog, RawDepositLog } from "./depositEventService";

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

export const validateDeposit = (deposit: DepositInfo, chainId: Number, rebaseFactor?: bigint) => {
  if (Number(deposit.externalChainId) !== chainId) {
    return new Error(`Chain mismatch for token ${normalizeAddress(deposit.externalToken)}. Expected: ${chainId}, Got: ${deposit.externalChainId}`);
  }

  const externalToken = normalizeAddress(ensureHexPrefix(deposit.externalToken));
  const depositRouter = normalizeAddress(deposit.depositRouter);
  const custodyAddress = normalizeAddress(deposit.custodyAddress);
  if (!custodyAddress) {
    return new Error(`Custody address not configured for chain ${chainId}`);
  }
  
  return {
    custodyAddress,
    isETH: externalToken === ZERO_ADDRESS,
    externalToken,
    depositRouter,
    stratoTokenAmount: safeToBigInt(deposit.stratoTokenAmount),
    externalDecimals: deposit.externalDecimals,
    rebaseFactor,
  };
};

export const verifyEthDeposit = (receipt: any, traces: any[], ctx: any): Error | null => {
  const to = receipt.to ? normalizeAddress(receipt.to) : "";
  
  if (to === ctx.custodyAddress) {
    return null;
  }

  if (to !== ctx.depositRouter) {
    return new Error(`ETH receiver mismatch. Expected: ${ctx.depositRouter}, Got: ${to || "null"}`);
  }
  
  if (!findInternalEthTransfer(traces, ctx.custodyAddress, ctx.stratoTokenAmount)) {
    return new Error(`No internal ETH transfer to custody ${ctx.custodyAddress} found`);
  }
  
  return null;
};

export const verifyErc20Deposit = (receipt: any, ctx: any): Error | null => {
  const sig = TRANSFER_EVENT_SIGNATURE.toLowerCase();
  const logs = Array.isArray(receipt.logs) ? receipt.logs : [];

  logInfo("Verification", `ERC20 check: token=${ctx.externalToken} custody=${ctx.custodyAddress} expected=${ctx.stratoTokenAmount} decimals=${ctx.externalDecimals} rebaseFactor=${ctx.rebaseFactor ?? 'none'} logCount=${logs.length}`);
  
  const validTransfer = logs.some(log => {
    const decoded = decodeTransferLog(log, sig);
    if (!decoded) return false;

    if (decoded.tokenAddr !== ctx.externalToken || decoded.toAddr !== ctx.custodyAddress) {
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
    return new Error(`No ERC20 Transfer to custody ${ctx.custodyAddress} for token ${ctx.externalToken}`);
  }
  
  return null;
};

const fail = (txHash: string, msg: string): Error => new Error(`${msg} for ${txHash}`);

export type DetectedDepositVerification =
  | { state: "verified" }
  | { state: "confirming" }
  | { state: "missing" }
  | { state: "relocated" }
  | { state: "invalid"; error: Error };

export const depositIdentity = (deposit: DepositArgs): string =>
  `${deposit.externalChainId}:${deposit.depositRouter.toLowerCase()}:${deposit.depositId}`;

const sameDetectedDeposit = (
  expected: DepositArgs | ActionDepositArgs,
  actual: DepositArgs | ActionDepositArgs,
): boolean =>
  expected.depositRouter === actual.depositRouter &&
  expected.depositId === actual.depositId &&
  expected.externalSender === actual.externalSender &&
  expected.externalToken === actual.externalToken &&
  expected.observedExternalTokenAmount === actual.observedExternalTokenAmount &&
  expected.stratoRecipient === actual.stratoRecipient &&
  expected.targetStratoToken === actual.targetStratoToken &&
  ("action" in expected ? expected.action : "0") ===
    ("action" in actual ? actual.action : "0") &&
  ("actionToken" in expected ? expected.actionToken : "") ===
    ("actionToken" in actual ? actual.actionToken : "") &&
  ("minFinalOut" in expected ? expected.minFinalOut : "0") ===
    ("minFinalOut" in actual ? actual.minFinalOut : "0");

export const verifyDetectedDepositsBatch = async (
  deposits: Array<DepositArgs | ActionDepositArgs>,
  latestBlock: number,
  custodyAddress: string,
): Promise<Map<string, DetectedDepositVerification>> => {
  const results = new Map<string, DetectedDepositVerification>();
  const depositsByChain = new Map<number, Array<DepositArgs | ActionDepositArgs>>();
  for (const deposit of deposits) {
    const chainId = Number(deposit.externalChainId);
    depositsByChain.set(chainId, [
      ...(depositsByChain.get(chainId) || []),
      deposit,
    ]);
  }

  for (const [chainId, chainDeposits] of depositsByChain) {
    const txHashes = [...new Set(chainDeposits.map((item) => item.externalTxHash))];
    const ethTxHashes = [
      ...new Set(
        chainDeposits
          .filter((item) => item.externalToken === ZERO_ADDRESS)
          .map((item) => item.externalTxHash),
      ),
    ];
    const [receipts, traces] = await Promise.all([
      getTransactionReceiptsBatch(chainId, txHashes),
      ethTxHashes.length
        ? getInternalTransactionsBatch(chainId, ethTxHashes)
        : Promise.resolve(new Map<string, any[]>()),
    ]);

    for (const deposit of chainDeposits) {
      const key = depositIdentity(deposit);
      try {
        const receipt = receipts.get(deposit.externalTxHash);
        if (!receipt) {
          results.set(key, { state: "missing" });
          continue;
        }
        if (receipt.__rpcDisagreement) {
          results.set(key, {
            state: "invalid",
            error: fail(deposit.externalTxHash, "RPC providers disagree"),
          });
          continue;
        }
        if (!isOkStatus(receipt)) {
          results.set(key, {
            state: "invalid",
            error: fail(deposit.externalTxHash, "Deposit transaction failed"),
          });
          continue;
        }
        if (
          String(receipt.blockHash).toLowerCase() !==
          deposit.externalBlockHash.toLowerCase()
        ) {
          results.set(key, { state: "relocated" });
          continue;
        }
        const confirmations = getDepositConfirmationPolicy(chainId);
        if (latestBlock - Number(BigInt(receipt.blockNumber)) < confirmations) {
          results.set(key, { state: "confirming" });
          continue;
        }
        const receiptLog = (receipt.logs || []).find(
          (log: any) =>
            Number(BigInt(log.logIndex)) === deposit.externalLogIndex &&
            normalizeAddress(log.address) === deposit.depositRouter,
        );
        if (!receiptLog) {
          throw fail(deposit.externalTxHash, "Deposit event missing from receipt");
        }
        const parsed = parseDepositLog(
          {
            ...(receiptLog as RawDepositLog),
            blockHash: receipt.blockHash,
            blockNumber: receipt.blockNumber,
            transactionHash: receipt.transactionHash,
          },
          chainId,
        ).deposit;
        if (!sameDetectedDeposit(deposit, parsed)) {
          throw fail(deposit.externalTxHash, "Deposit event changed");
        }

        const observedAmount = BigInt(deposit.observedExternalTokenAmount);
        if (deposit.externalToken === ZERO_ADDRESS) {
          const transactionTraces = traces.get(deposit.externalTxHash);
          if (!transactionTraces) {
            results.set(key, { state: "missing" });
            continue;
          }
          if (
            !findInternalEthTransfer(
              transactionTraces,
              normalizeAddress(custodyAddress),
              observedAmount,
            )
          ) {
            throw fail(deposit.externalTxHash, "ETH custody transfer missing");
          }
        } else {
          const transferFound = (receipt.logs || []).some((log: any) => {
            const transfer = decodeTransferLog(
              log,
              TRANSFER_EVENT_SIGNATURE.toLowerCase(),
            );
            return (
              transfer?.tokenAddr === deposit.externalToken &&
              transfer.toAddr === normalizeAddress(custodyAddress) &&
              transfer.amount === observedAmount
            );
          });
          if (!transferFound) {
            throw fail(deposit.externalTxHash, "ERC20 custody transfer missing");
          }
        }
        results.set(key, { state: "verified" });
      } catch (error) {
        results.set(key, { state: "invalid", error: error as Error });
      }
    }
  }
  return results;
};

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

  // Fetch rebase factors for all deposits' STRATO tokens
  const allStratoTokens = [...new Set(deposits.map(d => d.stratoToken).filter(Boolean))];
  const rebaseFactorMap = allStratoTokens.length > 0 ? await getRebaseFactors(allStratoTokens) : new Map<string, bigint>();

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
        const rebaseFactor = rebaseFactorMap.get(deposit.stratoToken);
        const ctx = validateDeposit(deposit, chainId, rebaseFactor);
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