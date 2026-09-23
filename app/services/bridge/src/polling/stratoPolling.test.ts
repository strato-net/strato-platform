import "../test/setupEnv";
import assert from "node:assert/strict";
import test from "node:test";
import { WithdrawalInfo } from "../types";
import * as cirrusService from "../services/cirrusService";
import * as safeService from "../services/safeService";
import * as bridgeService from "../services/bridgeService";
import { processPendingWithdrawals } from "./stratoPolling";

const pendingWithdrawal = (withdrawalId: string, custodyTxHash: string): WithdrawalInfo => ({
  bridgeStatus: "2",
  custodyTxHash,
  externalChainId: "1",
  externalRecipient: "f951a1ab8052ff43ab83436afdcc0ae385b66e56",
  externalToken: "a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  externalTokenAmount: "150000000",
  requestedAt: "0",
  stratoSender: "f951a1ab8052ff43ab83436afdcc0ae385b66e56",
  stratoToken: "6aeacaa19c68e53035bf495d15e0a328fc600ba8",
  stratoTokenAmount: "150000000000000000000",
  timestamp: "0",
  withdrawalId,
});

const withPollStubs = async (
  stubs: {
    pending: WithdrawalInfo[];
    eventHashes?: Record<string, string | null>;
    statuses?: Record<string, safeService.SafeTxStatus>;
  },
  run: (seen: {
    eventLookups: string[][];
    monitored: string[];
    finalized: number[];
    aborted: number[];
  }) => Promise<void>,
) => {
  const seen = {
    eventLookups: [] as string[][],
    monitored: [] as string[],
    finalized: [] as number[],
    aborted: [] as number[],
  };
  const originals = {
    byStatus: cirrusService.getWithdrawalsByStatus,
    events: cirrusService.getSafeTxHashFromEvents,
    monitor: safeService.monitorSafeTransactionStatusBatch,
    finalize: bridgeService.finaliseWithdrawalBatch,
    abort: bridgeService.handleRejectedWithdrawalBatch,
  };
  (cirrusService as any).getWithdrawalsByStatus = async () => stubs.pending;
  (cirrusService as any).getSafeTxHashFromEvents = async (ids: string[]) => {
    seen.eventLookups.push(ids);
    return Object.fromEntries(ids.map((id) => [id, stubs.eventHashes?.[id] ?? null]));
  };
  (safeService as any).monitorSafeTransactionStatusBatch = async (
    withdrawals: Array<{ id: number; safeTxHash: string }>,
  ) => {
    seen.monitored.push(...withdrawals.map((w) => w.safeTxHash));
    return new Map(withdrawals.map((w) => [w.id, stubs.statuses?.[w.safeTxHash] ?? "pending"]));
  };
  (bridgeService as any).finaliseWithdrawalBatch = async (ids: number[]) => {
    seen.finalized.push(...ids);
  };
  (bridgeService as any).handleRejectedWithdrawalBatch = async (ids: number[]) => {
    seen.aborted.push(...ids);
  };
  try {
    await run(seen);
  } finally {
    (cirrusService as any).getWithdrawalsByStatus = originals.byStatus;
    (cirrusService as any).getSafeTxHashFromEvents = originals.events;
    (safeService as any).monitorSafeTransactionStatusBatch = originals.monitor;
    (bridgeService as any).finaliseWithdrawalBatch = originals.finalize;
    (bridgeService as any).handleRejectedWithdrawalBatch = originals.abort;
  }
};

test("the custody tx comes from the withdrawal record, without an event lookup", async () => {
  await withPollStubs(
    {
      pending: [pendingWithdrawal("801", "0xrecorded")],
      statuses: { "0xrecorded": "executed" },
    },
    async (seen) => {
      await processPendingWithdrawals();
      assert.deepEqual(seen.eventLookups, []);
      assert.deepEqual(seen.monitored, ["0xrecorded"]);
      assert.deepEqual(seen.finalized, [801]);
      assert.deepEqual(seen.aborted, []);
    },
  );
});

test("a withdrawal with no custody tx hash anywhere is never refunded", async () => {
  await withPollStubs(
    { pending: [pendingWithdrawal("802", "")] },
    async (seen) => {
      await processPendingWithdrawals();
      assert.deepEqual(seen.eventLookups, [["802"]]);
      assert.deepEqual(seen.monitored, []);
      assert.deepEqual(seen.aborted, []);
      assert.deepEqual(seen.finalized, []);
    },
  );
});

test("the event table fills in a hash the record lacks", async () => {
  await withPollStubs(
    {
      pending: [pendingWithdrawal("803", ""), pendingWithdrawal("804", "0xrecorded")],
      eventHashes: { "803": "0xfromevent" },
      statuses: { "0xfromevent": "rejected", "0xrecorded": "pending" },
    },
    async (seen) => {
      await processPendingWithdrawals();
      assert.deepEqual(seen.eventLookups, [["803"]]);
      assert.deepEqual(seen.monitored.sort(), ["0xfromevent", "0xrecorded"]);
      assert.deepEqual(seen.aborted, [803]);
      assert.deepEqual(seen.finalized, []);
    },
  );
});
