import { Interface, ZeroAddress } from "ethers";
import {
  ActionDepositArgs,
  FeeDepositArgs,
  NonEmptyArray,
  WindowDeposit,
} from "../types";
import { normalizeAddress } from "../utils/utils";

const DEPOSIT_EVENTS_ABI = [
  "event DepositRouted(address indexed token, uint256 amount, address indexed sender, address indexed stratoAddress, address targetStratoToken, uint96 depositId)",
  "event DepositRoutedWithAction(address indexed token, uint256 amount, address indexed sender, address indexed stratoAddress, address targetStratoToken, uint96 depositId, uint8 action, address actionToken, uint256 minFinalOut)",
  "event DepositRoutedWithFee(address indexed token, uint256 amount, address indexed sender, address indexed stratoAddress, address targetStratoToken, uint96 depositId, uint256 maxFee, uint256 requestedAt, uint256 feeHalfLife)",
];

const depositEvents = new Interface(DEPOSIT_EVENTS_ABI);

export interface RawDepositLog {
  address: string;
  blockNumber: string;
  data: string;
  logIndex: string;
  topics: string[];
  transactionHash: string;
}

// Mirrors MercataBridge._normalizeDepositKey: lowercase 0x-prefixed hash, optional "#<depositId>"
export const canonicalDepositKey = (key: string): string => {
  const [hash, depositId] = key.split("#");
  const hex = hash.trim().replace(/^0x/i, "").toLowerCase();
  return depositId === undefined
    ? `0x${hex}`
    : `0x${hex}#${BigInt(depositId).toString()}`;
};

// The source transaction hash a deposit key refers to
export const depositKeyTxHash = (key: string): string => key.split("#")[0];

type ParsedDepositLog = Omit<WindowDeposit, "depositKey" | "sharesTransaction">;

export const parseDepositLog = (
  log: RawDepositLog,
  externalChainId: number,
): ParsedDepositLog => {
  const parsed = depositEvents.parseLog({
    topics: log.topics,
    data: log.data,
  });
  if (!parsed) {
    throw new Error("Log does not match a supported deposit event");
  }
  if (!log.transactionHash) {
    throw new Error(
      `Deposit log without a transaction hash at block ${log.blockNumber}, index ${log.logIndex}`,
    );
  }

  const base = {
    externalChainId,
    externalSender: normalizeAddress(parsed.args.sender),
    externalToken: normalizeAddress(parsed.args.token),
    externalTokenAmount: parsed.args.amount.toString(),
    externalTxHash: log.transactionHash.toLowerCase(),
    stratoRecipient: normalizeAddress(parsed.args.stratoAddress),
    targetStratoToken: normalizeAddress(parsed.args.targetStratoToken),
    depositId: parsed.args.depositId.toString(),
    blockNumber: Number(log.blockNumber),
    logIndex: Number(log.logIndex),
  };
  const noAction = { action: "0", actionToken: ZeroAddress, minFinalOut: "0" };
  // A plain deposit carries no schedule; requestedAt 0 tells STRATO not to write one
  const noFee = { maxFee: "0", requestedAt: "0", feeHalfLife: "0" };
  if (parsed.name === "DepositRouted") {
    return { ...base, ...noAction, ...noFee, kind: "standard" };
  }

  if (parsed.name === "DepositRoutedWithFee") {
    return {
      ...base,
      ...noAction,
      kind: "fee",
      maxFee: parsed.args.maxFee.toString(),
      // The ORIGIN chain's timestamp, passed through unchanged. STRATO
      // measures the fee decay from here, so relayer lag is refunded to the
      // user; substituting a local clock would hand that back to the solver.
      requestedAt: parsed.args.requestedAt.toString(),
      feeHalfLife: parsed.args.feeHalfLife.toString(),
    };
  }

  if (parsed.name !== "DepositRoutedWithAction") {
    throw new Error(`Unsupported deposit event ${parsed.name}`);
  }

  return {
    ...base,
    ...noFee,
    kind: "action",
    action: parsed.args.action.toString(),
    actionToken: normalizeAddress(parsed.args.actionToken),
    minFinalOut: parsed.args.minFinalOut.toString(),
  };
};

/**
 * Turn the deposit logs of one block window into deposits ordered as they happened.
 * A transaction that emitted several deposits keys each one by its router deposit id,
 * so one smart-wallet batch or bundle cannot stall the window.
 */
