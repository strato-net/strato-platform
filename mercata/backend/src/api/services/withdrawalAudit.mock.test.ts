import assert from "node:assert/strict";

type MockLot = {
  status: "clean" | "tainted" | "unknown";
  amount: bigint;
};

const classifyCoverage = (lots: MockLot[], requested: bigint) => {
  let remaining = requested;
  let clean = 0n;
  let tainted = 0n;
  let unknown = 0n;

  for (const lot of lots) {
    if (remaining <= 0n) break;
    const used = lot.amount > remaining ? remaining : lot.amount;
    remaining -= used;
    if (lot.status === "clean") clean += used;
    else if (lot.status === "tainted") tainted += used;
    else unknown += used;
  }

  if (remaining > 0n) unknown += remaining;

  const decision = tainted > 0n
    ? "REJECT"
    : clean >= requested && unknown === 0n
      ? "APPROVE"
      : "MANUAL_REVIEW";

  return { clean, tainted, unknown, decision };
};

export const runWithdrawalAuditMockTests = () => {
  assert.deepEqual(
    classifyCoverage([{ status: "clean", amount: 700n }], 700n),
    { clean: 700n, tainted: 0n, unknown: 0n, decision: "APPROVE" },
  );

  assert.deepEqual(
    classifyCoverage([{ status: "tainted", amount: 700n }], 700n),
    { clean: 0n, tainted: 700n, unknown: 0n, decision: "REJECT" },
  );

  assert.deepEqual(
    classifyCoverage([{ status: "clean", amount: 600n }, { status: "unknown", amount: 300n }], 900n),
    { clean: 600n, tainted: 0n, unknown: 300n, decision: "MANUAL_REVIEW" },
  );
};

runWithdrawalAuditMockTests();
