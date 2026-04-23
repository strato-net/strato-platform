import { config, ZERO_ADDRESS, TRANSFER_EVENT_SIGNATURE, REP_BURN_EVENT_SIGNATURE, WAD } from "../config";
import {
  getTransactionReceiptsBatch,
  getInternalTransactionsBatch
} from "./rpcService";
import { getRebaseFactors, getEnabledChains } from "./cirrusService";
import { normalizeAddress, safeToBigInt, ensureHexPrefix, convertToStratoDecimals, parseUint256, decodeTopicAddr, isOkStatus } from "../utils/utils";
import { logInfo } from "../utils/logger";
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

// Validates and builds verification context. Returns an Error for any
// mismatch or missing configuration that would make verification impossible.
const validateDeposit = (deposit: DepositInfo, chainId: Number, safe: string, rebaseFactor?: bigint) => {
  if (Number(deposit.externalChainId) !== chainId) {
    return new Error(`Chain mismatch for token ${normalizeAddress(deposit.externalToken)}. Expected: ${chainId}, Got: ${deposit.externalChainId}`);
  }

  const externalToken = normalizeAddress(ensureHexPrefix(deposit.externalToken));
  const depositRouter = normalizeAddress(deposit.depositRouter);
  const isNative = !!deposit.isNative;
  const repBridge = deposit.representationBridge
    ? normalizeAddress(ensureHexPrefix(deposit.representationBridge))
    : "";

  if (isNative && !repBridge) {
    return new Error(`Native deposit ${deposit.externalTxHash} on chain ${chainId} has no configured representationBridge`);
  }

  return {
    safe,
    isETH: externalToken === ZERO_ADDRESS,
    isNative,
    externalToken,
    depositRouter,
    repBridge,
    stratoToken: normalizeAddress(ensureHexPrefix(deposit.stratoToken)),
    stratoRecipient: normalizeAddress(ensureHexPrefix(deposit.stratoRecipient)),
    externalSender: normalizeAddress(ensureHexPrefix(deposit.externalSender)),
    stratoTokenAmount: safeToBigInt(deposit.stratoTokenAmount),
    externalDecimals: deposit.externalDecimals,
    rebaseFactor,
  };
};

