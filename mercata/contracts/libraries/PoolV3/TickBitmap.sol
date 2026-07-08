// SPDX-License-Identifier: MIT
import "BitMath.sol";

/// @title TickBitmap
/// @notice Packed initialized-tick state, ported from Uniswap V3 core's TickBitmap: one
///         256-bit word per 256 tick-spacings, one bit per initialized tick
/// @dev SolidVM notes: `^`/`~`/variable shifts are unavailable, so the flip is an
///      add/subtract and masks come from BitMath.pow2 arithmetic; the word index is a
///      plain int key (canonical packs into int16). SolidVM's `/` already floors negative
///      division, so tick compression needs no truncation correction
library TickBitmap {
    uint internal constant MAX_WORD = 115792089237316195423570985008687907853269984665640564039457584007913129639935; // 2**256 - 1

    /// @notice (word index, bit index) of a compressed tick (canonical position())
    /// @dev SolidVM's `/` floors negative division, matching canonical's arithmetic
    ///      right-shift (>> 8) directly, so the bit offset is always in [0, 255]
    function position(int compressed) internal pure returns (int, uint) {
        int wordPos = compressed / 256;
        uint bitPos = uint(compressed - wordPos * 256);
        return (wordPos, bitPos);
    }

    /// @notice Flip a tick's initialized bit in the bitmap (canonical flipTick)
    function flipTick(mapping(int => uint) storage self, int tick, int tickSpacing) internal {
        require(tick % tickSpacing == 0, "Tick not spaced");
        (int wordPos, uint bitPos) = position(tick / tickSpacing);
        uint bit = BitMath.pow2(bitPos);
        uint word = self[wordPos];
        // XOR without ^: add the bit if clear, remove it if set
        if ((word & bit) != 0) {
            self[wordPos] = word - bit;
        } else {
            self[wordPos] = word + bit;
        }
    }

    /// @notice Next initialized tick within one bitmap word, in the swap direction
    ///         (canonical nextInitializedTickWithinOneWord)
    /// @param tick The current tick (need not be spacing-aligned)
    /// @param lte If true search at-or-below `tick` (price moving down), else strictly above
    /// @return next The next initialized tick, or the word boundary if the word has no set bits
    /// @return initialized Whether `next` is an initialized tick (false = word-boundary sentinel)
    /// @dev Word-boundary results let the swap loop step word by word, exactly as canonical;
    ///      the caller must clamp `next` to [MIN_TICK, MAX_TICK]
    function nextInitializedTickWithinOneWord(
        mapping(int => uint) storage self,
        int tick,
        int tickSpacing,
        bool lte
    ) internal view returns (int, bool) {
        int compressed = tick / tickSpacing; // floors on SolidVM (canonical needs a correction)

        if (lte) {
            (int wordPos, uint bitPos) = position(compressed);
            // Bits at or below bitPos
            uint mask = MAX_WORD;
            if (bitPos < 255) {
                mask = BitMath.pow2(bitPos + 1) - 1;
            }
            uint masked = self[wordPos] & mask;
            if (masked != 0) {
                return ((compressed - int(bitPos - BitMath.mostSignificantBit(masked))) * tickSpacing, true);
            }
            return ((compressed - int(bitPos)) * tickSpacing, false);
        }

        (int wordPosUp, uint bitPosUp) = position(compressed + 1);
        // Bits at or above bitPosUp: subtract off the low bits
        uint word = self[wordPosUp];
        uint lowMask = 0;
        if (bitPosUp > 0) {
            lowMask = BitMath.pow2(bitPosUp) - 1;
        }
        uint maskedUp = word - (word & lowMask);
        if (maskedUp != 0) {
            return ((compressed + 1 + int(BitMath.leastSignificantBit(maskedUp) - bitPosUp)) * tickSpacing, true);
        }
        return ((compressed + 1 + int(255 - bitPosUp)) * tickSpacing, false);
    }
}
