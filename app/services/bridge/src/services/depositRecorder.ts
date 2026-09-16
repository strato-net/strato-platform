import { config } from "../config";
import { FunctionInput, NonEmptyArray, TxResponse, WindowDeposit } from "../types";
import { execute } from "../utils/stratoHelper";
import { logError, logInfo } from "../utils/logger";
import { getRecordedDepositKeys } from "./cirrusService";
import { blockTrackingService } from "./blockTrackingService";
import {
  createDepositDeadLetterStore,
  DepositDeadLetterStore,
} from "./depositDeadLetterStore";
import {
  buildActionDepositBatchArgs,
  buildDepositWindowArgs,
  canonicalDepositKey,
} from "./depositEventService";

// Reverts that are about one deposit's content: retrying the same call can never succeed,
// so the deposit is isolated instead of holding back the rest of the window
const PERMANENT_DEPOSIT_ERRORS = [
  "MB: route not enabled",
  "MB: inactive token",
  "MB: asset missing",
  "MB: invalid target token",
  "MB: invalid external token amount",
  "MB: invalid strato recipient",
  "MB: invalid external sender",
  "MB: invalid strato token amount",
  "MB: invalid external tx hash",
  "MB: invalid deposit id",
  "MB: invalid deposit key",
  "MB: deposit key id mismatch",
  "MB: deposit id mismatch",
  "MB: deposit id reused",
];

const errorMessage = (error: unknown) => String((error as Error)?.message ?? error);

export const isPermanentDepositError = (error: unknown): boolean => {
  const message = errorMessage(error);
  return PERMANENT_DEPOSIT_ERRORS.some((reason) => message.includes(reason));
};

export const isDuplicateDepositError = (error: unknown): boolean => {
  const message = errorMessage(error);
  return message.includes("MB: dup key") || message.includes("MB: duplicate deposit");
};

// The deposits went through but Cirrus does not show them yet; the window will be replayed
export class DepositReadBackError extends Error {
  constructor(readonly externalChainId: number, readonly missingKeys: string[]) {
    super(
      `Recorded deposits not visible on chain ${externalChainId} yet: ${missingKeys.join(", ")}`,
    );
    this.name = "DepositReadBackError";
  }
}

export interface DepositRecorderDeps {
  execute: (inputs: FunctionInput | FunctionInput[]) => Promise<TxResponse>;
  getRecordedDepositKeys: (externalChainId: number, depositKeys: string[]) => Promise<Set<string>>;
  deadLetters: Pick<DepositDeadLetterStore, "add">;
  commitLocalCheckpoint: (externalChainId: number, block: number) => Promise<void>;
  commitOnChainCheckpoint: (externalChainId: number, block: number) => Promise<void>;
  bridgeAddress: string;
  useDepositWindow: boolean;
  readBackTimeoutMs: number;
  readBackIntervalMs: number;
  sleep?: (ms: number) => Promise<void>;
}

