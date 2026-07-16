/**
 * PoolV3 (Uniswap V3) math — exact BigInt port of the on-chain SolidVM libraries
 * (contracts/libraries/PoolV3/{TickMath,SqrtPriceMath,SwapMath}.sol), same integer
 * algorithms as contracts/tests/Pool/poolv3_reference.py. All functions are pure;
 * results are bit-identical to what the contracts compute.
 */

export const Q32 = 1n << 32n;
export const Q96 = 1n << 96n;
export const Q128 = 1n << 128n;
const U256_MAX = (1n << 256n) - 1n;

export const MIN_TICK = -887272;
export const MAX_TICK = 887272;
export const MIN_SQRT_RATIO = 4295128739n;
export const MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342n;

// The 20 magic constants from canonical TickMath.getSqrtRatioAtTick:
// constant k encodes sqrt(1.0001)^-(2^k) in Q128.128.
const TICK_CONSTANTS: bigint[] = [
  0xfffcb933bd6fad37aa2d162d1a594001n,
  0xfff97272373d413259a46990580e213an,
  0xfff2e50f5f656932ef12357cf3c7fdccn,
  0xffe5caca7e10e4e61c3624eaa0941cd0n,
  0xffcb9843d60f6159c9db58835c926644n,
  0xff973b41fa98c081472e6896dfb254c0n,
  0xff2ea16466c96a3843ec78b326b52861n,
  0xfe5dee046a99a2a811c461f1969c3053n,
  0xfcbe86c7900a88aedcffc83b479aa3a4n,
  0xf987a7253ac413176f2b074cf7815e54n,
  0xf3392b0822b70005940c7a398e4b70f3n,
  0xe7159475a2c29b7443b29c7fa6e889d9n,
  0xd097f3bdfd2022b8845ad8f792aa5825n,
  0xa9f746462d870fdf8a65dc1f90e061e5n,
  0x70d869a156d2a1b890bb3df62baf32f7n,
  0x31be135f97d08fd981231505542fcfa6n,
  0x9aa508b5b7a84e1c677de54f3e99bc9n,
  0x5d6af8dedb81196699c329225ee604n,
  0x2216e584f5fa1ea926041bedfe98n,
  0x48a170391f7dc42444e8fa2n,
];

const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

/** sqrt(1.0001^tick) as a Q64.96 (bit-exact TickMath.getSqrtRatioAtTick) */
export function getSqrtRatioAtTick(tick: number): bigint {
  const absTick = tick < 0 ? -tick : tick;
  if (absTick > MAX_TICK) throw new Error("T");

  let ratio = (absTick & 0x1) !== 0 ? TICK_CONSTANTS[0] : 1n << 128n;
  for (let k = 1; k < 20; k++) {
    if ((absTick & (1 << k)) !== 0) {
      ratio = (ratio * TICK_CONSTANTS[k]) >> 128n;
    }
  }
  if (tick > 0) ratio = U256_MAX / ratio;

  // Q128.128 -> Q64.96, rounding up
  return (ratio >> 32n) + (ratio % Q32 === 0n ? 0n : 1n);
}

/** Greatest tick whose sqrt ratio is <= the given ratio (binary search over the spec) */
export function getTickAtSqrtRatio(sqrtPriceX96: bigint): number {
  if (sqrtPriceX96 < MIN_SQRT_RATIO || sqrtPriceX96 >= MAX_SQRT_RATIO) throw new Error("R");
  let lo = MIN_TICK;
  let hi = MAX_TICK;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (getSqrtRatioAtTick(mid) <= sqrtPriceX96) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** SqrtPriceMath.getAmount0Delta */
export function getAmount0Delta(sqrtA: bigint, sqrtB: bigint, liquidity: bigint, roundUp: boolean): bigint {
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];
  if (sqrtA <= 0n) throw new Error("invalid sqrt ratio");
  const numerator = liquidity * Q96 * (sqrtB - sqrtA);
  const denominator = sqrtB * sqrtA;
  return roundUp ? ceilDiv(numerator, denominator) : numerator / denominator;
}

/** SqrtPriceMath.getAmount1Delta */
export function getAmount1Delta(sqrtA: bigint, sqrtB: bigint, liquidity: bigint, roundUp: boolean): bigint {
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];
  const numerator = liquidity * (sqrtB - sqrtA);
  return roundUp ? ceilDiv(numerator, Q96) : numerator / Q96;
}

