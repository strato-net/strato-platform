/**
 * StablePool (Curve-style StableSwap) math — exact BigInt port of the on-chain
 * SolidVM contract (contracts/concrete/Pools/StablePool.sol): getD, getY, the
 * dynamic off-peg fee, the A ramp, and the __exchange output computation. All
 * functions are pure; results are bit-identical to what the contract computes,
 * so quotes derived from them match execution exactly (given the same state).
 */

export const PRECISION = 10n ** 18n;
export const FEE_DENOMINATOR = 10n ** 10n;
export const A_PRECISION = 100n;

export interface StablePoolState {
  /** virtual balances per coin: rate-scaled to 18 decimals (_xpMem result) */
  xp: bigint[];
  /** stored rate per coin (rateMultiplier x oracle price / 1e18), 1e18 scale */
  rates: bigint[];
  /** amplification incl. A_PRECISION (contract initialA/futureA storage scale) */
  amp: bigint;
  /** base swap fee, FEE_DENOMINATOR (1e10) scale */
  fee: bigint;
  /** off-peg fee multiplier, FEE_DENOMINATOR scale; <= 1e10 disables it */
  offpegFeeMultiplier: bigint;
}

export interface ExchangeResult {
  /** output transferred to the receiver, raw token-out wei */
  dy: bigint;
  /** fee withheld, raw token-out wei */
  dyFee: bigint;
}

/** _xpMem: raw balances -> virtual (rate-scaled) balances */
export const xpMem = (rates: bigint[], balances: bigint[]): bigint[] =>
  balances.map((b, i) => (rates[i] * b) / PRECISION);

/** _A(): linear ramp between initialA and futureA (storage scale, incl. A_PRECISION) */
export function getA(
  initialA: bigint,
  futureA: bigint,
  initialATime: bigint,
  futureATime: bigint,
  timestamp: bigint
): bigint {
  if (timestamp < futureATime) {
    if (futureA > initialA) {
      return initialA + ((futureA - initialA) * (timestamp - initialATime)) / (futureATime - initialATime);
    }
    return initialA - ((initialA - futureA) * (timestamp - initialATime)) / (futureATime - initialATime);
  }
  return futureA;
}

/** getD: StableSwap invariant via Newton's method (bit-exact contract port) */
export function getD(xp: bigint[], amp: bigint): bigint {
  const n = BigInt(xp.length);
  let s = 0n;
  for (const x of xp) {
    if (x === 0n) return 0n;
    s += x;
  }
  if (s === 0n) return 0n;

  let d = s;
  const ann = amp * n;

  for (let i = 0; i < 256; i++) {
    let dP = d;
    for (const x of xp) {
      dP = (dP * d) / (x * n);
    }
    const dPrev = d;
    d = (((ann * s) / A_PRECISION + dP * n) * d) / (((ann - A_PRECISION) * d) / A_PRECISION + (n + 1n) * dP);
    if (d > dPrev ? d - dPrev <= 1n : dPrev - d <= 1n) return d;
  }
  throw new Error("getD did not converge after 256 iterations");
}

/** getY: balance of coin j on the invariant after coin i moves to x */
export function getY(i: number, j: number, x: bigint, xp: bigint[], amp: bigint, d: bigint): bigint {
  if (i === j) throw new Error("getY: Same coin");
  if (i < 0 || i >= xp.length || j < 0 || j >= xp.length) throw new Error("getY: coin index out of range");

  const n = BigInt(xp.length);
  const ann = amp * n;
  let s = 0n;
  let c = d;

  for (let k = 0; k < xp.length; k++) {
    let xk: bigint;
    if (k === i) xk = x;
    else if (k !== j) xk = xp[k];
    else continue;
    s += xk;
    c = (c * d) / (xk * n);
  }

  c = (c * d * A_PRECISION) / (ann * n);
  const b = s + (d * A_PRECISION) / ann;
  let y = d;

  for (let k = 0; k < 256; k++) {
    const yPrev = y;
    y = (y * y + c) / (2n * y + b - d);
    if (y > yPrev ? y - yPrev <= 1n : yPrev - y <= 1n) return y;
  }
  throw new Error("getY did not converge after 256 iterations");
}

