import assert from "node:assert/strict";
import test from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DepositArgs } from "../types";

test("persists deposit state atomically and orders reads after pending writes", async (t) => {
  const previousDirectory = process.cwd();
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "deposit-state-")));
  process.chdir(directory);
  const { depositStateService: service } = await import("./depositStateService");
  const statePath = path.join(directory, "data/pendingExternalDeposits.json");
  const deposit: DepositArgs = {
    externalChainId: 1, depositRouter: "router", depositId: "1",
    externalSender: "sender", externalToken: "token", externalTokenAmount: "100",
    observedExternalTokenAmount: "100", externalTxHash: "tx", externalBlockHash: "block",
    externalBlockNumber: 10, externalBlockTimestamp: 1, externalLogIndex: 1,
    detectedAt: 1, stratoRecipient: "recipient", targetStratoToken: "target",
  };
  const originalRename = fs.rename;
  try {
    await service.upsert(deposit);
    const originalState = await fs.readFile(statePath, "utf8");
    let reachedRename!: () => void;
    const renaming = new Promise<void>((resolve) => { reachedRename = resolve; });
    let resume!: () => void;
    const blocked = new Promise<void>((resolve) => { resume = resolve; });
    fs.rename = async (from, to) => {
      assert.equal(to, statePath);
      assert.equal(JSON.parse(await fs.readFile(from, "utf8"))["1:router:1"].status, "review");
      reachedRename();
      await blocked;
      await originalRename(from, to);
    };
    const write = service.markForReview(deposit, "review required");
    await renaming;
    assert.equal(await fs.readFile(statePath, "utf8"), originalState);
    let readFinished = false;
    const read = service.listReviews(1).then((rows) => { readFinished = true; return rows; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(readFinished, false);
    resume();
    await write;
    assert.equal((await read)[0].reviewReason, "review required");
    assert.equal(await service.oldestPendingBlock(1), 10);

    fs.rename = async () => { throw new Error("simulated interruption before rename"); };
    await assert.rejects(service.markSettled(deposit), /simulated interruption/);
    assert.equal((await service.listReviews(1)).length, 1);
    assert.deepEqual(await fs.readdir(path.dirname(statePath)), [path.basename(statePath)]);
    fs.rename = originalRename;
    await service.markReviewRecorded(deposit);
    assert.equal(await service.oldestPendingBlock(1), undefined);
    await Promise.all([service.upsert({ ...deposit, depositId: "2" }), service.upsert({ ...deposit, depositId: "3" })]);
    assert.equal((await service.list(1)).length, 2);

    // An interrupted temporary write must not replace committed review metadata on restart.
    await fs.writeFile(`${statePath}.interrupted.tmp`, '{"partial":');
    delete require.cache[require.resolve("./depositStateService")];
    const restarted = require("./depositStateService").depositStateService;
    assert.equal((await restarted.listReviews(1))[0].reviewReason, "review required");
    assert.equal((await restarted.list(1)).length, 2);
    await restarted.markSettled(deposit);
    await restarted.pruneSettled(1, 1000);
    assert.equal((await restarted.getByIdentity(1, "router", "1")).status, "settled", "Keep tombstone until indexed completion");
    await restarted.restoreRecordedReview(deposit);
    assert.equal((await restarted.listReviews(1)).length, 0, "Lagging Cirrus review must not resurrect settled state");

    await t.test("conflicting rescans preserve settled deposits before and after indexing", async () => {
      const settledDeposit = { ...deposit, depositId: "5" };
      await restarted.upsert(settledDeposit);
      await restarted.markSettled(settledDeposit);
      for (const indexed of [false, true]) {
        if (indexed) await restarted.markIndexedSettlements(1, [settledDeposit]);
        const original = await restarted.getByIdentity(1, "router", "5");
        for (const externalBlockHash of [deposit.externalBlockHash, "different-block"]) {
          const result = await restarted.upsert({
            ...settledDeposit, externalBlockHash, observedExternalTokenAmount: "999",
            externalTxHash: "conflicting-tx", detectedAt: 999,
          });
          assert.deepEqual(result, original);
          assert.deepEqual(JSON.parse(await fs.readFile(statePath, "utf8"))["1:router:5"], original);
        }
      }
      assert.equal((await restarted.listReviews(1)).length, 0);
    });

    await t.test("unsettled conflicts still enter review and pending reorg replacements remain retryable", async () => {
      const conflicting = { ...deposit, depositId: "2", observedExternalTokenAmount: "999" };
      assert.equal((await restarted.upsert(conflicting)).status, "review");
      const replacement = { ...deposit, depositId: "3", externalBlockHash: "replacement-block", observedExternalTokenAmount: "999" };
      const result = await restarted.upsert(replacement);
      assert.equal(result.status, "pending");
      assert.deepEqual(result.deposit, replacement);
    });

    let now = 10_000;
    t.mock.method(Date, "now", () => now);
    const traceDeposit = { ...deposit, depositId: "4", detectedAt: now };
    await restarted.upsert(traceDeposit);
    const reason = "External trace remained unavailable: RPC providers disagree";
    now += 999;
    assert.equal((await restarted.markReceiptMissing(traceDeposit, 1000, reason)).status, "pending");
    now++;
    const reviewed = await restarted.markReceiptMissing(traceDeposit, 1000, reason);
    assert.equal(reviewed.status, "review");
    assert.equal(reviewed.reviewReason, reason);
    const persisted = JSON.parse(await fs.readFile(statePath, "utf8"))["1:router:4"];
    assert.equal(persisted.status, "review");
    assert.equal(persisted.reviewReason, reason);
    await restarted.markReviewRecorded(traceDeposit);
    assert.equal((await restarted.getByIdentity(1, "router", "4")).reviewRecordedOnchain, true);
  } finally {
    fs.rename = originalRename;
    process.chdir(previousDirectory);
  }
});