function getNextSqrtPriceFromInput(sqrtP: bigint, liquidity: bigint, amountIn: bigint, zeroForOne: boolean): bigint {
  if (zeroForOne) {
    if (amountIn === 0n) return sqrtP;
    const numerator1 = liquidity * Q96;
    return ceilDiv(numerator1 * sqrtP, numerator1 + amountIn * sqrtP);
  }
  return sqrtP + (amountIn * Q96) / liquidity;
}

function getNextSqrtPriceFromOutput(sqrtP: bigint, liquidity: bigint, amountOut: bigint, zeroForOne: boolean): bigint {
  if (zeroForOne) {
    const quotient = ceilDiv(amountOut * Q96, liquidity);
    if (sqrtP <= quotient) throw new Error("insufficient liquidity for output");
    return sqrtP - quotient;
  }
  const numerator1 = liquidity * Q96;
  const product = amountOut * sqrtP;
  if (numerator1 <= product) throw new Error("insufficient liquidity for output");
  return ceilDiv(numerator1 * sqrtP, numerator1 - product);
}

export interface SwapStepResult {
  sqrtRatioNextX96: bigint;
  amountIn: bigint;
  amountOut: bigint;
  feeAmount: bigint;
}

/** Bit-exact SwapMath.computeSwapStep (amountRemaining >= 0 exact input, < 0 exact output) */
export function computeSwapStep(
  sqrtRatioCurrentX96: bigint,
  sqrtRatioTargetX96: bigint,
  liquidity: bigint,
  amountRemaining: bigint,
  feePips: bigint
): SwapStepResult {
  const zeroForOne = sqrtRatioCurrentX96 >= sqrtRatioTargetX96;
  const exactIn = amountRemaining >= 0n;
  let sqrtRatioNextX96: bigint;
  let amountIn = 0n;
  let amountOut = 0n;
  let feeAmount: bigint;

  if (exactIn) {
    const amountRemainingLessFee = (amountRemaining * (1000000n - feePips)) / 1000000n;
    amountIn = zeroForOne
      ? getAmount0Delta(sqrtRatioTargetX96, sqrtRatioCurrentX96, liquidity, true)
      : getAmount1Delta(sqrtRatioCurrentX96, sqrtRatioTargetX96, liquidity, true);
    sqrtRatioNextX96 =
      amountRemainingLessFee >= amountIn
        ? sqrtRatioTargetX96
        : getNextSqrtPriceFromInput(sqrtRatioCurrentX96, liquidity, amountRemainingLessFee, zeroForOne);
  } else {
    amountOut = zeroForOne
      ? getAmount1Delta(sqrtRatioTargetX96, sqrtRatioCurrentX96, liquidity, false)
      : getAmount0Delta(sqrtRatioCurrentX96, sqrtRatioTargetX96, liquidity, false);
    sqrtRatioNextX96 =
      -amountRemaining >= amountOut
        ? sqrtRatioTargetX96
        : getNextSqrtPriceFromOutput(sqrtRatioCurrentX96, liquidity, -amountRemaining, zeroForOne);
  }

  const max = sqrtRatioTargetX96 === sqrtRatioNextX96;

  if (zeroForOne) {
    if (!(max && exactIn)) amountIn = getAmount0Delta(sqrtRatioNextX96, sqrtRatioCurrentX96, liquidity, true);
    if (!(max && !exactIn)) amountOut = getAmount1Delta(sqrtRatioNextX96, sqrtRatioCurrentX96, liquidity, false);
  } else {
    if (!(max && exactIn)) amountIn = getAmount1Delta(sqrtRatioCurrentX96, sqrtRatioNextX96, liquidity, true);
    if (!(max && !exactIn)) amountOut = getAmount0Delta(sqrtRatioCurrentX96, sqrtRatioNextX96, liquidity, false);
  }

  if (!exactIn && amountOut > -amountRemaining) amountOut = -amountRemaining;

  if (exactIn && sqrtRatioNextX96 !== sqrtRatioTargetX96) {
    feeAmount = amountRemaining - amountIn; // input exhausted within the step: remainder is fee
  } else {
    feeAmount = ceilDiv(amountIn * feePips, 1000000n - feePips);
  }

  return { sqrtRatioNextX96, amountIn, amountOut, feeAmount };
}

// ============================================================================
// AMOUNTS FOR LIQUIDITY (canonical _modifyPosition amounts / LiquidityAmounts)
// ============================================================================

