import "../test/setupEnv";
import assert from "node:assert/strict";
import test from "node:test";
import { FunctionInput, NonEmptyArray, SafeTransactionData, WithdrawalInfo } from "../types";
import * as stratoHelper from "../utils/stratoHelper";
import * as safeService from "./safeService";
import * as emailService from "./emailService";
import { confirmWithdrawalBatch, proposeRecordedCustodyTxs } from "./bridgeService";
import { withdrawalProposalJournal } from "./withdrawalProposalJournal";

const MAIN_SAFE = "0x8c458f866e603335ef179a63a2528f357732f5d5";

const withdrawal = (withdrawalId: string, externalChainId: number): WithdrawalInfo => ({
  bridgeStatus: "1",
  custodyTxHash: "",
  externalChainId,
  externalRecipient: "0x2222222222222222222222222222222222222222",
  externalToken: "0x0000000000000000000000000000000000000000",
  externalTokenAmount: "1000",
  requestedAt: "0",
  stratoSender: "0x3333333333333333333333333333333333333333",
  stratoToken: "0x93fb7295859b2d70199e0a4883b7c320cf874e6c",
  stratoTokenAmount: "1000",
  timestamp: "0",
  withdrawalId,
});

let proposalCounter = 0;
const proposalFor = (w: WithdrawalInfo, nonce: number): SafeTransactionData => ({
  withdrawalId: w.withdrawalId,
  safeAddress: MAIN_SAFE,
  safeTransactionData: { nonce },
  safeTxHash: `0x${String(++proposalCounter).padStart(64, "0")}`,
  senderAddress: "0x4444444444444444444444444444444444444444",
  senderSignature: "0xsig",
  nonce,
  externalChainId: Number(w.externalChainId),
  isHot: false,
});

// Stub every side effect bridgeService reaches for
const withStubs = async (
  stubs: {
    execute: (input: FunctionInput) => Promise<void>;
    create?: (withdrawals: WithdrawalInfo[]) => SafeTransactionData[];
    onChainNonce?: number;
  },
  run: (seen: { proposed: string[]; executed: FunctionInput[]; emails: string[] }) => Promise<void>,
) => {
  const seen = { proposed: [] as string[], executed: [] as FunctionInput[], emails: [] as string[] };
  const originals = {
    execute: stratoHelper.execute,
    create: safeService.createSafeTransactions,
    propose: safeService.proposeSafeTransactions,
    nonce: safeService.getSafeOnChainNonce,
    email: emailService.default,
  };
  (stratoHelper as any).execute = async (input: FunctionInput) => {
    seen.executed.push(input);
    await stubs.execute(input);
    return { status: "Success", hash: "0xstrato" };
  };
  let nonce = 100;
  (safeService as any).createSafeTransactions = async (withdrawals: WithdrawalInfo[]) =>
    stubs.create ? stubs.create(withdrawals) : withdrawals.map((w) => proposalFor(w, nonce++));
  (safeService as any).proposeSafeTransactions = async (proposals: NonEmptyArray<SafeTransactionData>) => {
    seen.proposed.push(...proposals.map((p) => p.safeTxHash));
    return proposals.map((p) => p.safeTxHash);
  };
  (safeService as any).getSafeOnChainNonce = async () => stubs.onChainNonce ?? 0;
  (emailService as any).default = async (safeTxHash: string) => {
    seen.emails.push(safeTxHash);
  };
  try {
    await run(seen);
  } finally {
    (stratoHelper as any).execute = originals.execute;
    (safeService as any).createSafeTransactions = originals.create;
    (safeService as any).proposeSafeTransactions = originals.propose;
    (safeService as any).getSafeOnChainNonce = originals.nonce;
    (emailService as any).default = originals.email;
  }
};

test("a pending withdrawal confirmation never proposes a payout", async () => {
  const w = withdrawal("101", 1);
  await withStubs(
    {
      execute: async () => {
        throw new stratoHelper.TxPendingError(["0xconfirm"]);
      },
    },
    async (seen) => {
      await assert.rejects(() => confirmWithdrawalBatch([w]), stratoHelper.TxPendingError);
      assert.deepEqual(seen.proposed, []);
      assert.deepEqual(seen.emails, []);
    },
  );
});

