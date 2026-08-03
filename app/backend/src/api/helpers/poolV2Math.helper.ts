/**
 * V2 constant-product pool math — exact BigInt port of Pool.sol's getInputPrice
 * path (fee floored at bps/10000 of the input, then floor-division AMM output).
 * Mirrors the client-side calculateSwapOutput/calculateSwapInput non-stable
 * branches in app/ui/src/helpers/swapCalculations.ts, so quotes are
 * bit-identical to what execution computes for the same reserves.
 */

const BPS_DENOMINATOR = 10000n;

export interface V2QuoteResult {
  amountIn: bigint;
  amountOut: bigint;
  /** fee withheld from the input, wei */
  feeAmount: bigint;
}

/** exact input: how much comes out for a given gross input */
export function getV2QuoteExactIn(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeBps: bigint
): V2QuoteResult {
  if (amountIn <= 0n) throw new Error("Cannot swap 0 tokens");
  if (reserveIn <= 0n || reserveOut <= 0n) throw new Error("Invalid pool reserves");

  const feeAmount = (amountIn * feeBps) / BPS_DENOMINATOR;
  const netInput = amountIn - feeAmount;
  const amountOut = (netInput * reserveOut) / (reserveIn + netInput);

  return { amountIn, amountOut, feeAmount };
}

/** exact output: smallest gross input that yields at least amountOut (ceil on both steps) */
export function getV2QuoteExactOut(
  amountOut: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeBps: bigint
): V2QuoteResult {
  if (amountOut <= 0n) throw new Error("Cannot request 0 tokens out");
  if (reserveIn <= 0n || reserveOut <= 0n) throw new Error("Invalid pool reserves");
  if (amountOut >= reserveOut) throw new Error("Desired output amount exceeds pool reserves");

  // ceil to beat the contract's floor division
  const denominator = reserveOut - amountOut;
  const netInput = (reserveIn * amountOut + denominator - 1n) / denominator;

  // gross up for the fee, again ceiling: gross * (1 - fee) >= netInput
  const feeComplement = BPS_DENOMINATOR - feeBps;
  const amountIn = (netInput * BPS_DENOMINATOR + feeComplement - 1n) / feeComplement;

  return { amountIn, amountOut, feeAmount: amountIn - netInput };
}