/** Token amounts required (mint, roundUp) or returned (burn, roundDown) for a liquidity change */
export function getAmountsForLiquidity(
  sqrtPriceX96: bigint,
  currentTick: number,
  tickLower: number,
  tickUpper: number,
  liquidity: bigint,
  roundUp: boolean
): { amount0: bigint; amount1: bigint } {
  const sqrtLower = getSqrtRatioAtTick(tickLower);
  const sqrtUpper = getSqrtRatioAtTick(tickUpper);
  if (currentTick < tickLower) {
    return { amount0: getAmount0Delta(sqrtLower, sqrtUpper, liquidity, roundUp), amount1: 0n };
  }
  if (currentTick < tickUpper) {
    return {
      amount0: getAmount0Delta(sqrtPriceX96, sqrtUpper, liquidity, roundUp),
      amount1: getAmount1Delta(sqrtLower, sqrtPriceX96, liquidity, roundUp),
    };
  }
  return { amount0: 0n, amount1: getAmount1Delta(sqrtLower, sqrtUpper, liquidity, roundUp) };
}

/** Max liquidity mintable from the given token amounts over a range (periphery LiquidityAmounts) */
export function getLiquidityForAmounts(
  sqrtPriceX96: bigint,
  tickLower: number,
  tickUpper: number,
  amount0: bigint,
  amount1: bigint
): bigint {
  const sqrtLower = getSqrtRatioAtTick(tickLower);
  const sqrtUpper = getSqrtRatioAtTick(tickUpper);

  const liquidityForAmount0 = (a0: bigint, sA: bigint, sB: bigint): bigint =>
    (a0 * ((sA * sB) / Q96)) / (sB - sA);
  const liquidityForAmount1 = (a1: bigint, sA: bigint, sB: bigint): bigint => (a1 * Q96) / (sB - sA);

  if (sqrtPriceX96 <= sqrtLower) return liquidityForAmount0(amount0, sqrtLower, sqrtUpper);
  if (sqrtPriceX96 < sqrtUpper) {
    const l0 = liquidityForAmount0(amount0, sqrtPriceX96, sqrtUpper);
    const l1 = liquidityForAmount1(amount1, sqrtLower, sqrtPriceX96);
    return l0 < l1 ? l0 : l1;
  }
  return liquidityForAmount1(amount1, sqrtLower, sqrtUpper);
}

/**
 * Liquidity implied by a token0 amount ALONE (canonical getLiquidityForAmount0 applied to
 * the token0 sub-range). Use when the caller specifies only amount0 and wants the matching
 * amount1 derived — unlike getLiquidityForAmounts, this does not min() against a zero
 * amount1, which would collapse an in-range position's liquidity to 0. Returns 0 when the
 * price is at/above the upper bound (the position then holds no token0).
 */
export function getLiquidityForAmount0(
  sqrtPriceX96: bigint,
  tickLower: number,
  tickUpper: number,
  amount0: bigint
): bigint {
  const sqrtLower = getSqrtRatioAtTick(tickLower);
  const sqrtUpper = getSqrtRatioAtTick(tickUpper);
  const lo = sqrtPriceX96 > sqrtLower ? sqrtPriceX96 : sqrtLower; // token0 spans [max(price,lower), upper]
  if (sqrtUpper <= lo) return 0n;
  return (amount0 * ((lo * sqrtUpper) / Q96)) / (sqrtUpper - lo);
}

/**
 * Liquidity implied by a token1 amount ALONE (canonical getLiquidityForAmount1 applied to
 * the token1 sub-range). Returns 0 when the price is at/below the lower bound (the position
 * then holds no token1).
 */
export function getLiquidityForAmount1(
  sqrtPriceX96: bigint,
  tickLower: number,
  tickUpper: number,
  amount1: bigint
): bigint {
  const sqrtLower = getSqrtRatioAtTick(tickLower);
  const sqrtUpper = getSqrtRatioAtTick(tickUpper);
  const hi = sqrtPriceX96 < sqrtUpper ? sqrtPriceX96 : sqrtUpper; // token1 spans [lower, min(price,upper)]
  if (hi <= sqrtLower) return 0n;
  return (amount1 * Q96) / (hi - sqrtLower);
}

// ============================================================================
// QUOTE SIMULATOR (tick-walking swap loop over indexed tick data)
// ============================================================================

export interface TickData {
  tick: number;
  liquidityNet: bigint;
}

export interface PoolQuoteState {
  sqrtPriceX96: bigint;
  currentTick: number;
  liquidity: bigint;
  feePips: bigint;
  /** all initialized ticks, any order */
  ticks: TickData[];
}

