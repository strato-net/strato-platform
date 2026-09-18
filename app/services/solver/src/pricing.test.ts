import assert from "node:assert/strict";
import test from "node:test";
import {
  decayedFee,
  feeReachesAt,
  isFeeCapAllowed,
  isHalfLifeAllowed,
  DECAY_WINDOW_SECONDS,
} from "./pricing";

/**
 * THE SAME VECTORS THE CONTRACTS ASSERT.
 *
 * These constants also appear in:
 *   app/contracts/tests/Bridge/BridgeFastPath.test.sol  (SolidVM / BridgeFees)
 *   app/ethereum/test/BridgeFeeDecay.test.js            (Solidity / BridgeFeeDecay)
 *
 * The solver passes `expectedFee` into every fill and the contract reverts on a
 * mismatch, so a divergence here is not a mispricing -- it is a bot that never
 * fills. If a vector changes in one place it has to change in all three.
 */
const HALF_LIFE = 21600n; // six hours: twelve halvings across the window
const FEE = 3n * 10n ** 18n;
const T0 = 1_000_000n;
const s = (over: Partial<{ maxFee: bigint; requestedAt: bigint; feeHalfLife: bigint }> = {}) => ({
  maxFee: FEE,
  requestedAt: T0,
  feeHalfLife: HALF_LIFE,
  ...over,
});

test("reproduces the shared decay vectors exactly", () => {
  assert.equal(DECAY_WINDOW_SECONDS, 259200n);

  assert.equal(decayedFee(s(), T0), 3000000000000000000n, "at the request");
  assert.equal(decayedFee(s(), T0 - 500n), 3000000000000000000n, "clock skew keeps the full fee");
  assert.equal(decayedFee(s(), T0 + HALF_LIFE), 1500000000000000000n, "one half-life");
  assert.equal(decayedFee(s(), T0 + 2n * HALF_LIFE), 750000000000000000n, "two half-lives");
  assert.equal(decayedFee(s(), T0 + HALF_LIFE / 2n), 2250000000000000000n, "mid half-life");
  assert.equal(decayedFee(s(), T0 + 1n), 2999930555555555555n, "one second in");
  assert.equal(decayedFee(s(), T0 + 259199n), 732455783420138n, "one second before the window");
  assert.equal(decayedFee(s(), T0 + 259200n), 0n, "exactly at the window");
  assert.equal(decayedFee(s(), T0 + 259200n + 1000000n), 0n, "past the window");
  assert.equal(decayedFee(s({ maxFee: 0n }), T0 + 10n), 0n, "no fee offered");
  assert.equal(decayedFee(s({ feeHalfLife: 0n }), T0 + 10n), 0n, "no half-life");
  assert.equal(decayedFee(s({ maxFee: 7n }), T0 + 11n * HALF_LIFE), 0n, "a dust fee shifts away");
  assert.equal(decayedFee(s({ feeHalfLife: 1n }), T0 + 200n), 0n, "a one-second half-life");
  assert.equal(
    decayedFee(s({ maxFee: 3n * 10n ** 6n }), T0 + HALF_LIFE / 2n),
    2250000n,
    "a six-decimal token scales the same way",
  );
});

test("never increases, and is zero exactly at the window", () => {
  let previous = FEE + 1n;
  for (let e = 0n; e < DECAY_WINDOW_SECONDS; e += 617n) {
    const current = decayedFee(s(), T0 + e);
    assert.ok(current <= previous, `fee rose at elapsed ${e}`);
    assert.ok(current > 0n, `fee hit zero early at elapsed ${e}`);
    previous = current;
  }
  assert.equal(decayedFee(s(), T0 + DECAY_WINDOW_SECONDS), 0n);
});

test("halves at each boundary until the window truncates the last sliver", () => {
  let expected = FEE;
  for (let n = 0n; n <= 11n; n++) {
    assert.equal(decayedFee(s(), T0 + n * HALF_LIFE), expected, `halving ${n}`);
    expected /= 2n;
  }
  // The twelfth boundary IS the window: the geometric series would still pay
  // maxFee/4096 three days late, and the window is what makes "decays to zero"
  // literal rather than asymptotic.
  assert.equal(expected, FEE / 4096n);
  assert.equal(decayedFee(s(), T0 + 12n * HALF_LIFE), 0n);
});

test("bounds the fee cap and the half-life like the contracts do", () => {
  const hundred = 100n * 10n ** 18n;
  assert.equal(isFeeCapAllowed(0n, hundred, 500n), true);
  assert.equal(isFeeCapAllowed(5n * 10n ** 18n, hundred, 500n), true);
  assert.equal(isFeeCapAllowed(6n * 10n ** 18n, hundred, 500n), false);
  assert.equal(isFeeCapAllowed(1n, hundred, 0n), false);
  assert.equal(isFeeCapAllowed(hundred, hundred, 10000n), false);
  assert.equal(isFeeCapAllowed(1n, 0n, 10000n), false);

  assert.equal(isHalfLifeAllowed(1n), true);
  assert.equal(isHalfLifeAllowed(DECAY_WINDOW_SECONDS), true);
  assert.equal(isHalfLifeAllowed(0n), false);
  assert.equal(isHalfLifeAllowed(DECAY_WINDOW_SECONDS + 1n), false);
});

/** The scheduling helper has to agree with the curve it is inverting. */
test("feeReachesAt lands on the first second at or below the target", () => {
  for (const target of [FEE / 2n, FEE / 4n, FEE / 1000n, 0n]) {
    const at = feeReachesAt(s(), target);
    assert.ok(at !== null, `no crossing found for ${target}`);
    assert.ok(decayedFee(s(), at!) <= target, `fee above target at the crossing (${target})`);
    if (at! > T0) {
      assert.ok(
        decayedFee(s(), at! - 1n) > target,
        `crossing was not the FIRST such second (${target})`,
      );
    }
  }
  assert.equal(feeReachesAt(s(), FEE), T0, "a target at the ceiling is met immediately");
});