export const createDepositRecorder = (deps: DepositRecorderDeps) => {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  const bridgeCall = (method: string, args: Record<string, any>): FunctionInput => ({
    contractName: "MercataBridge",
    contractAddress: deps.bridgeAddress,
    method,
    args,
  });

  const windowCall = (externalChainId: number, lastProcessedBlock: number, deposits: WindowDeposit[]) =>
    bridgeCall(
      "recordDepositWindow",
      buildDepositWindowArgs(externalChainId, lastProcessedBlock, deposits),
    );

  const deadLetter = async (externalChainId: number, deposit: WindowDeposit, reason: string) => {
    await deps.deadLetters.add(externalChainId, deposit, reason);
    logError(
      "DepositRecorder",
      new Error(
        `Deposit ${deposit.depositKey} (id ${deposit.depositId}) on chain ${externalChainId} was NOT recorded on STRATO and needs manual resolution: ${reason}`,
      ),
      { deposit },
    );
  };

  // Returns whether the deposit is on-chain; dead-letters permanent failures and rethrows anything else
  const settleFailure = async (
    externalChainId: number,
    deposit: WindowDeposit,
    error: unknown,
    alreadyRecorded: (error: unknown) => boolean,
  ): Promise<boolean> => {
    if (alreadyRecorded(error)) return true;
    if (!isPermanentDepositError(error)) throw error;
    await deadLetter(externalChainId, deposit, errorMessage(error));
    return false;
  };

  // Retry a rejected batch one deposit per call, so one bad deposit cannot hold back the others
  const recordEach = async (
    externalChainId: number,
    deposits: WindowDeposit[],
    batchError: unknown,
    callFor: (deposit: WindowDeposit) => FunctionInput,
    alreadyRecorded: (error: unknown) => boolean,
  ): Promise<WindowDeposit[]> => {
    if (deposits.length === 1) {
      // The batch was this one deposit, so its error already is the per-deposit outcome
      const isRecorded = await settleFailure(externalChainId, deposits[0], batchError, alreadyRecorded);
      return isRecorded ? deposits : [];
    }
    const recorded: WindowDeposit[] = [];
    for (const deposit of deposits) {
      try {
        await deps.execute(callFor(deposit));
        recorded.push(deposit);
      } catch (error) {
        if (await settleFailure(externalChainId, deposit, error, alreadyRecorded)) {
          recorded.push(deposit);
        }
      }
    }
    return recorded;
  };

  // New path: deposits and checkpoint land in one transaction; replays are no-ops on-chain
  const recordWithWindow = async (
    externalChainId: number,
    toBlock: number,
    deposits: WindowDeposit[],
  ): Promise<void> => {
    let windowError: unknown;
    try {
      await deps.execute(windowCall(externalChainId, toBlock, deposits));
    } catch (error) {
      if (!isPermanentDepositError(error)) throw error;
      windowError = error;
    }
    if (windowError === undefined) {
      await verifyRecorded(externalChainId, deposits);
      return;
    }

    logInfo(
      "DepositRecorder",
      `Window through block ${toBlock} on chain ${externalChainId} was rejected (${errorMessage(windowError)}); recording its deposits one by one`,
    );
    const recorded = await recordEach(
      externalChainId,
      deposits,
      windowError,
      (deposit) => windowCall(externalChainId, 0, [deposit]),
      () => false,
    );
    await verifyRecorded(externalChainId, recorded);
    await deps.execute(windowCall(externalChainId, toBlock, []));
  };

  // Legacy path: depositBatch keys deposits by tx hash only, and the checkpoint is a separate call
  const recordLegacyBatch = async (
    externalChainId: number,
    deposits: WindowDeposit[],
    batchCall: (deposits: NonEmptyArray<WindowDeposit>) => FunctionInput,
    singleCall: (deposit: WindowDeposit) => FunctionInput,
  ): Promise<WindowDeposit[]> => {
    if (deposits.length === 0) return [];
    try {
      await deps.execute(batchCall(deposits as NonEmptyArray<WindowDeposit>));
      return deposits;
    } catch (error) {
      if (!isDuplicateDepositError(error) && !isPermanentDepositError(error)) throw error;
      logInfo(
        "DepositRecorder",
        `Deposit batch on chain ${externalChainId} was rejected (${errorMessage(error)}); recording item by item`,
      );
      return recordEach(externalChainId, deposits, error, singleCall, isDuplicateDepositError);
    }
  };

  const recordLegacy = async (
    externalChainId: number,
    toBlock: number,
    deposits: WindowDeposit[],
  ): Promise<void> => {
    const eligible: WindowDeposit[] = [];
    for (const deposit of deposits) {
      if (deposit.sharesTransaction) {
        await deadLetter(
          externalChainId,
          deposit,
          "transaction emitted several deposits; depositBatch can only key one per tx hash (enable BRIDGE_RECORD_DEPOSIT_WINDOW)",
        );
      } else {
        eligible.push(deposit);
      }
    }

    const standardArgs = (d: WindowDeposit) => ({
      externalChainId: d.externalChainId,
      externalSender: d.externalSender,
      externalToken: d.externalToken,
      externalTokenAmount: d.externalTokenAmount,
      externalTxHash: d.externalTxHash,
      stratoRecipient: d.stratoRecipient,
      targetStratoToken: d.targetStratoToken,
    });
    const recordedStandard = await recordLegacyBatch(
      externalChainId,
      eligible.filter((d) => d.kind === "standard"),
      (batch) =>
        bridgeCall("depositBatch", {
          externalChainIds: batch.map((d) => d.externalChainId),
          externalTxHashes: batch.map((d) => d.externalTxHash),
          externalTokens: batch.map((d) => d.externalToken),
          externalTokenAmounts: batch.map((d) => d.externalTokenAmount),
          stratoRecipients: batch.map((d) => d.stratoRecipient),
          externalSenders: batch.map((d) => d.externalSender),
          targetStratoTokens: batch.map((d) => d.targetStratoToken),
        }),
      (d) => bridgeCall("deposit", standardArgs(d)),
    );
    const recordedAction = await recordLegacyBatch(
      externalChainId,
      eligible.filter((d) => d.kind === "action"),
      (batch) => bridgeCall("depositBatchWithAction", buildActionDepositBatchArgs(batch)),
      (d) =>
        bridgeCall("depositWithAction", {
          ...standardArgs(d),
          action: d.action,
          actionToken: d.actionToken,
          minFinalOut: d.minFinalOut,
        }),
    );

    await verifyRecorded(externalChainId, [...recordedStandard, ...recordedAction]);
    await deps.commitOnChainCheckpoint(externalChainId, toBlock);
  };

  // Only an observed record lets the checkpoint pass a deposit
  const verifyRecorded = async (externalChainId: number, deposits: WindowDeposit[]) => {
    let missing = [...new Set(deposits.map((d) => canonicalDepositKey(d.depositKey)))];
    const deadline = Date.now() + deps.readBackTimeoutMs;
    while (missing.length > 0) {
      const found = await deps.getRecordedDepositKeys(externalChainId, missing);
      missing = missing.filter((key) => !found.has(key));
      if (missing.length === 0) return;
      if (Date.now() >= deadline) {
        throw new DepositReadBackError(externalChainId, missing);
      }
      await sleep(deps.readBackIntervalMs);
    }
  };

  /**
   * Record the deposits of one scanned block window, then move the checkpoint to toBlock.
   * Throws, leaving every checkpoint where it was, unless each deposit is observably
   * on STRATO or durably dead-lettered.
   */
  const recordWindow = async (
    externalChainId: number,
    toBlock: number,
    deposits: WindowDeposit[],
  ): Promise<void> => {
    if (deposits.length > 0) {
      if (deps.useDepositWindow) {
        await recordWithWindow(externalChainId, toBlock, deposits);
      } else {
        await recordLegacy(externalChainId, toBlock, deposits);
      }
      logInfo(
        "DepositRecorder",
        `Recorded ${deposits.length} deposits on chain ${externalChainId} through block ${toBlock}`,
      );
    }
    await deps.commitLocalCheckpoint(externalChainId, toBlock);
  };

  return { recordWindow };
};

export const depositRecorder = createDepositRecorder({
  execute,
  getRecordedDepositKeys,
  deadLetters: createDepositDeadLetterStore(),
  commitLocalCheckpoint: (chainId, block) =>
    blockTrackingService.updateLastProcessedBlockLocally(chainId, block),
  commitOnChainCheckpoint: (chainId, block) =>
    blockTrackingService.updateLastProcessedBlockOnBlockchain(chainId, block),
  bridgeAddress: config.bridge.address!,
  useDepositWindow: config.bridge.recordDepositWindow,
  readBackTimeoutMs: config.bridge.readBackTimeoutMs,
  readBackIntervalMs: config.bridge.readBackIntervalMs,
});
