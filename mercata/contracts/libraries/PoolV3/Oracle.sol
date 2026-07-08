// SPDX-License-Identifier: MIT
import "FixedPoint128.sol";

/// @notice A TWAP oracle checkpoint (canonical Oracle.Observation; file-level struct because
///         SolidVM does not support library-nested struct references). Timestamps are
///         full-width and cumulatives are signed ints — no uint32/uint wrap semantics
struct V3Observation {
    uint blockTimestamp;
    int tickCumulative;
    int secondsPerLiquidityCumulativeX128;
    bool initialized;
}

/// @title Oracle
/// @notice Accumulator-observation ring buffer, ported from Uniswap V3 core's Oracle library.
///         The ring lives in a mapping (canonical uses a fixed Observation[65535] array;
///         SolidVM mappings need no slot pre-warming, so canonical grow() has no equivalent —
///         the pool just raises cardinalityNext)
library Oracle {
    /// @dev Division truncating toward zero, as the EVM does. SolidVM's `/` floors instead
    ///      (-7 / 2 == -4), so the canonical tick interpolation below needs the truncated
    ///      form for bit-identical results
    function divTrunc(int a, int b) internal pure returns (int) {
        int q = a / b;
        if (a % b != 0 && ((a < 0) != (b < 0))) {
            return q + 1;
        }
        return q;
    }

    /// @dev Accumulator values extrapolated from `last` to `blockTimestamp` (canonical transform)
    function transform(
        V3Observation storage last,
        uint blockTimestamp,
        int tick,
        uint liquidity
    ) internal view returns (uint, int, int) {
        uint delta = blockTimestamp - last.blockTimestamp;
        return (
            blockTimestamp,
            last.tickCumulative + tick * int(delta),
            last.secondsPerLiquidityCumulativeX128
                + int((delta * FixedPoint128.Q128) / (liquidity > 0 ? liquidity : 1))
        );
    }

    /// @notice Bootstrap the ring with a single observation (canonical initialize)
    /// @return cardinality The initial ring size (1)
    /// @return cardinalityNext The initial pending ring size (1)
    function initialize(mapping(uint => V3Observation) storage self, uint time) internal returns (uint, uint) {
        V3Observation storage obs0 = self[0];
        obs0.blockTimestamp = time;
        obs0.tickCumulative = 0;
        obs0.secondsPerLiquidityCumulativeX128 = 0;
        obs0.initialized = true;
        return (1, 1);
    }

    /// @notice Record a checkpoint (at most one per timestamp; canonical write)
    /// @param tick The tick in effect SINCE the previous observation
    /// @param liquidity The in-range liquidity in effect since the previous observation
    /// @return indexUpdated The new most-recent slot
    /// @return cardinalityUpdated The new ring size
    function write(
        mapping(uint => V3Observation) storage self,
        uint index,
        uint blockTimestamp,
        int tick,
        uint liquidity,
        uint cardinality,
        uint cardinalityNext
    ) internal returns (uint, uint) {
        V3Observation storage last = self[index];
        if (last.blockTimestamp == blockTimestamp) {
            return (index, cardinality);
        }

        // Grow into pre-announced slots only when the ring is about to wrap (canonical)
        uint cardinalityUpdated = cardinality;
        if (cardinalityNext > cardinality && index == cardinality - 1) {
            cardinalityUpdated = cardinalityNext;
        }

        (uint ts, int tickCum, int splCum) = transform(last, blockTimestamp, tick, liquidity);
        uint indexUpdated = (index + 1) % cardinalityUpdated;

        V3Observation storage obs = self[indexUpdated];
        obs.blockTimestamp = ts;
        obs.tickCumulative = tickCum;
        obs.secondsPerLiquidityCumulativeX128 = splCum;
        obs.initialized = true;

        return (indexUpdated, cardinalityUpdated);
    }

    /// @dev Ring binary search for the two observations straddling `target`
    ///      (canonical binarySearch). Precondition: oldest.blockTimestamp <= target and
    ///      target < newest.blockTimestamp
    function binarySearch(
        mapping(uint => V3Observation) storage self,
        uint target,
        uint index,
        uint cardinality
    ) internal view returns (uint, uint) {
        int l = int((index + 1) % cardinality); // oldest slot
        int r = l + int(cardinality) - 1;       // newest slot (mod cardinality)

        // Bounded defensively; the precondition guarantees convergence well within this
        for (uint iter = 0; iter < 2 * cardinality + 16; iter++) {
            int i = (l + r) / 2;
            uint beforeIdx = uint(i) % cardinality;
            V3Observation storage beforeOrAt = self[beforeIdx];

            // Uninitialized slots (ring grew but hasn't wrapped): keep to the recent side
            if (!beforeOrAt.initialized) {
                l = i + 1;
                continue;
            }

            uint afterIdx = (uint(i) + 1) % cardinality;
            V3Observation storage atOrAfter = self[afterIdx];

            if (beforeOrAt.blockTimestamp <= target && target <= atOrAfter.blockTimestamp) {
                return (beforeIdx, afterIdx);
            }
            if (beforeOrAt.blockTimestamp > target) {
                r = i - 1;
            } else {
                l = i + 1;
            }
        }
        require(false, "Observation search failed");
        return (0, 0);
    }

    /// @notice Accumulator values as of `secondsAgo` seconds before `time`
    ///         (canonical observeSingle)
    /// @dev Reverts 'OLD' when the ring no longer holds data that far back
    function observeSingle(
        mapping(uint => V3Observation) storage self,
        uint time,
        uint secondsAgo,
        int tick,
        uint index,
        uint liquidity,
        uint cardinality
    ) internal view returns (int, int) {
        if (secondsAgo == 0) {
            V3Observation storage last = self[index];
            if (last.blockTimestamp == time) {
                return (last.tickCumulative, last.secondsPerLiquidityCumulativeX128);
            }
            (, int tickCumNow, int splCumNow) = transform(last, time, tick, liquidity);
            return (tickCumNow, splCumNow);
        }

        uint target = time - secondsAgo;

        // At or after the newest observation: extrapolate with the current tick/liquidity
        V3Observation storage newest = self[index];
        if (newest.blockTimestamp <= target) {
            if (newest.blockTimestamp == target) {
                return (newest.tickCumulative, newest.secondsPerLiquidityCumulativeX128);
            }
            (, int tickCumAt, int splCumAt) = transform(newest, target, tick, liquidity);
            return (tickCumAt, splCumAt);
        }

        // Older than the oldest retained observation: unanswerable
        uint oldestIdx = (index + 1) % cardinality;
        V3Observation storage oldestCandidate = self[oldestIdx];
        if (!oldestCandidate.initialized) {
            oldestIdx = 0; // ring grew but has not wrapped: true oldest is slot 0
        }
        V3Observation storage oldest = self[oldestIdx];
        require(oldest.blockTimestamp <= target, "OLD");

        (uint beforeIdx, uint afterIdx) = binarySearch(self, target, index, cardinality);
        V3Observation storage beforeOrAt = self[beforeIdx];
        V3Observation storage atOrAfter = self[afterIdx];

        if (beforeOrAt.blockTimestamp == target) {
            return (beforeOrAt.tickCumulative, beforeOrAt.secondsPerLiquidityCumulativeX128);
        }
        if (atOrAfter.blockTimestamp == target) {
            return (atOrAfter.tickCumulative, atOrAfter.secondsPerLiquidityCumulativeX128);
        }

        // Interpolate exactly as canonical: tickCumulative divides first with EVM
        // truncation semantics; secondsPerLiquidity multiplies first
        uint obsDelta = atOrAfter.blockTimestamp - beforeOrAt.blockTimestamp;
        uint targetDelta = target - beforeOrAt.blockTimestamp;
        int tickCum = beforeOrAt.tickCumulative
            + divTrunc(atOrAfter.tickCumulative - beforeOrAt.tickCumulative, int(obsDelta)) * int(targetDelta);
        int splCum = beforeOrAt.secondsPerLiquidityCumulativeX128
            + int((uint(atOrAfter.secondsPerLiquidityCumulativeX128 - beforeOrAt.secondsPerLiquidityCumulativeX128)
                   * targetDelta) / obsDelta);
        return (tickCum, splCum);
    }
}
