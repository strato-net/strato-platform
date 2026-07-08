// SPDX-License-Identifier: MIT
import "TickMath.sol";
import "LiquidityMath.sol";

/// @notice Per-tick state (canonical Tick.Info; file-level struct because SolidVM does not
///         support library-nested struct references)
struct V3TickInfo {
    // the total position liquidity that references this tick
    uint liquidityGross;
    // amount of net liquidity added (subtracted) when tick is crossed from left to right (right to left),
    int liquidityNet;
    // fee growth per unit of liquidity on the _other_ side of this tick (relative to the current tick)
    // only has relative meaning, not absolute — the value depends on when the tick is initialized
    int feeGrowthOutside0X128;
    int feeGrowthOutside1X128;
    // the cumulative tick value on the other side of the tick
    int tickCumulativeOutside;
    // the seconds per unit of liquidity on the _other_ side of this tick (relative to the current tick)
    // only has relative meaning, not absolute — the value depends on when the tick is initialized
    int secondsPerLiquidityOutsideX128;
    // the seconds spent on the other side of the tick (relative to the current tick)
    // only has relative meaning, not absolute — the value depends on when the tick is initialized
    int secondsOutside;
    // true iff the tick is initialized, i.e. the value is exactly equivalent to the expression liquidityGross != 0
    bool initialized;
}

