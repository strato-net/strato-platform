// SPDX-License-Identifier: MIT
import "FullMath.sol";
import "FixedPoint96.sol";

/// @title Liquidity amount functions
/// @notice Computes liquidity from token amounts and prices (the amounts-from-liquidity
///         direction lives in PoolV3._amountsForLiquidity / SqrtPriceMath and is not
///         duplicated here)
///
/// SolidVM dialect notes (vs canonical v3-periphery LiquidityAmounts, otherwise
/// function-for-function):
/// - uint replaces uint160/uint128/uint256; toUint128 downcasts are unnecessary and dropped
///   (unbounded integers cannot overflow a target type)
/// - getAmount{0,1}ForLiquidity / getAmountsForLiquidity are omitted: PoolV3 exposes the
///   identical rounding-aware computation as a public view (getAmountsForLiquidity), which
///   consumers must use so their amounts match the pool's own mint/burn math exactly
library LiquidityAmounts {
    /// @notice Computes the amount of liquidity received for a given amount of token0 and price range
    /// @dev Calculates amount0 * (sqrt(upper) * sqrt(lower)) / (sqrt(upper) - sqrt(lower))
    /// @param sqrtRatioAX96 A sqrt price representing the first tick boundary
    /// @param sqrtRatioBX96 A sqrt price representing the second tick boundary
    /// @param amount0 The amount0 being sent in
    /// @return liquidity The amount of returned liquidity
    function getLiquidityForAmount0(
        uint sqrtRatioAX96,
        uint sqrtRatioBX96,
        uint amount0
    ) internal pure returns (uint) {
        if (sqrtRatioAX96 > sqrtRatioBX96) (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);
        uint intermediate = FullMath.mulDiv(sqrtRatioAX96, sqrtRatioBX96, FixedPoint96.Q96);
        return FullMath.mulDiv(amount0, intermediate, sqrtRatioBX96 - sqrtRatioAX96);
    }

    /// @notice Computes the amount of liquidity received for a given amount of token1 and price range
    /// @dev Calculates amount1 / (sqrt(upper) - sqrt(lower))
    /// @param sqrtRatioAX96 A sqrt price representing the first tick boundary
    /// @param sqrtRatioBX96 A sqrt price representing the second tick boundary
    /// @param amount1 The amount1 being sent in
    /// @return liquidity The amount of returned liquidity
    function getLiquidityForAmount1(
        uint sqrtRatioAX96,
        uint sqrtRatioBX96,
        uint amount1
    ) internal pure returns (uint) {
        if (sqrtRatioAX96 > sqrtRatioBX96) (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);
        return FullMath.mulDiv(amount1, FixedPoint96.Q96, sqrtRatioBX96 - sqrtRatioAX96);
    }

    /// @notice Computes the maximum amount of liquidity received for a given amount of token0, token1, the current
    /// pool prices and the prices at the tick boundaries
    /// @param sqrtRatioX96 A sqrt price representing the current pool prices
    /// @param sqrtRatioAX96 A sqrt price representing the first tick boundary
    /// @param sqrtRatioBX96 A sqrt price representing the second tick boundary
    /// @param amount0 The amount of token0 being sent in
    /// @param amount1 The amount of token1 being sent in
    /// @return liquidity The maximum amount of liquidity received
    function getLiquidityForAmounts(
        uint sqrtRatioX96,
        uint sqrtRatioAX96,
        uint sqrtRatioBX96,
        uint amount0,
        uint amount1
    ) internal pure returns (uint) {
        if (sqrtRatioAX96 > sqrtRatioBX96) (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);

        if (sqrtRatioX96 <= sqrtRatioAX96) {
            return getLiquidityForAmount0(sqrtRatioAX96, sqrtRatioBX96, amount0);
        } else if (sqrtRatioX96 < sqrtRatioBX96) {
            uint liquidity0 = getLiquidityForAmount0(sqrtRatioX96, sqrtRatioBX96, amount0);
            uint liquidity1 = getLiquidityForAmount1(sqrtRatioAX96, sqrtRatioX96, amount1);
            return liquidity0 < liquidity1 ? liquidity0 : liquidity1;
        }
        return getLiquidityForAmount1(sqrtRatioAX96, sqrtRatioBX96, amount1);
    }
}
