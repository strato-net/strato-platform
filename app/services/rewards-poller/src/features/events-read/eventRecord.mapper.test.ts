import assert from "node:assert/strict";
import test from "node:test";
import { RewardsAction } from "../../shared/types";
import { splitIntoBatches } from "./eventRecord.mapper";

const action = (eventIndex: number, recipient?: string): RewardsAction => ({
  sourceContract: "1111111111111111111111111111111111111111",
  eventName: recipient ? "Transfer" : "Deposit",
  user: "2222222222222222222222222222222222222222",
  recipient,
  amount: "1",
  blockNumber: 100,
  block_timestamp: "2026-09-03 12:00:00 UTC",
  eventIndex,
});

test("keeps batches contiguous, homogeneous and within the size limit", () => {
  const recipient = "3333333333333333333333333333333333333333";
  const batches = splitIntoBatches(
    [action(1), action(2), action(3), action(4, recipient), action(5, recipient), action(6), action(7)],
    2
  );

  assert.deepEqual(
    batches.map((batch) => batch.map((item) => item.eventIndex)),
    [[1, 2], [3], [4, 5], [6, 7]]
  );
});

test("returns no batches for no actions", () => {
  assert.deepEqual(splitIntoBatches([], 50), []);
});
