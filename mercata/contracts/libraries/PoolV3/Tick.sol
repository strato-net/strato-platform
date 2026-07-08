// SPDX-License-Identifier: MIT
import "TickMath.sol";

/// @notice Per-tick state (canonical Tick.Info; declared at file level because SolidVM does
///         not support library-nested struct references). Cumulative fields are signed ints —
///         SolidVM has no wrapping arithmetic, and only deltas of these are meaningful
struct V3TickInfo {
    uint liquidityGross;
    int liquidityNet;
    int feeGrowthOutside0X128;
    int feeGrowthOutside1X128;
    int tickCumulativeOutside;
    int secondsPerLiquidityOutsideX128;
    int secondsOutside;
    bool initialized;
}

/// @title Tick
/// @notice Per-tick liquidity and growth-tracking, ported from Uniswap V3 core's Tick library
library Tick {
    /// @notice Max position liquidity per tick for a tick spacing
    ///         (canonical tickSpacingToMaxLiquidityPerTick)
    /// @dev MIN_TICK == -MAX_TICK exactly, so the canonical truncated MIN_TICK / tickSpacing
    ///      equals -(MAX_TICK / tickSpacing) without relying on division semantics
    function tickSpacingToMaxLiquidityPerTick(int tickSpacing) internal pure returns (uint) {
        int maxUsableTick = (TickMath.MAX_TICK / tickSpacing) * tickSpacing;
        uint numTicks = uint((maxUsableTick * 2) / tickSpacing + 1);
        return (2**128 - 1) / numTicks;
    }

    /// @notice Fee growth inside a tick range (canonical getFeeGrowthInside; may be
    ///         transiently negative — deltas are what matter)
    function getFeeGrowthInside(
        mapping(int => V3TickInfo) storage self,
        int tickLower,
        int tickUpper,
        int tickCurrent,
        int feeGrowthGlobal0X128,
        int feeGrowthGlobal1X128
    ) internal view returns (int feeGrowthInside0X128, int feeGrowthInside1X128) {
        V3TickInfo storage lower = self[tickLower];
        V3TickInfo storage upper = self[tickUpper];

        int below0 = tickCurrent >= tickLower ? lower.feeGrowthOutside0X128 : feeGrowthGlobal0X128 - lower.feeGrowthOutside0X128;
        int below1 = tickCurrent >= tickLower ? lower.feeGrowthOutside1X128 : feeGrowthGlobal1X128 - lower.feeGrowthOutside1X128;
        int above0 = tickCurrent < tickUpper ? upper.feeGrowthOutside0X128 : feeGrowthGlobal0X128 - upper.feeGrowthOutside0X128;
        int above1 = tickCurrent < tickUpper ? upper.feeGrowthOutside1X128 : feeGrowthGlobal1X128 - upper.feeGrowthOutside1X128;

        feeGrowthInside0X128 = feeGrowthGlobal0X128 - below0 - above0;
        feeGrowthInside1X128 = feeGrowthGlobal1X128 - below1 - above1;
        return (feeGrowthInside0X128, feeGrowthInside1X128);
    }

    /// @notice Update a tick's liquidity bookkeeping for a position change (canonical update)
    /// @return True when the tick flipped between zero and nonzero liquidity; the caller
    ///         flips the bitmap and, on burns, clears the tick after its final fee accrual
    function update(
        mapping(int => V3TickInfo) storage self,
        int tick,
        int tickCurrent,
        int liquidityDelta,
        int feeGrowthGlobal0X128,
        int feeGrowthGlobal1X128,
        int secondsPerLiquidityCumulativeX128,
        int tickCumulative,
        uint time,
        bool upper,
        uint maxLiquidity
    ) internal returns (bool) {
        V3TickInfo storage info = self[tick];
        // liquidityGross tracks total liquidity referencing this tick; add and remove
        // apply the same signed delta because a position references each of its ticks once
        int grossAfterSigned = int(info.liquidityGross) + liquidityDelta;
        require(grossAfterSigned >= 0, "Tick liquidity underflow");
        uint liquidityGrossBefore = info.liquidityGross;
        uint liquidityGrossAfter = uint(grossAfterSigned);
        require(liquidityGrossAfter <= maxLiquidity, "LO");

        if (liquidityGrossBefore == 0 && liquidityGrossAfter > 0) {
            // Convention (as canonical): assume all prior growth happened below the tick
            if (tick <= tickCurrent) {
                info.feeGrowthOutside0X128 = feeGrowthGlobal0X128;
                info.feeGrowthOutside1X128 = feeGrowthGlobal1X128;
                info.tickCumulativeOutside = tickCumulative;
                info.secondsPerLiquidityOutsideX128 = secondsPerLiquidityCumulativeX128;
                info.secondsOutside = int(time);
            } else {
                info.feeGrowthOutside0X128 = 0;
                info.feeGrowthOutside1X128 = 0;
                info.tickCumulativeOutside = 0;
                info.secondsPerLiquidityOutsideX128 = 0;
                info.secondsOutside = 0;
            }
            info.initialized = true;
        }

        info.liquidityGross = liquidityGrossAfter;
        if (upper) {
            info.liquidityNet -= liquidityDelta;
        } else {
            info.liquidityNet += liquidityDelta;
        }

        if ((liquidityGrossAfter == 0) != (liquidityGrossBefore == 0)) {
            return true;
        }
        return false;
    }

    /// @notice Fully reset a tick whose liquidity dropped to zero (canonical clear).
    ///         Must run only after the owning position's final fee accrual: clearing first
    ///         would zero the outside snapshots getFeeGrowthInside is about to read
    function clear(mapping(int => V3TickInfo) storage self, int tick) internal {
        V3TickInfo storage info = self[tick];
        info.liquidityGross = 0;
        info.liquidityNet = 0;
        info.feeGrowthOutside0X128 = 0;
        info.feeGrowthOutside1X128 = 0;
        info.tickCumulativeOutside = 0;
        info.secondsPerLiquidityOutsideX128 = 0;
        info.secondsOutside = 0;
        info.initialized = false;
    }

    /// @notice Cross a tick during a swap, flipping its outside snapshots (canonical cross)
    /// @return liquidityNet The signed liquidity change; the caller negates it for
    ///         zero-for-one swaps and applies it to the pool's active liquidity
    function cross(
        mapping(int => V3TickInfo) storage self,
        int tick,
        int feeGrowthGlobal0X128,
        int feeGrowthGlobal1X128,
        int secondsPerLiquidityCumulativeX128,
        int tickCumulative,
        uint time
    ) internal returns (int) {
        V3TickInfo storage info = self[tick];
        info.feeGrowthOutside0X128 = feeGrowthGlobal0X128 - info.feeGrowthOutside0X128;
        info.feeGrowthOutside1X128 = feeGrowthGlobal1X128 - info.feeGrowthOutside1X128;
        info.tickCumulativeOutside = tickCumulative - info.tickCumulativeOutside;
        info.secondsPerLiquidityOutsideX128 = secondsPerLiquidityCumulativeX128 - info.secondsPerLiquidityOutsideX128;
        info.secondsOutside = int(time) - info.secondsOutside;
        return info.liquidityNet;
    }
}
