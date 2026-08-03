// SPDX-License-Identifier: MIT

/// @title FullMath
/// @notice floor(a*b/d) and ceil(a*b/d) with the canonical Uniswap V3 names
/// @dev Canonical FullMath computes these through 512-bit intermediate math because EVM
///      multiplication wraps at 2^256. SolidVM integers are unbounded, so a * b / d is
///      already exact — these one-liners are bit-identical to the canonical results.
///      Canonical UnsafeMath.divRoundingUp is folded in here (checked, not unsafe)
library FullMath {
    /// @notice floor(a * b / denominator)
    function mulDiv(uint a, uint b, uint denominator) internal pure returns (uint) {
        require(denominator > 0, "Division by zero");
        return (a * b) / denominator;
    }

    /// @notice ceil(a * b / denominator)
    function mulDivRoundingUp(uint a, uint b, uint denominator) internal pure returns (uint) {
        require(denominator > 0, "Division by zero");
        uint product = a * b;
        if (product == 0) return 0;
        return (product + denominator - 1) / denominator;
    }

    /// @notice ceil(x / y) (canonical UnsafeMath.divRoundingUp, with a zero-check)
    function divRoundingUp(uint x, uint y) internal pure returns (uint) {
        require(y > 0, "Division by zero");
        if (x == 0) return 0;
        return (x + y - 1) / y;
    }
}