/// @title Tick
/// @notice Contains functions for managing tick processes and relevant calculations
///
/// SolidVM dialect notes (vs canonical Uniswap V3 Tick, otherwise function-for-function):
/// - uint/int replace uint128/int128/uint256/int56/uint160/uint32; cumulative fields are
///   signed ints — canonical relies on wrap-around subtraction and only deltas of these
///   values are meaningful
/// - tickSpacingToMaxLiquidityPerTick: canonical truncates MIN_TICK / tickSpacing toward
///   zero, SolidVM floors; minTick is derived as -maxTick instead (MIN_TICK == -MAX_TICK)
/// - clear zeroes fields explicitly: canonical's `delete self[tick]` is a no-op through a
///   library storage-mapping parameter in SolidVM (verified by probe)
library Tick {
    /// @notice Derives max liquidity per tick from given tick spacing
    /// @dev Executed within the pool constructor
    /// @param tickSpacing The amount of required tick separation, realized in multiples of `tickSpacing`
    ///     e.g., a tickSpacing of 3 requires ticks to be initialized every 3rd tick i.e., ..., -6, -3, 0, 3, 6, ...
    /// @return The max liquidity per tick
    function tickSpacingToMaxLiquidityPerTick(int tickSpacing) internal pure returns (uint) {
        int maxTick = (TickMath.MAX_TICK / tickSpacing) * tickSpacing;
        int minTick = -maxTick; // canonical: (MIN_TICK / tickSpacing) * tickSpacing, truncated
        uint numTicks = uint((maxTick - minTick) / tickSpacing) + 1;
        return 0xffffffffffffffffffffffffffffffff / numTicks; // type(uint128).max
    }

    /// @notice Retrieves fee growth data
    /// @param self The mapping containing all tick information for initialized ticks
    /// @param tickLower The lower tick boundary of the position
    /// @param tickUpper The upper tick boundary of the position
    /// @param tickCurrent The current tick
    /// @param feeGrowthGlobal0X128 The all-time global fee growth, per unit of liquidity, in token0
    /// @param feeGrowthGlobal1X128 The all-time global fee growth, per unit of liquidity, in token1
    /// @return feeGrowthInside0X128 The all-time fee growth in token0, per unit of liquidity, inside the position's tick boundaries
    /// @return feeGrowthInside1X128 The all-time fee growth in token1, per unit of liquidity, inside the position's tick boundaries
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

        // calculate fee growth below
        int feeGrowthBelow0X128;
        int feeGrowthBelow1X128;
        if (tickCurrent >= tickLower) {
            feeGrowthBelow0X128 = lower.feeGrowthOutside0X128;
            feeGrowthBelow1X128 = lower.feeGrowthOutside1X128;
        } else {
            feeGrowthBelow0X128 = feeGrowthGlobal0X128 - lower.feeGrowthOutside0X128;
            feeGrowthBelow1X128 = feeGrowthGlobal1X128 - lower.feeGrowthOutside1X128;
        }

        // calculate fee growth above
        int feeGrowthAbove0X128;
        int feeGrowthAbove1X128;
        if (tickCurrent < tickUpper) {
            feeGrowthAbove0X128 = upper.feeGrowthOutside0X128;
            feeGrowthAbove1X128 = upper.feeGrowthOutside1X128;
        } else {
            feeGrowthAbove0X128 = feeGrowthGlobal0X128 - upper.feeGrowthOutside0X128;
            feeGrowthAbove1X128 = feeGrowthGlobal1X128 - upper.feeGrowthOutside1X128;
        }

        feeGrowthInside0X128 = feeGrowthGlobal0X128 - feeGrowthBelow0X128 - feeGrowthAbove0X128;
        feeGrowthInside1X128 = feeGrowthGlobal1X128 - feeGrowthBelow1X128 - feeGrowthAbove1X128;
    }

    /// @notice Updates a tick and returns true if the tick was flipped from initialized to uninitialized, or vice versa
    /// @param self The mapping containing all tick information for initialized ticks
    /// @param tick The tick that will be updated
    /// @param tickCurrent The current tick
    /// @param liquidityDelta A new amount of liquidity to be added (subtracted) when tick is crossed from left to right (right to left)
    /// @param feeGrowthGlobal0X128 The all-time global fee growth, per unit of liquidity, in token0
    /// @param feeGrowthGlobal1X128 The all-time global fee growth, per unit of liquidity, in token1
    /// @param secondsPerLiquidityCumulativeX128 The all-time seconds per max(1, liquidity) of the pool
    /// @param tickCumulative The tick * time elapsed since the pool was first initialized
    /// @param time The current block timestamp
    /// @param upper true for updating a position's upper tick, or false for updating a position's lower tick
    /// @param maxLiquidity The maximum liquidity allocation for a single tick
    /// @return flipped Whether the tick was flipped from initialized to uninitialized, or vice versa
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
    ) internal returns (bool flipped) {
        V3TickInfo storage info = self[tick];

        uint liquidityGrossBefore = info.liquidityGross;
        uint liquidityGrossAfter = LiquidityMath.addDelta(liquidityGrossBefore, liquidityDelta);

        require(liquidityGrossAfter <= maxLiquidity, "LO");

        flipped = (liquidityGrossAfter == 0) != (liquidityGrossBefore == 0);

        if (liquidityGrossBefore == 0) {
            // by convention, we assume that all growth before a tick was initialized happened _below_ the tick
            if (tick <= tickCurrent) {
                info.feeGrowthOutside0X128 = feeGrowthGlobal0X128;
                info.feeGrowthOutside1X128 = feeGrowthGlobal1X128;
                info.secondsPerLiquidityOutsideX128 = secondsPerLiquidityCumulativeX128;
                info.tickCumulativeOutside = tickCumulative;
                info.secondsOutside = int(time);
            }
            info.initialized = true;
        }

        info.liquidityGross = liquidityGrossAfter;

        // when the lower (upper) tick is crossed left to right (right to left), liquidity must be added (removed)
        info.liquidityNet = upper
            ? info.liquidityNet - liquidityDelta
            : info.liquidityNet + liquidityDelta;
    }

    /// @notice Clears tick data
    /// @param self The mapping containing all initialized tick information for initialized ticks
    /// @param tick The tick that will be cleared
    /// @dev Canonical is `delete self[tick]`, a no-op through a library storage-mapping
    ///      parameter in SolidVM — fields are zeroed explicitly instead
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

    /// @notice Transitions to next tick as needed by price movement
    /// @param self The mapping containing all tick information for initialized ticks
    /// @param tick The destination tick of the transition
    /// @param feeGrowthGlobal0X128 The all-time global fee growth, per unit of liquidity, in token0
    /// @param feeGrowthGlobal1X128 The all-time global fee growth, per unit of liquidity, in token1
    /// @param secondsPerLiquidityCumulativeX128 The current seconds per liquidity
    /// @param tickCumulative The tick * time elapsed since the pool was first initialized
    /// @param time The current block.timestamp
    /// @return liquidityNet The amount of liquidity added (subtracted) when tick is crossed from left to right (right to left)
    function cross(
        mapping(int => V3TickInfo) storage self,
        int tick,
        int feeGrowthGlobal0X128,
        int feeGrowthGlobal1X128,
        int secondsPerLiquidityCumulativeX128,
        int tickCumulative,
        uint time
    ) internal returns (int liquidityNet) {
        V3TickInfo storage info = self[tick];
        info.feeGrowthOutside0X128 = feeGrowthGlobal0X128 - info.feeGrowthOutside0X128;
        info.feeGrowthOutside1X128 = feeGrowthGlobal1X128 - info.feeGrowthOutside1X128;
        info.secondsPerLiquidityOutsideX128 = secondsPerLiquidityCumulativeX128 - info.secondsPerLiquidityOutsideX128;
        info.tickCumulativeOutside = tickCumulative - info.tickCumulativeOutside;
        info.secondsOutside = int(time) - info.secondsOutside;
        liquidityNet = info.liquidityNet;
    }
}