export interface QuoteResult {
  amountIn: bigint;
  amountOut: bigint;
  feeAmount: bigint;
  sqrtPriceX96After: bigint;
  tickAfter: number;
  /** true when the pool ran out of liquidity/price range before filling the request */
  partialFill: boolean;
}

/**
 * Simulate PoolV3.swap over indexed tick state. Mirrors the contract's swap loop
 * exactly (Cirrus tick rows replace the on-chain bitmap walk: with all initialized
 * ticks in hand, the next tick in the swap direction is a direct lookup).
 * amountSpecified > 0 = exact input, < 0 = exact output.
 */
export function simulateSwap(pool: PoolQuoteState, zeroForOne: boolean, amountSpecified: bigint): QuoteResult {
  if (amountSpecified === 0n) throw new Error("AS");
  const limit = zeroForOne ? MIN_SQRT_RATIO + 1n : MAX_SQRT_RATIO - 1n;

  const sortedTicks = [...pool.ticks].sort((a, b) => a.tick - b.tick);
  const exactInput = amountSpecified > 0n;

  let remaining = amountSpecified;
  let calculated = 0n;
  let feeTotal = 0n;
  let sqrtPriceX96 = pool.sqrtPriceX96;
  let tick = pool.currentTick;
  let liquidity = pool.liquidity;

  while (remaining !== 0n && sqrtPriceX96 !== limit) {
    // next initialized tick in the swap direction (<= tick going down, > tick going up)
    let nextTick: number | null = null;
    if (zeroForOne) {
      for (let i = sortedTicks.length - 1; i >= 0; i--) {
        if (sortedTicks[i].tick <= tick) {
          nextTick = sortedTicks[i].tick;
          break;
        }
      }
    } else {
      for (let i = 0; i < sortedTicks.length; i++) {
        if (sortedTicks[i].tick > tick) {
          nextTick = sortedTicks[i].tick;
          break;
        }
      }
    }
    const initialized = nextTick !== null;
    const boundedTick = nextTick ?? (zeroForOne ? MIN_TICK : MAX_TICK);
    const tickSqrt = getSqrtRatioAtTick(boundedTick);
    const targetSqrt = zeroForOne ? (tickSqrt < limit ? limit : tickSqrt) : tickSqrt > limit ? limit : tickSqrt;

    const step = computeSwapStep(sqrtPriceX96, targetSqrt, liquidity, remaining, pool.feePips);

    if (exactInput) {
      remaining -= step.amountIn + step.feeAmount;
      calculated -= step.amountOut;
    } else {
      remaining += step.amountOut;
      calculated += step.amountIn + step.feeAmount;
    }
    feeTotal += step.feeAmount;
    sqrtPriceX96 = step.sqrtRatioNextX96;

    if (sqrtPriceX96 === tickSqrt) {
      if (initialized) {
        const crossed = sortedTicks.find((t) => t.tick === boundedTick)!;
        liquidity += zeroForOne ? -crossed.liquidityNet : crossed.liquidityNet;
      }
      tick = zeroForOne ? boundedTick - 1 : boundedTick;
      if (!initialized && (boundedTick === MIN_TICK || boundedTick === MAX_TICK)) break; // domain edge
    } else if (sqrtPriceX96 !== targetSqrt || sqrtPriceX96 === limit) {
      if (sqrtPriceX96 !== pool.sqrtPriceX96) tick = getTickAtSqrtRatio(sqrtPriceX96);
      if (sqrtPriceX96 !== targetSqrt) break; // request exhausted mid-step
    }
  }

  const amountIn = exactInput ? amountSpecified - remaining : calculated;
  const amountOut = exactInput ? -calculated : -(amountSpecified - remaining);
  return {
    amountIn,
    amountOut,
    feeAmount: feeTotal,
    sqrtPriceX96After: sqrtPriceX96,
    tickAfter: tick,
    partialFill: remaining !== 0n,
  };
}

// ============================================================================
// DISPLAY HELPERS
// ============================================================================

/** token1-per-token0 price (wei-scale, 18 decimals) from a Q64.96 sqrt price */
export function sqrtPriceX96ToPriceWad(sqrtPriceX96: bigint): bigint {
  return (sqrtPriceX96 * sqrtPriceX96 * 10n ** 18n) / (Q96 * Q96);
}

/** Snap a tick toward zero to a multiple of tickSpacing */
export function nearestUsableTick(tick: number, tickSpacing: number): number {
  const rounded = Math.round(tick / tickSpacing) * tickSpacing;
  if (rounded < MIN_TICK) return rounded + tickSpacing;
  if (rounded > MAX_TICK) return rounded - tickSpacing;
  return rounded;
}
