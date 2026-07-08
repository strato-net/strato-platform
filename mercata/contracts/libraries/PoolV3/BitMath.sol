// SPDX-License-Identifier: MIT

/// @title BitMath
/// @notice Bit-index math, ported from Uniswap V3 core's BitMath
/// @dev SolidVM has no inline assembly, `~`, `^`, or variable-amount shifts, so everything
///      here is built from `&`, arithmetic and constant factors
library BitMath {
    /// @notice Index of the most significant set bit of x (canonical mostSignificantBit)
    /// @dev x must be in [1, 2^256); binary search over squaring constants
    function mostSignificantBit(uint x) internal pure returns (uint) {
        require(x > 0, "msb of zero");
        uint v = x;
        uint r = 0;
        if (v >= 340282366920938463463374607431768211456) {
            v /= 340282366920938463463374607431768211456;
            r += 128;
        }
        if (v >= 18446744073709551616) {
            v /= 18446744073709551616;
            r += 64;
        }
        if (v >= 4294967296) {
            v /= 4294967296;
            r += 32;
        }
        if (v >= 65536) {
            v /= 65536;
            r += 16;
        }
        if (v >= 256) {
            v /= 256;
            r += 8;
        }
        if (v >= 16) {
            v /= 16;
            r += 4;
        }
        if (v >= 4) {
            v /= 4;
            r += 2;
        }
        if (v >= 2) {
            r += 1;
        }
        return r;
    }

    /// @notice Index of the least significant set bit of x (canonical leastSignificantBit)
    function leastSignificantBit(uint x) internal pure returns (uint) {
        require(x > 0, "lsb of zero");
        // x & (x - 1) clears the lowest set bit; the difference isolates it
        uint lowBit = x - (x & (x - 1));
        return mostSignificantBit(lowBit);
    }

    /// @notice 2**n for n in [0, 255]
    /// @dev SolidVM shift-emulation helper (no canonical equivalent: the EVM shifts instead)
    function pow2(uint n) internal pure returns (uint) {
        require(n <= 255, "pow2 out of range");
        uint r = 1;
        if ((n & 1) != 0) r *= 2;
        if ((n & 2) != 0) r *= 4;
        if ((n & 4) != 0) r *= 16;
        if ((n & 8) != 0) r *= 256;
        if ((n & 16) != 0) r *= 65536;
        if ((n & 32) != 0) r *= 4294967296;
        if ((n & 64) != 0) r *= 18446744073709551616;
        if ((n & 128) != 0) r *= 340282366920938463463374607431768211456;
        return r;
    }
}
