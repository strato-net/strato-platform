import { mkdirSync, promises as fs } from "fs";
import path from "path";
import { ActionDepositArgs, DepositArgs } from "../types";

export type DetectedDeposit = DepositArgs | ActionDepositArgs;

export interface PendingDeposit {
  deposit: DetectedDeposit;
  status: "pending" | "review" | "settled";
  reviewReason?: string;
  reviewRecordedOnchain?: boolean;
  reviewRecordLastAttemptAt?: number;
  settlementFirstFailedAt?: number;
  settlementLastFailedAt?: number;
  settlementError?: string;
}

type DepositState = Record<string, PendingDeposit>;

const DATA_DIR = path.join(process.cwd(), "data");
const STATE_PATH = path.join(DATA_DIR, "pendingExternalDeposits.json");

mkdirSync(DATA_DIR, { recursive: true });

const identity = (deposit: DepositArgs): string =>
  [
    deposit.externalChainId,
    deposit.depositRouter.toLowerCase(),
    deposit.depositId,
  ].join(":");

const fingerprint = (deposit: DetectedDeposit): string =>
  JSON.stringify({
    externalSender: deposit.externalSender,
    externalToken: deposit.externalToken,
    observedExternalTokenAmount: deposit.observedExternalTokenAmount,
    externalTxHash: deposit.externalTxHash.toLowerCase(),
    stratoRecipient: deposit.stratoRecipient,
    targetStratoToken: deposit.targetStratoToken,
    action: "action" in deposit ? deposit.action : "0",
    actionToken: "actionToken" in deposit ? deposit.actionToken : "",
    minFinalOut: "minFinalOut" in deposit ? deposit.minFinalOut : "0",
  });

export const hasReceiptGraceExpired = (
  detectedAt: number,
  graceMs: number,
  now = Date.now(),
): boolean => now - detectedAt >= graceMs;

export const hasSettlementGraceExpired = (
  firstFailedAt: number,
  graceMs: number,
  now = Date.now(),
): boolean => now - firstFailedAt >= graceMs;

export const resetPendingForRetry = (
  pending: PendingDeposit,
  now = Date.now(),
): void => {
  pending.status = "pending";
  pending.reviewReason = undefined;
  pending.reviewRecordedOnchain = undefined;
  pending.reviewRecordLastAttemptAt = undefined;
  pending.settlementFirstFailedAt = undefined;
  pending.settlementLastFailedAt = undefined;
  pending.settlementError = undefined;
  pending.deposit.detectedAt = now;
};

export const shouldRecordReview = (
  pending: PendingDeposit,
  retryMs = 0,
  now = Date.now(),
): boolean =>
  Boolean(
    pending.reviewReason &&
      !pending.reviewRecordedOnchain &&
      (!pending.reviewRecordLastAttemptAt ||
        now - pending.reviewRecordLastAttemptAt >= retryMs),
  );

export const isPendingReorgReplacement = (
  pending: PendingDeposit,
  deposit: DetectedDeposit,
): boolean =>
  pending.status === "pending" &&
  pending.deposit.externalBlockHash !== deposit.externalBlockHash;

export const clampCursorToPending = (
  currentBlock: number,
  oldestPendingBlock?: number,
): number =>
  oldestPendingBlock === undefined
    ? currentBlock
    : Math.min(currentBlock, Math.max(0, oldestPendingBlock - 1));

let writeQueue: Promise<void> = Promise.resolve();

const readState = async (): Promise<DepositState> => {
  try {
    return JSON.parse(await fs.readFile(STATE_PATH, "utf8"));
  } catch (error: any) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
};

const updateState = async <T>(
  update: (state: DepositState) => T,
): Promise<T> => {
  let result!: T;
  const write = writeQueue.then(async () => {
    const state = await readState();
    result = update(state);
    await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2));
  });
  writeQueue = write.then(() => undefined, () => undefined);
  await write;
  return result;
};

