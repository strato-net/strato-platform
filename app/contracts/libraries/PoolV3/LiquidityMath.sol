// SPDX-License-Identifier: MIT

/// @title Math library for liquidity
/// @dev Cannot be ported verbatim: canonical detects underflow via uint128 wrap-around
///      (`require((z = x - uint128(-y)) < x, 'LS')`). SolidVM integers do not wrap — the
///      subtraction just goes negative, `z < x` still holds, and 'LS' would never fire
///      (and SolidVM's own uint bounds check does not apply to named-return assignment).
///      The underflow check is therefore explicit; 'LA' overflow cannot occur unbounded
library LiquidityMath {
    /// @notice Add a signed liquidity delta to liquidity and revert if it overflows or underflows
    /// @param x The liquidity before change
    /// @param y The delta by which liquidity should be changed
    /// @return z The liquidity delta
    function addDelta(uint x, int y) internal pure returns (uint) {
        if (y < 0) {
            require(x >= uint(-y), "LS");
            return x - uint(-y);
        } else {
            return x + uint(y);
        }
    }
}