test("a retry after a displaced confirmation proposes one payout, and only the recorded one", async () => {
  const w = withdrawal("102", 1);
  let attempt = 0;
  await withStubs(
    {
      execute: async () => {
        if (++attempt === 1) throw new stratoHelper.TxPendingError(["0xconfirm"]);
      },
    },
    async (seen) => {
      await assert.rejects(() => confirmWithdrawalBatch([w]), stratoHelper.TxPendingError);
      await confirmWithdrawalBatch([w]);

      const [first, second] = seen.executed.map((call) => call.args.custodyTxHashes[0]);
      assert.notEqual(first, second);
      assert.deepEqual(seen.proposed, [second]);
      assert.deepEqual(seen.emails, [second]);
      assert.ok((await withdrawalProposalJournal.get(second))?.proposedAt);
      assert.equal((await withdrawalProposalJournal.get(first))?.proposedAt, undefined);
    },
  );
});

test("withdrawal ids stay paired with their own payouts across chains", async () => {
  const withdrawals: NonEmptyArray<WithdrawalInfo> = [
    withdrawal("201", 1),
    withdrawal("202", 8453),
    withdrawal("203", 1),
  ];
  // Real proposals come back grouped by chain
  const byChain = [withdrawals[0], withdrawals[2], withdrawals[1]];
  await withStubs(
    {
      execute: async () => undefined,
      create: () => byChain.map((w, i) => proposalFor(w, 300 + i)),
    },
    async (seen) => {
      await confirmWithdrawalBatch(withdrawals);
      const { ids, custodyTxHashes } = seen.executed[0].args;
      assert.deepEqual(ids, ["201", "203", "202"]);
      for (const [i, id] of ids.entries()) {
        assert.equal((await withdrawalProposalJournal.get(custodyTxHashes[i]))?.withdrawalId, id);
      }
    },
  );
});

test("an already-confirmed batch proposes nothing", async () => {
  await withStubs(
    {
      execute: async () => {
        throw new Error("solidity require failed: MB: bad state");
      },
    },
    async (seen) => {
      await confirmWithdrawalBatch([withdrawal("301", 1)]);
      assert.deepEqual(seen.proposed, []);
    },
  );
});

test("a recorded custody tx the Safe never received is proposed from the saved copy", async () => {
  const w = withdrawal("401", 1);
  const saved = proposalFor(w, 50);
  await withdrawalProposalJournal.record([{ withdrawalId: w.withdrawalId, proposal: saved }]);

  await withStubs({ execute: async () => undefined, onChainNonce: 50 }, async (seen) => {
    const unexecutable = await proposeRecordedCustodyTxs(
      [{ id: 401, safeTxHash: saved.safeTxHash.toUpperCase().replace("0X", "0x") }],
      1,
    );
    assert.deepEqual(unexecutable, []);
    assert.deepEqual(seen.proposed, [saved.safeTxHash]);
    assert.ok((await withdrawalProposalJournal.get(saved.safeTxHash))?.proposedAt);
  });
});

test("a recorded custody tx whose Safe nonce was used elsewhere is handed back for abort", async () => {
  const w = withdrawal("402", 1);
  const saved = proposalFor(w, 50);
  await withdrawalProposalJournal.record([{ withdrawalId: w.withdrawalId, proposal: saved }]);

  await withStubs({ execute: async () => undefined, onChainNonce: 51 }, async (seen) => {
    const unexecutable = await proposeRecordedCustodyTxs([{ id: 402, safeTxHash: saved.safeTxHash }], 1);
    assert.deepEqual(unexecutable, [402]);
    assert.deepEqual(seen.proposed, []);
  });
});

test("an unknown custody tx is left for manual resolution", async () => {
  await withStubs({ execute: async () => undefined }, async (seen) => {
    const unexecutable = await proposeRecordedCustodyTxs([{ id: 403, safeTxHash: `0x${"99".repeat(32)}` }], 1);
    assert.deepEqual(unexecutable, []);
    assert.deepEqual(seen.proposed, []);
  });
});

test("the journal forgets finished withdrawals and stale unproposed payouts", async () => {
  const finished = proposalFor(withdrawal("501", 1), 60);
  const stale = proposalFor(withdrawal("502", 1), 61);
  const live = proposalFor(withdrawal("503", 1), 62);
  await withdrawalProposalJournal.record([
    { withdrawalId: "501", proposal: finished },
    { withdrawalId: "502", proposal: stale },
    { withdrawalId: "503", proposal: live },
  ]);
  await withdrawalProposalJournal.markProposed([live.safeTxHash]);

  await withdrawalProposalJournal.prune(["501"], Date.now() + 2 * 24 * 60 * 60 * 1000);

  assert.equal(await withdrawalProposalJournal.get(finished.safeTxHash), undefined);
  assert.equal(await withdrawalProposalJournal.get(stale.safeTxHash), undefined);
  assert.ok(await withdrawalProposalJournal.get(live.safeTxHash));
});
