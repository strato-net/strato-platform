// SPDX-License-Identifier: MIT
import "FullMath.sol";
import "FixedPoint96.sol";

/// @title SqrtPriceMath
/// @notice Sqrt-price and liquidity math, ported from Uniswap V3 core's SqrtPriceMath
/// @dev Amount formulas collapse canonical nested roundings into one exact division via
///      the identity ceil(ceil(n/b)/a) == ceil(n/(a*b)) (same for floor), which SolidVM's
///      unbounded integers make computable directly — results are bit-identical
library SqrtPriceMath {
    /// @notice Token0 amount for `liquidity` between two sqrt ratios
    /// @dev getAmount0Delta: liquidity * 2^96 * (sqrtB - sqrtA) / (sqrtB * sqrtA)
    function getAmount0Delta(uint sqrtRatioAX96, uint sqrtRatioBX96, uint liquidity, bool roundUp) internal pure returns (uint) {
        if (sqrtRatioAX96 > sqrtRatioBX96) {
            (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);
        }
        require(sqrtRatioAX96 > 0, "Invalid sqrt ratio");
        uint numerator = liquidity * FixedPoint96.Q96 * (sqrtRatioBX96 - sqrtRatioAX96);
        uint denominator = sqrtRatioBX96 * sqrtRatioAX96;
        return roundUp ? FullMath.divRoundingUp(numerator, denominator) : numerator / denominator;
    }

    /// @notice Token1 amount for `liquidity` between two sqrt ratios
    /// @dev getAmount1Delta: liquidity * (sqrtB - sqrtA) / 2^96
    function getAmount1Delta(uint sqrtRatioAX96, uint sqrtRatioBX96, uint liquidity, bool roundUp) internal pure returns (uint) {
        if (sqrtRatioAX96 > sqrtRatioBX96) {
            (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);
        }
        uint numerator = liquidity * (sqrtRatioBX96 - sqrtRatioAX96);
        return roundUp ? FullMath.divRoundingUp(numerator, FixedPoint96.Q96) : numerator / FixedPoint96.Q96;
    }

    /// @notice Next sqrt ratio after paying `amountIn` of the input token
    /// @dev getNextSqrtPriceFromInput. SolidVM's exact wide math always takes canonical
    ///      V3's no-overflow branch; where mainnet would hit the overflow fallback our
    ///      result is the mathematically exact one
    function getNextSqrtPriceFromInput(uint sqrtPX96, uint liquidity, uint amountIn, bool zeroForOne) internal pure returns (uint) {
        if (zeroForOne) {
            if (amountIn == 0) return sqrtPX96;
            uint numerator1 = liquidity * FixedPoint96.Q96;
            return FullMath.divRoundingUp(numerator1 * sqrtPX96, numerator1 + amountIn * sqrtPX96);
        }
        return sqrtPX96 + (amountIn * FixedPoint96.Q96) / liquidity;
    }

    /// @notice Next sqrt ratio after paying out `amountOut` of the output token
    /// @dev getNextSqrtPriceFromOutput
    function getNextSqrtPriceFromOutput(uint sqrtPX96, uint liquidity, uint amountOut, bool zeroForOne) internal pure returns (uint) {
        if (zeroForOne) {
            uint quotient = FullMath.divRoundingUp(amountOut * FixedPoint96.Q96, liquidity);
            require(sqrtPX96 > quotient, "Insufficient liquidity for output");
            return sqrtPX96 - quotient;
        }
        uint numerator1 = liquidity * FixedPoint96.Q96;
        uint product = amountOut * sqrtPX96;
        require(numerator1 > product, "Insufficient liquidity for output");
        return FullMath.divRoundingUp(numerator1 * sqrtPX96, numerator1 - product);
    }
}
