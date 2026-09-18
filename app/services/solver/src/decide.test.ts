import assert from "node:assert/strict";
import test from "node:test";

process.env.SOLVER_PRIVATE_KEY =
  process.env.SOLVER_PRIVATE_KEY ||
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
process.env.SOLVER_DRY_RUN = "true";

import { decide } from "./index";
import { DepositCandidate } from "./discovery";
import { config } from "./config";

const T0 = 1_000_000n;
const AMOUNT = 1000n * 10n ** 18n;
const HALF_LIFE = 21600n;

const candidate = (over: Partial<DepositCandidate> = {}): DepositCandidate => ({
  kind: "mercata",
  externalChainId: "11155111",
  externalTxHash: "0xabc",
  recipient: "1111111111111111111111111111111111111111",
  token: "937efa7e3a77e20bbdbd7c0d32b6514f368c1010",
  amount: AMOUNT,
  // 3% offered, inside the bridge's 5% cap
  schedule: { maxFee: 30n * 10n ** 18n, requestedAt: T0, feeHalfLife: HALF_LIFE },
  verification: "relayer-posted",
  ...over,
});

const RICH = AMOUNT * 10n;

/**
 * An announced deposit is a stranger's unverified claim. Filling one without
 * independent proof is a donation, not a trade, so it must be opt-in.
 */
test("refuses an announced-only deposit unless explicitly enabled", () => {
  const c = candidate({ verification: "announced-only" });
  const before = config.policy.fillAnnounced;

  config.policy.fillAnnounced = false;
  assert.equal(decide(c, T0, RICH, 0n).fill, false);
  assert.match(decide(c, T0, RICH, 0n).reason, /unverified/);

  config.policy.fillAnnounced = true;
  assert.equal(decide(c, T0, RICH, 0n).fill, true, "opt-in should allow it");
  config.policy.fillAnnounced = before;
});

/**
 * The quote is deliberately for a moment in the FUTURE. The contract guard is a
 * floor and the fee decays, so quoting ahead means the fee at landing is higher
 * than quoted and the guard passes. Quoting the present value sits on the
 * boundary and fails on any delay.
 */
test("quotes the fee ahead of now, never at now", () => {
  const c = candidate();
  const d = decide(c, T0, RICH, 0n);
  assert.equal(d.fill, true);

  const atNow = 30n * 10n ** 18n; // full fee at the request instant
  assert.ok(
    d.expectedFee! < atNow,
    "quote must be below the present fee so decay cannot trip the floor",
  );
  assert.equal(d.netToPay, AMOUNT - d.expectedFee!);
});

test("refuses a fee under the policy floor, and once it has decayed away", () => {
  const c = candidate();
  const before = config.policy.minFeeBps;

  config.policy.minFeeBps = 400n; // demand 4% when only 3% is offered
  const thin = decide(c, T0, RICH, 0n);
  assert.equal(thin.fill, false);
  assert.match(thin.reason, /under the 400bps floor/);
  config.policy.minFeeBps = before;

  // Past the three-day window the fee is exactly zero, so there is nothing to earn.
  const stale = decide(c, T0 + 259200n, RICH, 0n);
  assert.equal(stale.fill, false);
  assert.match(stale.reason, /decayed to zero/);
});

/**
 * USDST doubles as gas on STRATO, so spending through the reserve does not just
 * stop fills -- it strands the solver with no way to transact at all.
 */
test("will not spend a token below its reserve", () => {
  const c = candidate();
  const d = decide(c, T0, AMOUNT, AMOUNT / 2n);
  assert.equal(d.fill, false);
  assert.match(d.reason, /under reserve/);

  assert.equal(decide(c, T0, RICH, AMOUNT / 2n).fill, true, "ample balance is fine");
});

test("respects the claim ladder's consent and price", () => {
  const held = candidate({ claimant: "2222222222222222222222222222222222222222" });

  const notForSale = decide({ ...held, claimTransferable: false }, T0, RICH, 0n);
  assert.equal(notForSale.fill, false);
  assert.match(notForSale.reason, /not for sale/);

  // For sale at 1% of the amount: taken at the holder's price, not the schedule's.
  const forSale = decide(
    { ...held, claimTransferable: true, claimExitFee: AMOUNT / 100n },
    T0, RICH, 0n,
  );
  assert.equal(forSale.fill, true);
  assert.equal(forSale.expectedFee, AMOUNT / 100n, "must pay the holder's asking price");
  assert.equal(forSale.netToPay, AMOUNT - AMOUNT / 100n);
});

test("refuses a voided claim and an incomplete record", () => {
  assert.equal(decide(candidate({ claimVoided: true }), T0, RICH, 0n).fill, false);
  assert.equal(decide(candidate({ amount: 0n }), T0, RICH, 0n).fill, false);
  assert.equal(decide(candidate({ token: "" }), T0, RICH, 0n).fill, false);
});
