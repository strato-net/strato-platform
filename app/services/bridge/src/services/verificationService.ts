import {
  getDepositConfirmationPolicy,
  DEPOSIT_EVENT_SIGNATURES,
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
    fromAddr: decodeTopicAddr(log.topics[1]),
    toAddr: decodeTopicAddr(log.topics[2]),
    amount: parseUint256(log.data ?? "0x"),
    logIndex: Number(BigInt(log.logIndex ?? -1)),
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

const uniqueReceiptLogs = (logs: any[]): { logs: any[]; error?: Error } => {
  const byPosition = new Map<string, { fingerprint: string; log: any }>();
  for (const log of logs) {
    let logIndex: number;
    try {
      logIndex = Number(BigInt(log.logIndex));
    } catch {
      return { logs: [], error: new Error("Receipt log is missing its index") };
    }
    const position = `${normalizeAddress(log.address)}:${logIndex}`;
    const fingerprint = JSON.stringify([
      normalizeAddress(log.address),
      (log.topics || []).map((topic: string) => topic.toLowerCase()),
      String(log.data || "0x").toLowerCase(),
    ]);
    const existing = byPosition.get(position);
    if (existing && existing.fingerprint !== fingerprint) {
      return {
        logs: [],
        error: new Error(`Conflicting receipt logs at index ${logIndex}`),
      };
    }
    if (!existing) byPosition.set(position, { fingerprint, log });
  }
  return {
    logs: [...byPosition.values()]
      .map(({ log }) => log)
      .sort((a, b) => Number(BigInt(a.logIndex)) - Number(BigInt(b.logIndex))),
  };
};

const parseReceiptDeposits = (
  receipt: any,
  chainId: number,
  depositRouters: Set<string>,
): { deposits: Array<DepositArgs | ActionDepositArgs>; error?: Error } => {
  const unique = uniqueReceiptLogs(Array.isArray(receipt.logs) ? receipt.logs : []);
  if (unique.error) return { deposits: [], error: unique.error };
  const signatures = new Set(
    DEPOSIT_EVENT_SIGNATURES.map((signature) => signature.toLowerCase()),
  );
  try {
    const deposits = unique.logs
      .filter(
        (log) =>
          depositRouters.has(normalizeAddress(log.address)) &&
          signatures.has(String(log.topics?.[0] || "").toLowerCase()),
      )
      .map(
        (log) =>
          parseDepositLog(
            {
              ...(log as RawDepositLog),
              blockHash: receipt.blockHash,
              blockNumber: receipt.blockNumber,
              transactionHash: receipt.transactionHash,
            },
            chainId,
          ).deposit,
      );
    const identities = deposits.map(depositIdentity);
    if (new Set(identities).size !== identities.length) {
      return {
        deposits: [],
        error: new Error("Duplicate deposit identity in transaction receipt"),
      };
    }
    return { deposits };
  } catch (error) {
    return { deposits: [], error: error as Error };
  }
};

const compareTraceAddress = (left: number[], right: number[]): number => {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return left.length - right.length;
};

const isTraceAncestor = (ancestor: number[], descendant: number[]): boolean =>
  ancestor.length < descendant.length &&
  ancestor.every((value, index) => descendant[index] === value);

const uniqueTraces = (traces: any[]): { traces: any[]; error?: Error } => {
  const byPosition = new Map<string, { fingerprint: string; trace: any }>();
  for (const trace of traces) {
    if (!Array.isArray(trace.traceAddress)) {
      return {
        traces: [],
        error: new Error("ETH trace is missing traceAddress ordering"),
      };
    }
    const position = JSON.stringify(trace.traceAddress);
    const fingerprint = JSON.stringify([
      trace.type,
      normalizeAddress(trace.action?.from),
      normalizeAddress(trace.action?.to),
      String(trace.action?.value || "0").toLowerCase(),
      String(trace.action?.input || "").toLowerCase(),
    ]);
    const existing = byPosition.get(position);
    if (existing && existing.fingerprint !== fingerprint) {
      return {
        traces: [],
        error: new Error(`Conflicting ETH traces at ${position}`),
      };
    }
    if (!existing) byPosition.set(position, { fingerprint, trace });
  }
  return {
    traces: [...byPosition.values()]
      .map(({ trace }) => trace)
      .sort((a, b) => compareTraceAddress(a.traceAddress, b.traceAddress)),
  };
};

export const verifyTransactionCustody = (
  deposits: Array<DepositArgs | ActionDepositArgs>,
  receipt: any,
  traces: any[],
  custodyAddress: string,
): Error | null => {
  const normalizedCustody = normalizeAddress(custodyAddress);
  const unique = uniqueReceiptLogs(Array.isArray(receipt.logs) ? receipt.logs : []);
  if (unique.error) return unique.error;
  const transfers = unique.logs
    .map((log) => decodeTransferLog(log, TRANSFER_EVENT_SIGNATURE.toLowerCase()))
    .filter(Boolean);
  const orderedDeposits = [...deposits].sort(
    (left, right) => left.externalLogIndex - right.externalLogIndex,
  );

  for (let index = 0; index < orderedDeposits.length; index += 1) {
    const deposit = orderedDeposits[index];
    if (deposit.externalToken === ZERO_ADDRESS) continue;
    const previousDepositIndex =
      index === 0 ? -1 : orderedDeposits[index - 1].externalLogIndex;
    const matchingTransfers = transfers.filter(
      (transfer: any) =>
        transfer.logIndex > previousDepositIndex &&
        transfer.logIndex < deposit.externalLogIndex &&
        transfer.tokenAddr === deposit.externalToken &&
        transfer.fromAddr === deposit.externalSender &&
        transfer.toAddr === normalizedCustody &&
        transfer.amount === BigInt(deposit.observedExternalTokenAmount),
    );
    if (matchingTransfers.length !== 1) {
      return new Error(
        matchingTransfers.length === 0
          ? `ERC20 custody transfer missing before deposit ${deposit.depositId}`
          : `Ambiguous ERC20 custody transfers before deposit ${deposit.depositId}`,
      );
    }
  }

  const ethDeposits = orderedDeposits.filter(
    (deposit) => deposit.externalToken === ZERO_ADDRESS,
  );
  if (ethDeposits.length === 0) return null;
  const uniqueTraceResult = uniqueTraces(traces);
  if (uniqueTraceResult.error) return uniqueTraceResult.error;
  const orderedTraces = uniqueTraceResult.traces;
  const routers = new Set(ethDeposits.map((deposit) => deposit.depositRouter));
  const movements = orderedTraces
    .filter(
      (trace) =>
        trace.type === "call" &&
        routers.has(normalizeAddress(trace.action?.from)) &&
        normalizeAddress(trace.action?.to) === normalizedCustody &&
        safeToBigInt(trace.action?.value || "0") > 0n,
    )
    .map((movement) => {
      const ancestors = orderedTraces.filter(
        (candidate) =>
          candidate.type === "call" &&
          normalizeAddress(candidate.action?.to) ===
            normalizeAddress(movement.action?.from) &&
          isTraceAncestor(candidate.traceAddress, movement.traceAddress),
      );
      const invocation = ancestors.sort(
        (left, right) => right.traceAddress.length - left.traceAddress.length,
      )[0];
      return { movement, invocation };
    })
    .sort((left, right) =>
      compareTraceAddress(
        left.invocation?.traceAddress || left.movement.traceAddress,
        right.invocation?.traceAddress || right.movement.traceAddress,
      ),
    );
  if (movements.length !== ethDeposits.length) {
    return new Error(
      `ETH custody movement count mismatch: expected ${ethDeposits.length}, got ${movements.length}`,
    );
  }
  for (let index = 0; index < ethDeposits.length; index += 1) {
    const deposit = ethDeposits[index];
    const { movement, invocation } = movements[index];
    if (
      !invocation ||
      normalizeAddress(invocation.action?.from) !== deposit.externalSender ||
      normalizeAddress(invocation.action?.to) !== deposit.depositRouter ||
      normalizeAddress(movement.action?.from) !== deposit.depositRouter ||
      safeToBigInt(movement.action?.value || "0") !==
        BigInt(deposit.observedExternalTokenAmount)
    ) {
      return new Error(
        `ETH custody movement does not uniquely match deposit ${deposit.depositId}`,
      );
    }
  }
  return null;
};

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
    const txHashes = [
      ...new Map(
        chainDeposits.map((item) => [
          item.externalTxHash.toLowerCase(),
          item.externalTxHash,
        ]),
      ).values(),
    ];
    const [receipts, traces] = await Promise.all([
      getTransactionReceiptsBatch(chainId, txHashes),
      getInternalTransactionsBatch(chainId, txHashes),
    ]);

    const depositsByTransaction = new Map<
      string,
      Array<DepositArgs | ActionDepositArgs>
    >();
    for (const deposit of chainDeposits) {
      const transactionHash = deposit.externalTxHash.toLowerCase();
      depositsByTransaction.set(transactionHash, [
        ...(depositsByTransaction.get(transactionHash) || []),
        deposit,
      ]);
    }
    const setTransactionState = (
      transactionDeposits: Array<DepositArgs | ActionDepositArgs>,
      state: DetectedDepositVerification,
    ) => {
      transactionDeposits.forEach((deposit) =>
        results.set(depositIdentity(deposit), state),
      );
    };

    for (const transactionDeposits of depositsByTransaction.values()) {
      const transactionHash = transactionDeposits[0].externalTxHash;
      try {
        const receipt = receipts.get(transactionHash);
        if (!receipt) {
          setTransactionState(transactionDeposits, { state: "missing" });
          continue;
        }
        if (receipt.__rpcDisagreement) {
          setTransactionState(transactionDeposits, {
            state: "invalid",
            error: fail(transactionHash, "RPC providers disagree"),
          });
          continue;
        }
        if (!isOkStatus(receipt)) {
          setTransactionState(transactionDeposits, {
            state: "invalid",
            error: fail(transactionHash, "Deposit transaction failed"),
          });
          continue;
        }
        if (transactionDeposits.some(
          (deposit) =>
            String(receipt.blockHash).toLowerCase() !==
            deposit.externalBlockHash.toLowerCase(),
        )) {
          setTransactionState(transactionDeposits, { state: "relocated" });
          continue;
        }
        const confirmations = getDepositConfirmationPolicy(chainId);
        if (latestBlock - Number(BigInt(receipt.blockNumber)) < confirmations) {
          setTransactionState(transactionDeposits, { state: "confirming" });
          continue;
        }
        const depositRouters = new Set(
          transactionDeposits.map((deposit) =>
            normalizeAddress(deposit.depositRouter),
          ),
        );
        const parsedReceipt = parseReceiptDeposits(
          receipt,
          chainId,
          depositRouters,
        );
        if (parsedReceipt.error) throw parsedReceipt.error;
        for (const deposit of transactionDeposits) {
          const parsed = parsedReceipt.deposits.find(
            (candidate) =>
              candidate.externalLogIndex === deposit.externalLogIndex &&
              candidate.depositRouter === deposit.depositRouter,
          );
          if (!parsed) {
            throw fail(transactionHash, "Deposit event missing from receipt");
          }
          if (!sameDetectedDeposit(deposit, parsed)) {
            throw fail(transactionHash, "Deposit event changed");
          }
        }
        const containsEth = parsedReceipt.deposits.some(
          (deposit) => deposit.externalToken === ZERO_ADDRESS,
        );
        const transactionTraces = traces.get(transactionHash);
        if (containsEth && !transactionTraces) {
          setTransactionState(transactionDeposits, { state: "missing" });
          continue;
        }
        const custodyError = verifyTransactionCustody(
          parsedReceipt.deposits,
          receipt,
          transactionTraces || [],
          custodyAddress,
        );
        if (custodyError) {
          throw fail(transactionHash, custodyError.message);
        }
        setTransactionState(transactionDeposits, { state: "verified" });
      } catch (error) {
        setTransactionState(transactionDeposits, {
          state: "invalid",
          error: error as Error,
        });
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