export const extractWindowDeposits = (
  logs: RawDepositLog[],
  externalChainId: number,
): WindowDeposit[] => {
  // Some RPCs repeat identical logs; keep one copy of each
  const uniqueLogs = Array.from(
    new Map(
      logs.map((log) => [
        JSON.stringify([
          log.address?.toLowerCase(),
          log.blockNumber?.toLowerCase(),
          log.transactionHash?.toLowerCase(),
          log.logIndex?.toLowerCase(),
          log.topics.map((topic) => topic.toLowerCase()),
          log.data?.toLowerCase(),
        ]),
        log,
      ]),
    ).values(),
  );

  const parsed = uniqueLogs
    .map((log) => parseDepositLog(log, externalChainId))
    .sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);

  const depositsPerTx = new Map<string, number>();
  const seenIds = new Set<string>();
  for (const deposit of parsed) {
    if (seenIds.has(deposit.depositId)) {
      throw new Error(
        `Deposit id ${deposit.depositId} appears twice in one window on chain ${externalChainId}`,
      );
    }
    seenIds.add(deposit.depositId);
    depositsPerTx.set(
      deposit.externalTxHash,
      (depositsPerTx.get(deposit.externalTxHash) || 0) + 1,
    );
  }

  return parsed.map((deposit) => {
    const sharesTransaction = depositsPerTx.get(deposit.externalTxHash)! > 1;
    return {
      ...deposit,
      sharesTransaction,
      depositKey: sharesTransaction
        ? `${deposit.externalTxHash}#${deposit.depositId}`
        : deposit.externalTxHash,
    };
  });
};

// Arguments for MercataBridge.recordDepositWindow
export const buildDepositWindowArgs = (
  externalChainId: number,
  lastProcessedBlock: number,
  deposits: WindowDeposit[],
) => ({
  externalChainId,
  lastProcessedBlock,
  depositIds: deposits.map((deposit) => deposit.depositId),
  externalSenders: deposits.map((deposit) => deposit.externalSender),
  externalTokens: deposits.map((deposit) => deposit.externalToken),
  externalTokenAmounts: deposits.map((deposit) => deposit.externalTokenAmount),
  externalTxHashes: deposits.map((deposit) => deposit.depositKey),
  stratoRecipients: deposits.map((deposit) => deposit.stratoRecipient),
  targetStratoTokens: deposits.map((deposit) => deposit.targetStratoToken),
  actions: deposits.map((deposit) => deposit.action),
  actionTokens: deposits.map((deposit) => deposit.actionToken),
  minFinalOuts: deposits.map((deposit) => deposit.minFinalOut),
  maxFees: deposits.map((deposit) => deposit.maxFee),
  requestedAts: deposits.map((deposit) => deposit.requestedAt),
});

/**
 * Arguments for MercataBridge.depositBatchWithFee.
 *
 * `requestedAt` is the ORIGIN chain's timestamp and is passed through
 * untouched: STRATO starts the fee decay there, so a relayer that is an hour
 * behind hands the user an hour of decay rather than handing it to a solver.
 * `feeHalfLife` is deliberately NOT passed -- STRATO commits its own configured
 * half-life at record time, and the log's copy exists for solvers reading the
 * origin chain directly.
 */
export const buildFeeDepositBatchArgs = (
  depositArgs: NonEmptyArray<FeeDepositArgs>,
) => ({
  externalChainIds: depositArgs.map((deposit) => deposit.externalChainId),
  externalSenders: depositArgs.map((deposit) => deposit.externalSender),
  externalTokens: depositArgs.map((deposit) => deposit.externalToken),
  externalTokenAmounts: depositArgs.map((deposit) => deposit.externalTokenAmount),
  externalTxHashes: depositArgs.map((deposit) => deposit.externalTxHash),
  stratoRecipients: depositArgs.map((deposit) => deposit.stratoRecipient),
  targetStratoTokens: depositArgs.map((deposit) => deposit.targetStratoToken),
  maxFees: depositArgs.map((deposit) => deposit.maxFee),
  requestedAts: depositArgs.map((deposit) => deposit.requestedAt),
});

export const buildActionDepositBatchArgs = (
  depositArgs: NonEmptyArray<ActionDepositArgs>,
) => ({
  externalChainIds: depositArgs.map((deposit) => deposit.externalChainId),
  externalSenders: depositArgs.map((deposit) => deposit.externalSender),
  externalTokens: depositArgs.map((deposit) => deposit.externalToken),
  externalTokenAmounts: depositArgs.map((deposit) => deposit.externalTokenAmount),
  externalTxHashes: depositArgs.map((deposit) => deposit.externalTxHash),
  stratoRecipients: depositArgs.map((deposit) => deposit.stratoRecipient),
  targetStratoTokens: depositArgs.map((deposit) => deposit.targetStratoToken),
  actions: depositArgs.map((deposit) => deposit.action),
  actionTokens: depositArgs.map((deposit) => deposit.actionToken),
  minFinalOuts: depositArgs.map((deposit) => deposit.minFinalOut),
});