/** _dynamicFee: off-peg fee scaling on the average virtual balances */
export function dynamicFee(xpi: bigint, xpj: bigint, fee: bigint, offpegFeeMultiplier: bigint): bigint {
  if (offpegFeeMultiplier <= FEE_DENOMINATOR) return fee;
  const xps2 = (xpi + xpj) * (xpi + xpj);
  return (
    (offpegFeeMultiplier * fee) /
    (((offpegFeeMultiplier - FEE_DENOMINATOR) * 4n * xpi * xpj) / xps2 + FEE_DENOMINATOR)
  );
}

/**
 * __exchange for a given input: coin i receives dx raw tokens, returns the raw
 * token-out amount the receiver gets and the fee withheld (both in token j wei).
 */
export function simulateExchange(state: StablePoolState, i: number, j: number, dx: bigint): ExchangeResult {
  if (dx <= 0n) throw new Error("Cannot exchange 0 coins");
  const { xp, rates, amp, fee, offpegFeeMultiplier } = state;

  const d = getD(xp, amp);
  const x = xp[i] + (dx * rates[i]) / PRECISION;
  const y = getY(i, j, x, xp, amp, d);

  const dyXp = xp[j] - y - 1n;
  const dyFeeXp = (dyXp * dynamicFee((xp[i] + x) / 2n, (xp[j] + y) / 2n, fee, offpegFeeMultiplier)) / FEE_DENOMINATOR;

  return {
    dy: ((dyXp - dyFeeXp) * PRECISION) / rates[j],
    dyFee: (dyFeeXp * PRECISION) / rates[j],
  };
}

/**
 * Exact-output inversion: smallest dx (raw token-in wei) whose exchange output
 * is >= desiredDy. Output is monotone in input, so binary search is exact.
 * Throws when the pool cannot produce desiredDy at any input size.
 */
export function simulateExchangeExactOut(
  state: StablePoolState,
  i: number,
  j: number,
  desiredDy: bigint
): ExchangeResult & { dx: bigint } {
  if (desiredDy <= 0n) throw new Error("Cannot request 0 coins out");

  // the pool can never pay out more than its virtual balance of coin j
  const desiredXp = (desiredDy * state.rates[j]) / PRECISION;
  if (desiredXp >= state.xp[j]) throw new Error("Desired output exceeds pool reserves");

  // bracket: grow from a rate-parity estimate until the output covers the request
  let hi = (desiredDy * state.rates[j]) / state.rates[i] + 1n;
  for (let k = 0; k < 128; k++) {
    if (simulateExchange(state, i, j, hi).dy >= desiredDy) break;
    hi *= 2n;
    if (k === 127) throw new Error("Desired output exceeds pool reserves");
  }

  let lo = 1n;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    if (simulateExchange(state, i, j, mid).dy >= desiredDy) hi = mid;
    else lo = mid + 1n;
  }

  return { dx: lo, ...simulateExchange(state, i, j, lo) };
}

/**
 * _getP: marginal (spot) prices of each coin in units of coin 0 on the xp scale,
 * 1e18 fixed point. Used for price impact, not for quoting.
 */
export function getP(xp: bigint[], amp: bigint, d: bigint): bigint[] {
  const n = BigInt(xp.length);
  if (xp.some((x) => x === 0n)) return xp.map(() => 0n);

  const ann = amp * n;
  let dr = d / n ** n;
  for (const x of xp) {
    dr = (dr * d) / x;
  }
  const xp0A = (ann * xp[0]) / A_PRECISION;

  return xp.map((_, k) => (10n ** 18n * (xp0A + (dr * xp[0]) / xp[k])) / (xp0A + dr));
}

/** spot rate token i -> token j in raw token units, 1e18 fixed point (fee-less) */
export function spotRate(state: StablePoolState, i: number, j: number): bigint {
  const { xp, rates, amp } = state;
  const d = getD(xp, amp);
  const ps = getP(xp, amp, d);
  const valueI = ps[i] * rates[i];
  const valueJ = ps[j] * rates[j];
  if (valueJ === 0n) return 0n;
  return (valueI * 10n ** 18n) / valueJ;
}
