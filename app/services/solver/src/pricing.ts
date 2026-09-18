/**
 * The solver's copy of the bridge fee schedule.
 *
 * THIS MUST AGREE WITH THE CONTRACTS EXACTLY, to the wei. Both `fillDeposit`
 * and `fillWithdrawal` take an `expectedFee` and revert unless it equals what
 * the contract computes for the same schedule at the same block timestamp. A
 * solver whose arithmetic is one wei out does not misprice -- it simply never
 * fills anything, and the failure looks like the bot being broken rather than
 * the number being wrong.
 *
 * Ported line for line from app/contracts/libraries/Bridge/BridgeFees.sol and
 * app/ethereum/contracts/bridge/BridgeFeeDecay.sol, which are themselves kept
 * identical to each other. The shared vectors in pricing.test.ts are the same
 * ones asserted in both contract test suites; if they pass here, all three
 * implementations agree.
 *
 * All arithmetic is BigInt for the same reason: a Number cannot hold a
 * token amount, and a float would round where the contract truncates.
 */

/** The capturable fee reaches exactly zero three days after the request. */
export const DECAY_WINDOW_SECONDS = 259200n;

/** Past this many halvings the shift has driven any real amount to zero. */
export const MAX_HALVINGS = 128n;

export const BPS_DENOMINATOR = 10000n;

export interface FeeSchedule {
  maxFee: bigint;
  requestedAt: bigint;
  feeHalfLife: bigint;
}

/**
 * What a solver may keep for filling at `at` a request made at `requestedAt`.
 *
 * Exponential decay by repeated halving with a straight line across each
 * partial half-life, and the deduction rounded UP so truncation can only move
 * the fee down. The quotient/remainder split avoids a wide product, matching
 * the contracts rather than being an optimisation here.
 */
export function decayedFee(schedule: FeeSchedule, at: bigint): bigint {
  const { maxFee, requestedAt, feeHalfLife: halfLife } = schedule;

  if (maxFee === 0n) return 0n;
  if (halfLife === 0n) return 0n;

  // Clock skew between chains is treated as "no time has passed", as on chain.
  if (at <= requestedAt) return maxFee;

  const elapsed = at - requestedAt;
  if (elapsed >= DECAY_WINDOW_SECONDS) return 0n;

  const halvings = elapsed / halfLife;
  if (halvings >= MAX_HALVINGS) return 0n;

  const fee = maxFee >> halvings;
  if (fee === 0n) return 0n;

  const remainder = elapsed % halfLife;
  if (remainder === 0n) return fee;

  const denominator = 2n * halfLife;
  const whole = fee / denominator;
  const part = fee % denominator;
  const reduction =
    whole * remainder + (part * remainder + denominator - 1n) / denominator;

  if (reduction >= fee) return 0n;
  return fee - reduction;
}

/** Whether a schedule's ceiling is inside the bridge's configured bps cap. */
export function isFeeCapAllowed(
  maxFee: bigint,
  amount: bigint,
  maxFeeBps: bigint,
): boolean {
  if (amount === 0n) return false;
  if (maxFee === 0n) return true;
  if (maxFee >= amount) return false;
  if (maxFeeBps === 0n) return false;
  if (maxFeeBps >= BPS_DENOMINATOR) return true;
  return maxFee <= (amount / BPS_DENOMINATOR) * maxFeeBps;
}

export function isHalfLifeAllowed(halfLife: bigint): boolean {
  return halfLife > 0n && halfLife <= DECAY_WINDOW_SECONDS;
}

/**
 * When the fee first drops to or below `target`.
 *
 * Used to decide WHEN to fill rather than whether: a solver that wants at least
 * `target` must act before this moment, and one waiting for a cheaper entry can
 * sleep until it. Returns null if the fee never reaches the target inside the
 * window (it always does, at zero, so only a target below zero is null).
 *
 * Found by scanning half-lives then bisecting inside one, because the decay is
 * monotone but piecewise and has no closed-form inverse that matches the
 * contract's integer truncation.
 */
export function feeReachesAt(
  schedule: FeeSchedule,
  target: bigint,
): bigint | null {
  if (target < 0n) return null;
  if (decayedFee(schedule, schedule.requestedAt) <= target) {
    return schedule.requestedAt;
  }

  let lo = schedule.requestedAt;
  let hi = schedule.requestedAt + DECAY_WINDOW_SECONDS;
  if (decayedFee(schedule, hi) > target) return null;

  while (hi - lo > 1n) {
    const mid = lo + (hi - lo) / 2n;
    if (decayedFee(schedule, mid) > target) lo = mid;
    else hi = mid;
  }
  return hi;
}
