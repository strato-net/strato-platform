import "../test/setupEnv";
import assert from "node:assert/strict";
import test from "node:test";
import { config } from "../config";
import { bloc } from "./api";
import { postAndWaitForTx, TxPendingError } from "./stratoHelper";

config.strato.polling.defaultInterval = 1;

const withResults = async <T>(results: (hashes: string[]) => any[], run: () => Promise<T>) => {
  const original = (bloc as any).post;
  (bloc as any).post = async (_url: string, hashes: string[]) => results(hashes);
  try {
    return await run();
  } finally {
    (bloc as any).post = original;
  }
};

const posted = (...statuses: string[]) => async () =>
  statuses.map((status, i) => ({ hash: `h${i + 1}`, status }));

test("a transaction still pending at the deadline is an error, never a result", async () => {
  await withResults(
    (hashes) => hashes.map((hash) => ({ hash, status: "Pending" })),
    async () => {
      await assert.rejects(
        () => postAndWaitForTx(posted("Pending"), 20),
        (error: unknown) =>
          error instanceof TxPendingError && error.hashes.join() === "h1",
      );
    },
  );
});

test("resolves once a pending transaction succeeds", async () => {
  let polls = 0;
  await withResults(
    (hashes) => hashes.map((hash) => ({ hash, status: ++polls > 2 ? "Success" : "Pending" })),
    async () => {
      assert.deepEqual(await postAndWaitForTx(posted("Pending"), 1_000), {
        status: "Success",
        hash: "h1",
      });
    },
  );
});

test("an immediate failure keeps the node's revert reason", async () => {
  const post = async () => [
    {
      hash: "h1",
      status: "Failure",
      txResult: { message: "solidity require failed: MB: route not enabled" },
    },
  ];
  await assert.rejects(() => postAndWaitForTx(post, 20), /MB: route not enabled/);
});

test("a polled failure keeps the node's revert reason", async () => {
  await withResults(
    (hashes) =>
      hashes.map((hash) => ({
        hash,
        status: "Failure",
        txResult: { status: { details: "solidity require failed: MB: duplicate deposit" } },
      })),
    async () => {
      await assert.rejects(
        () => postAndWaitForTx(posted("Pending"), 1_000),
        /MB: duplicate deposit/,
      );
    },
  );
});

test("a mempool eviction surfaces as a failure with its reason", async () => {
  await withResults(
    (hashes) =>
      hashes.map((hash) => ({
        hash,
        status: "Failure",
        txResult: {
          message: "Rejected from mempool at Promotion/Pending due to abc being a more lucrative transaction",
          status: { stage: "Promotion", type: { tag: "TrumpedByMoreLucrative" } },
        },
      })),
    async () => {
      await assert.rejects(
        () => postAndWaitForTx(posted("Pending"), 1_000),
        /more lucrative/,
      );
    },
  );
});

test("a multi-transaction post succeeds only when every transaction did", async () => {
  await withResults(
    (hashes) => hashes.map((hash) => ({ hash, status: "Success" })),
    async () => {
      assert.equal((await postAndWaitForTx(posted("Success", "Pending"), 1_000)).status, "Success");
    },
  );

  await withResults(
    (hashes) => hashes.map((hash, i) => ({ hash, status: i === 0 ? "Success" : "Pending" })),
    async () => {
      await assert.rejects(
        () => postAndWaitForTx(posted("Success", "Pending"), 20),
        (error: unknown) =>
          error instanceof TxPendingError && error.hashes.join() === "h2",
      );
    },
  );
});

test("a short result list is treated as unresolved", async () => {
  await withResults(
    () => [{ hash: "h1", status: "Success" }],
    async () => {
      await assert.rejects(
        () => postAndWaitForTx(posted("Pending", "Pending"), 20),
        (error: unknown) =>
          error instanceof TxPendingError && error.hashes.join() === "h2",
      );
    },
  );
});
