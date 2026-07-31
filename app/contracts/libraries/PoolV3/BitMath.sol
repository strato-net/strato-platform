// SPDX-License-Identifier: MIT

/// @title BitMath
/// @dev This library provides functionality for computing bit properties of an unsigned integer
///
/// SolidVM dialect notes (vs canonical Uniswap V3 BitMath, otherwise line-for-line):
/// - uint256/uint8 become uint (SolidVM integers are unbounded, x is capped at 2^256-1 by use)
/// - type(uintN).max becomes the equivalent hex literal (type(...).max is not implemented)
library BitMath {
    /// @notice Returns the index of the most significant bit of the number,
    ///     where the least significant bit is at index 0 and the most significant bit is at index 255
    /// @dev The function satisfies the property:
    ///     x >= 2**mostSignificantBit(x) and x < 2**(mostSignificantBit(x)+1)
    /// @param x the value for which to compute the most significant bit, must be greater than 0
    /// @return r the index of the most significant bit
    function mostSignificantBit(uint x) internal pure returns (uint) {
        require(x > 0);
        uint r = 0;

        if (x >= 0x100000000000000000000000000000000) {
            x >>= 128;
            r += 128;
        }
        if (x >= 0x10000000000000000) {
            x >>= 64;
            r += 64;
        }
        if (x >= 0x100000000) {
            x >>= 32;
            r += 32;
        }
        if (x >= 0x10000) {
            x >>= 16;
            r += 16;
        }
        if (x >= 0x100) {
            x >>= 8;
            r += 8;
        }
        if (x >= 0x10) {
            x >>= 4;
            r += 4;
        }
        if (x >= 0x4) {
            x >>= 2;
            r += 2;
        }
        if (x >= 0x2) r += 1;
        return r;
    }

    /// @notice Returns the index of the least significant bit of the number,
    ///     where the least significant bit is at index 0 and the most significant bit is at index 255
    /// @dev The function satisfies the property:
    ///     (x & 2**leastSignificantBit(x)) != 0 and (x & (2**(leastSignificantBit(x)) - 1)) == 0)
    /// @param x the value for which to compute the least significant bit, must be greater than 0
    /// @return r the index of the least significant bit
    function leastSignificantBit(uint x) internal pure returns (uint) {
        require(x > 0);
        uint r = 255;

        if (x & 0xffffffffffffffffffffffffffffffff > 0) {
            r -= 128;
        } else {
            x >>= 128;
        }
        if (x & 0xffffffffffffffff > 0) {
            r -= 64;
        } else {
            x >>= 64;
        }
        if (x & 0xffffffff > 0) {
            r -= 32;
        } else {
            x >>= 32;
        }
        if (x & 0xffff > 0) {
            r -= 16;
        } else {
            x >>= 16;
        }
        if (x & 0xff > 0) {
            r -= 8;
        } else {
            x >>= 8;
        }
        if (x & 0xf > 0) {
            r -= 4;
        } else {
            x >>= 4;
        }
        if (x & 0x3 > 0) {
            r -= 2;
        } else {
            x >>= 2;
        }
        if (x & 0x1 > 0) r -= 1;
        return r;
    }
}
