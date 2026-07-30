// SPDX-License-Identifier: MIT
import "BitMath.sol";

/// @title Packed tick initialized state library
/// @notice Stores a packed mapping of tick index to its initialized state
/// @dev The mapping uses int for keys since ticks are represented as int and there are 256 (2^8) values per word.
///
/// SolidVM dialect notes (vs canonical Uniswap V3 TickBitmap, otherwise line-for-line):
/// - int/uint replace int24/int16/uint8/uint256
/// - position(): canonical's `uint8(tick % 256)` relies on a two's-complement cast of the
///   (truncated) negative remainder; SolidVM's uint() cannot do that, but `tick & 255` is
///   the identical value (SolidVM & is two's-complement on negatives, verified by probe)
/// - compressed: SolidVM `/` floors negative division, so canonical's round-toward-negative-
///   infinity correction (`if (tick < 0 && tick % tickSpacing != 0) compressed--`) is built
///   in and must NOT be reapplied
/// - The gte-direction mask: SolidVM has no `~`, so the complement of the low bits is built
///   by subtracting them from 2^256 - 1
library TickBitmap {
    /// @notice Computes the position in the mapping where the initialized bit for a tick lives
    /// @param tick The tick for which to compute the position
    /// @return wordPos The key in the mapping containing the word in which the bit is stored
    /// @return bitPos The bit position in the word where the flag is stored
    function position(int tick) private pure returns (int wordPos, uint bitPos) {
        wordPos = tick >> 8;
        bitPos = uint(tick & 255); // canonical: uint8(tick % 256)
    }

    /// @notice Flips the initialized state for a given tick from false to true, or vice versa
    /// @param self The mapping in which to flip the tick
    /// @param tick The tick to flip
    /// @param tickSpacing The spacing between usable ticks
    function flipTick(
        mapping(int => uint) storage self,
        int tick,
        int tickSpacing
    ) internal {
        require(tick % tickSpacing == 0); // ensure that the tick is spaced
        (int wordPos, uint bitPos) = position(tick / tickSpacing);
        uint mask = 1 << bitPos;
        self[wordPos] ^= mask;
    }

    /// @notice Returns the next initialized tick contained in the same word (or adjacent word) as the tick that is either
    /// to the left (less than or equal to) or right (greater than) of the given tick
    /// @param self The mapping in which to compute the next initialized tick
    /// @param tick The starting tick
    /// @param tickSpacing The spacing between usable ticks
    /// @param lte Whether to search for the next initialized tick to the left (less than or equal to the starting tick)
    /// @return next The next initialized or uninitialized tick up to 256 ticks away from the current tick
    /// @return initialized Whether the next tick is initialized, as the function only searches within up to 256 ticks
    function nextInitializedTickWithinOneWord(
        mapping(int => uint) storage self,
        int tick,
        int tickSpacing,
        bool lte
    ) internal view returns (int next, bool initialized) {
        int compressed = tick / tickSpacing; // SolidVM floors: canonical's negative-tick correction is built in

        if (lte) {
            (int wordPos, uint bitPos) = position(compressed);
            // all the 1s at or to the right of the current bitPos
            uint mask = (1 << bitPos) - 1 + (1 << bitPos);
            uint masked = self[wordPos] & mask;

            // if there are no initialized ticks to the right of or at the current tick, return rightmost in the word
            initialized = masked != 0;
            next = initialized
                ? (compressed - int(bitPos - BitMath.mostSignificantBit(masked))) * tickSpacing
                : (compressed - int(bitPos)) * tickSpacing;
        } else {
            // start from the word of the next tick, since the current tick state doesn't matter
            (int wordPos, uint bitPos) = position(compressed + 1);
            // all the 1s at or to the left of the bitPos; canonical: ~((1 << bitPos) - 1)
            uint mask = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff - ((1 << bitPos) - 1);
            uint masked = self[wordPos] & mask;

            // if there are no initialized ticks to the left of the current tick, return leftmost in the word
            initialized = masked != 0;
            next = initialized
                ? (compressed + 1 + int(BitMath.leastSignificantBit(masked) - bitPos)) * tickSpacing
                : (compressed + 1 + int(255 - bitPos)) * tickSpacing; // canonical: type(uint8).max
        }
    }
}
