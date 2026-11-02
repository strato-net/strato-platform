const LEGACY_STATUS = Object.freeze({
  NONE: "0",
  INITIATED: "1",
  PENDING_REVIEW: "2",
  COMPLETED: "3",
  ABORTED: "4",
  SWEPT: "5",
  QUARANTINED: "6",
});

const uint = (value, field) => {
  if (!/^\d+$/.test(String(value))) throw new Error(`${field} must be an unsigned decimal string`);
  return BigInt(value);
};

const address = value => {
  const normalized = String(value).toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{40}$/.test(normalized)) throw new Error(`Invalid external token address ${value}`);
  return `0x${normalized}`;
};

const keyFor = (chainId, token) => `${chainId}:${address(token)}`;
const statusFor = violations => violations.some(item => item.severity === "failed")
  ? "FAILED" : violations.length ? "REVIEW_REQUIRED" : "PASSED";

function reconcileBacking(input) {
  const deposits = new Map();
  const withdrawals = new Map();
  const balances = new Map();
  const routeKeys = new Set();
  for (const flow of input.deposits) {
    const key = keyFor(flow.chainId, flow.externalToken);
    deposits.set(key, (deposits.get(key) || 0n) + uint(flow.amount, `deposit ${flow.id} amount`));
    routeKeys.add(key);
  }
  for (const flow of input.withdrawals) {
    const key = keyFor(flow.chainId, flow.externalToken);
    withdrawals.set(key, (withdrawals.get(key) || 0n) + uint(flow.amount, `withdrawal ${flow.id} amount`));
    routeKeys.add(key);
  }
  for (const balance of input.balances) {
    const key = keyFor(balance.chainId, balance.externalToken);
    if (balances.has(key)) throw new Error(`Duplicate custody balance for ${key}`);
    balances.set(key, balance);
    routeKeys.add(key);
  }

  const violations = [...(input.violations || [])];
  const routes = [...routeKeys].sort().map(key => {
    const [chainId, externalToken] = key.split(":");
    const inflows = deposits.get(key) || 0n;
    const payouts = withdrawals.get(key) || 0n;
    const expected = inflows - payouts;
    const balance = balances.get(key);
    const observed = balance
      ? uint(balance.mainSafe, `${key} custody balance`) + uint(balance.hotSafe, `${key} hot-wallet balance`)
      : 0n;
    const retained = balance ? uint(balance.retained, `${key} retained reserve`) : 0n;
    const available = observed - retained;
    const delta = available - expected;
    const routeViolations = [];
    if (expected < 0n) routeViolations.push({
      code: "NEGATIVE_EXPECTED_BACKING", severity: "failed", chainId, externalToken,
      detail: `Verified payouts exceed completed deposit inflows by ${(-expected).toString()}`,
    });
    if (!balance) routeViolations.push({
      code: "CUSTODY_BALANCE_MISSING", severity: "failed", chainId, externalToken,
      detail: "No pinned custody balance was collected for this route",
    });
    else if (available < 0n) routeViolations.push({
      code: "RETAINED_RESERVE_EXCEEDS_CUSTODY", severity: "failed", chainId, externalToken,
      detail: `Retained reserve exceeds observed custody by ${(-available).toString()}`,
    });
    else if (delta < 0n) routeViolations.push({
      code: "CUSTODY_DEFICIT", severity: "failed", chainId, externalToken,
      detail: `Adjusted custody is below expected backing by ${(-delta).toString()}`,
    });
    else if (delta > 0n) routeViolations.push({
      code: "UNEXPLAINED_CUSTODY_EXCESS", severity: "review", chainId, externalToken,
      detail: `Adjusted custody exceeds expected backing by ${delta.toString()}`,
    });
    violations.push(...routeViolations);
    return {
      chainId,
      externalToken,
      completedDepositInflows: inflows.toString(),
      completedWithdrawalPayouts: payouts.toString(),
      expectedBacking: expected.toString(),
      observedCustody: observed.toString(),
      retainedReserve: retained.toString(),
      availableToMigrate: available.toString(),
      proposedMigrationAmount: expected < 0n ? "0" : expected.toString(),
      unexplainedDelta: delta.toString(),
      status: statusFor(routeViolations),
    };
  });
  return { status: statusFor(violations), routes, violations };
}

module.exports = { LEGACY_STATUS, reconcileBacking };
