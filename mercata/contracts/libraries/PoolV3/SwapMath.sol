// SPDX-License-Identifier: MIT
import "FullMath.sol";
import "SqrtPriceMath.sol";

/// @title SwapMath
/// @notice One swap step within a tick range — a bit-for-bit port of Uniswap V3 core's
///         SwapMath.computeSwapStep
library SwapMath {
    /// @notice Compute the result of swapping toward `sqrtRatioTargetX96`, given the
    ///         remaining amount (>= 0 exact input with fee taken from input, < 0 exact output)
    /// @return sqrtRatioNextX96 The price after this step
    /// @return amountIn The input consumed by this step (fee-exclusive)
    /// @return amountOut The output produced by this step
    /// @return feeAmount The fee taken on this step, in the input token
    function computeSwapStep(
        uint sqrtRatioCurrentX96,
        uint sqrtRatioTargetX96,
        uint liquidity,
        int amountRemaining,
        uint feePips
    ) internal pure returns (uint sqrtRatioNextX96, uint amountIn, uint amountOut, uint feeAmount) {
        bool zeroForOne = sqrtRatioCurrentX96 >= sqrtRatioTargetX96;
        bool exactIn = amountRemaining >= 0;
        sqrtRatioNextX96 = 0;
        amountIn = 0;
        amountOut = 0;
        feeAmount = 0;

        if (exactIn) {
            uint amountRemainingLessFee = (uint(amountRemaining) * (1000000 - feePips)) / 1000000;
            amountIn = zeroForOne
                ? SqrtPriceMath.getAmount0Delta(sqrtRatioTargetX96, sqrtRatioCurrentX96, liquidity, true)
                : SqrtPriceMath.getAmount1Delta(sqrtRatioCurrentX96, sqrtRatioTargetX96, liquidity, true);
            if (amountRemainingLessFee >= amountIn) {
                sqrtRatioNextX96 = sqrtRatioTargetX96;
            } else {
                sqrtRatioNextX96 = SqrtPriceMath.getNextSqrtPriceFromInput(sqrtRatioCurrentX96, liquidity, amountRemainingLessFee, zeroForOne);
            }
        } else {
            amountOut = zeroForOne
                ? SqrtPriceMath.getAmount1Delta(sqrtRatioTargetX96, sqrtRatioCurrentX96, liquidity, false)
                : SqrtPriceMath.getAmount0Delta(sqrtRatioCurrentX96, sqrtRatioTargetX96, liquidity, false);
            if (uint(-amountRemaining) >= amountOut) {
                sqrtRatioNextX96 = sqrtRatioTargetX96;
            } else {
                sqrtRatioNextX96 = SqrtPriceMath.getNextSqrtPriceFromOutput(sqrtRatioCurrentX96, liquidity, uint(-amountRemaining), zeroForOne);
            }
        }

        bool max = sqrtRatioTargetX96 == sqrtRatioNextX96;

        if (zeroForOne) {
            if (!(max && exactIn)) {
                amountIn = SqrtPriceMath.getAmount0Delta(sqrtRatioNextX96, sqrtRatioCurrentX96, liquidity, true);
            }
            if (!(max && !exactIn)) {
                amountOut = SqrtPriceMath.getAmount1Delta(sqrtRatioNextX96, sqrtRatioCurrentX96, liquidity, false);
            }
        } else {
            if (!(max && exactIn)) {
                amountIn = SqrtPriceMath.getAmount1Delta(sqrtRatioCurrentX96, sqrtRatioNextX96, liquidity, true);
            }
            if (!(max && !exactIn)) {
                amountOut = SqrtPriceMath.getAmount0Delta(sqrtRatioCurrentX96, sqrtRatioNextX96, liquidity, false);
            }
        }

        // Cap the output to the exact-output request
        if (!exactIn && amountOut > uint(-amountRemaining)) {
            amountOut = uint(-amountRemaining);
        }

        if (exactIn && sqrtRatioNextX96 != sqrtRatioTargetX96) {
            // Input exhausted within this step: the leftover input is the fee
            feeAmount = uint(amountRemaining) - amountIn;
        } else {
            feeAmount = FullMath.mulDivRoundingUp(amountIn, feePips, 1000000 - feePips);
        }
        return (sqrtRatioNextX96, amountIn, amountOut, feeAmount);
    }
}