export const depositStateService = {
  upsert: (deposit: DetectedDeposit) =>
    updateState((state) => {
      const key = identity(deposit);
      const existing = state[key];
      const relocated =
        existing &&
        existing.deposit.externalBlockHash !== deposit.externalBlockHash;
      if (existing && fingerprint(existing.deposit) !== fingerprint(deposit)) {
        if (isPendingReorgReplacement(existing, deposit)) {
          state[key] = {
            deposit,
            status: "pending",
          };
          return state[key];
        }
        existing.status = "review";
        existing.reviewReason = "Deposit identity changed after detection";
        return existing;
      }
      if (existing?.status === "settled") return existing;
      state[key] = {
        deposit: {
          ...deposit,
          detectedAt:
            relocated
              ? deposit.detectedAt
              : existing?.deposit.detectedAt || deposit.detectedAt,
        },
        status: existing?.status || "pending",
        reviewReason: existing?.reviewReason,
        reviewRecordedOnchain: existing?.reviewRecordedOnchain,
        reviewRecordLastAttemptAt: existing?.reviewRecordLastAttemptAt,
        settlementFirstFailedAt: existing?.settlementFirstFailedAt,
        settlementLastFailedAt: existing?.settlementLastFailedAt,
        settlementError: existing?.settlementError,
      };
      return state[key];
    }),

  list: async (externalChainId: number): Promise<PendingDeposit[]> =>
    Object.values(await readState()).filter(
      ({ deposit, status }) =>
        Number(deposit.externalChainId) === externalChainId &&
        status === "pending",
    ),

  listReviews: async (externalChainId: number): Promise<PendingDeposit[]> =>
    Object.values(await readState()).filter(
      ({ deposit, status }) =>
        Number(deposit.externalChainId) === externalChainId &&
        status === "review",
    ),

  getByIdentity: async (
    externalChainId: number,
    depositRouter: string,
    depositId: string,
  ): Promise<PendingDeposit | undefined> =>
    Object.values(await readState()).find(
      ({ deposit }) =>
        Number(deposit.externalChainId) === externalChainId &&
        deposit.depositRouter.replace(/^0x/i, "").toLowerCase() ===
          depositRouter.replace(/^0x/i, "").toLowerCase() &&
        deposit.depositId === depositId,
    ),

  markReceiptMissing: (deposit: DepositArgs, graceMs: number) =>
    updateState((state) => {
      const pending = state[identity(deposit)];
      if (!pending) return undefined;
      if (hasReceiptGraceExpired(pending.deposit.detectedAt, graceMs)) {
        pending.status = "review";
        pending.reviewReason = "External receipt remained unavailable";
      }
      return pending;
    }),

  markSettlementFailed: (
    deposit: DepositArgs,
    error: Error,
    graceMs: number,
  ) =>
    updateState((state) => {
      const pending = state[identity(deposit)];
      if (!pending) return undefined;
      const now = Date.now();
      const firstFailedAt = pending.settlementFirstFailedAt || now;
      pending.settlementFirstFailedAt = firstFailedAt;
      pending.settlementLastFailedAt = now;
      pending.settlementError = error.message;
      const transitioned = hasSettlementGraceExpired(
        firstFailedAt,
        graceMs,
        now,
      );
      if (transitioned) {
        pending.status = "review";
        pending.reviewReason = `STRATO settlement failed: ${error.message}`;
      }
      return { pending, transitioned };
    }),

  markSettled: (deposit: DepositArgs) =>
    updateState((state) => {
      const pending = state[identity(deposit)];
      if (pending) pending.status = "settled";
    }),

  markSettledByIdentity: (
    externalChainId: number,
    depositRouter: string,
    depositId: string,
  ) =>
    updateState((state) => {
      const normalizedRouter = depositRouter.replace(/^0x/i, "").toLowerCase();
      for (const pending of Object.values(state)) {
        if (
          Number(pending.deposit.externalChainId) === externalChainId &&
          pending.deposit.depositRouter.replace(/^0x/i, "").toLowerCase() ===
            normalizedRouter &&
          pending.deposit.depositId === depositId
        ) {
          pending.status = "settled";
        }
      }
    }),

  resetForRetryByIdentity: (
    externalChainId: number,
    depositRouter: string,
    depositId: string,
  ) =>
    updateState((state) => {
      const normalizedRouter = depositRouter.replace(/^0x/i, "").toLowerCase();
      for (const pending of Object.values(state)) {
        if (
          Number(pending.deposit.externalChainId) === externalChainId &&
          pending.deposit.depositRouter.replace(/^0x/i, "").toLowerCase() ===
            normalizedRouter &&
          pending.deposit.depositId === depositId
        ) {
          resetPendingForRetry(pending);
        }
      }
    }),

  markForReview: (deposit: DepositArgs, reviewReason: string) =>
    updateState((state) => {
      const pending = state[identity(deposit)];
      if (!pending) return;
      pending.status = "review";
      pending.reviewReason = reviewReason;
    }),

  markReviewRecorded: (deposit: DepositArgs) =>
    updateState((state) => {
      const pending = state[identity(deposit)];
      if (pending) pending.reviewRecordedOnchain = true;
    }),

  markReviewAttempted: (deposit: DepositArgs) =>
    updateState((state) => {
      const pending = state[identity(deposit)];
      if (pending) pending.reviewRecordLastAttemptAt = Date.now();
    }),

  oldestPendingBlock: async (
    externalChainId: number,
  ): Promise<number | undefined> => {
    const blocks = Object.values(await readState())
      .filter(
        ({ deposit, status }) =>
          status === "pending" &&
          Number(deposit.externalChainId) === externalChainId,
      )
      .map(({ deposit }) => deposit.externalBlockNumber);
    return blocks.length ? Math.min(...blocks) : undefined;
  },

  pruneSettled: (externalChainId: number, beforeBlock: number) =>
    updateState((state) => {
      for (const [key, pending] of Object.entries(state)) {
        if (
          pending.status === "settled" &&
          Number(pending.deposit.externalChainId) === externalChainId &&
          pending.deposit.externalBlockNumber < beforeBlock
        ) {
          delete state[key];
        }
      }
    }),
};