const verifyEthDeposit = (receipt: any, traces: any[], ctx: any): Error | null => {
  const to = receipt.to ? normalizeAddress(receipt.to) : "";

  if (to === ctx.safe) {
    return null;
  }

  if (to !== ctx.depositRouter) {
    return new Error(`ETH receiver mismatch. Expected: ${ctx.depositRouter}, Got: ${to || "null"}`);
  }

  if (!findInternalEthTransfer(traces, ctx.safe, ctx.stratoTokenAmount)) {
    return new Error(`No internal ETH transfer to Safe ${ctx.safe} found`);
  }

  return null;
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

// Verify a native-asset return-to-STRATO by checking for a RepresentationBurned
// event emitted by the chain's StratoRepresentationBridge. All four addressed
// fields (stratoToken, from, stratoRecipient, representationToken) and the
// amount must match the deposit record. This is the inbound counterpart to
// verifyErc20Deposit for the isNative branch.
const verifyNativeBurn = (receipt: any, ctx: any): Error | null => {
  const sig = REP_BURN_EVENT_SIGNATURE.toLowerCase();
  const logs = Array.isArray(receipt.logs) ? receipt.logs : [];

  logInfo(
    "Verification",
    `native-burn check: repBridge=${ctx.repBridge} stratoToken=${ctx.stratoToken} recipient=${ctx.stratoRecipient} sender=${ctx.externalSender} expected=${ctx.stratoTokenAmount} logCount=${logs.length}`,
  );

  const match = logs.some((log: any) => {
    if (!log?.topics || log.topics.length < 4) return false;
    if (typeof log.topics[0] !== "string" || log.topics[0].toLowerCase() !== sig) return false;
    if (normalizeAddress(log.address) !== ctx.repBridge) return false;

    const stratoToken = decodeTopicAddr(log.topics[1]);
    const from = decodeTopicAddr(log.topics[2]);
    const stratoRecipient = decodeTopicAddr(log.topics[3]);
    if (stratoToken !== ctx.stratoToken) return false;
    if (from !== ctx.externalSender) return false;
    if (stratoRecipient !== ctx.stratoRecipient) return false;

    const data = typeof log.data === "string" ? log.data : "0x";
    if (data.length < 2 + 64 + 64) return false;
    // Data layout (non-indexed): [representationToken(32)][amount(32)]
    const repToken = normalizeAddress("0x" + data.substring(2, 66).slice(-40));
    if (repToken !== ctx.externalToken) return false;
    const amount = parseUint256("0x" + data.substring(66, 130));
    return amount === ctx.stratoTokenAmount;
  });

  if (!match) {
    return new Error(
      `No matching RepresentationBurned on ${ctx.repBridge} for stratoToken=${ctx.stratoToken}, from=${ctx.externalSender}, stratoRecipient=${ctx.stratoRecipient}`,
    );
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

  // Fetch chain info to get per-chain vault addresses
  const enabledChains = await getEnabledChains();

  // Fetch rebase factors for all deposits' STRATO tokens
  const allStratoTokens = [...new Set(deposits.map(d => d.stratoToken).filter(Boolean))];
  const rebaseFactorMap = allStratoTokens.length > 0 ? await getRebaseFactors(allStratoTokens) : new Map<string, bigint>();

  // Process each chain's deposits in batches
  for (const [chainId, chainDeposits] of depositsByChain) {
    // Resolve custody address: prefer externalBridgeVault, fall back to custody (legacy Safe)
    const chainInfo = enabledChains.get(chainId);
    const custodyAddress = normalizeAddress(
      chainInfo?.externalBridgeVault || chainInfo?.custody || ""
    );
    if (!custodyAddress) {
      // Native-only chains may not have any ERC-20 receiver configured; only
      // reject if any non-native deposit on the chain actually needs it.
      const anyNonNative = chainDeposits.some(d => !d.isNative);
      if (anyNonNative) {
        const error = new Error(`No custody/vault address configured for chain ${chainId}`);
        chainDeposits.forEach(d => {
          if (!d.isNative) results.set(d.externalTxHash, error);
        });
      }
    }

    // Dedupe txHashes
    const txHashes = [...new Set(chainDeposits.map(d => d.externalTxHash))];
    if (txHashes.length === 0) continue;

    // Internal-tx traces are only needed by ETH deposits. For chains that
    // only see ERC-20 or native-burn inbound we skip the trace_transaction
    // call to avoid the RPC cost.
    const needsTraces = chainDeposits.some(d => !d.isNative && normalizeAddress(ensureHexPrefix(d.externalToken)) === ZERO_ADDRESS);

    const [receipts, internalTxsMap] = await Promise.all([
      getTransactionReceiptsBatch(chainId, txHashes),
      needsTraces
        ? getInternalTransactionsBatch(chainId, txHashes)
        : Promise.resolve(new Map<string, any[]>()),
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

        // Early guard + context object (uses per-chain custody/vault address)
        const rebaseFactor = rebaseFactorMap.get(deposit.stratoToken);
        const ctx = validateDeposit(deposit, chainId, custodyAddress, rebaseFactor);
        if (ctx instanceof Error) {
          results.set(deposit.externalTxHash, ctx);
          continue;
        }

        // Branch to appropriate verifier:
        //   - isNative: representation burn event
        //   - ETH:      internal ETH transfer to vault
        //   - ERC20:    Transfer event to vault
        let error: Error | null;
        if (ctx.isNative) {
          error = verifyNativeBurn(receipt, ctx);
        } else if (ctx.isETH) {
          error = verifyEthDeposit(receipt, internalTxsMap.get(deposit.externalTxHash) || [], ctx);
        } else {
          error = verifyErc20Deposit(receipt, ctx);
        }

        results.set(deposit.externalTxHash, error);
      } catch (error) {
        results.set(deposit.externalTxHash, error as Error);
      }
    }
  }

  return results;
};
