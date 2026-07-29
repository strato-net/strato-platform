// SPDX-License-Identifier: MIT

/// @notice A TWAP oracle checkpoint (canonical Oracle.Observation; file-level struct because
///         SolidVM does not support library-nested struct references)
struct V3Observation {
    // the block timestamp of the observation
    uint blockTimestamp;
    // the tick accumulator, i.e. tick * time elapsed since the pool was first initialized
    int tickCumulative;
    // the seconds per liquidity, i.e. seconds elapsed / max(1, liquidity) since the pool was first initialized
    int secondsPerLiquidityCumulativeX128;
    // whether or not the observation is initialized
    bool initialized;
}

/// @title Oracle
/// @notice Provides price and liquidity data useful for a wide variety of system designs
/// @dev Instances of stored oracle data, "observations", are collected in the oracle ring.
/// Every pool is initialized with an oracle ring length of 1. Anyone can grow the maximum
/// length of the oracle ring. New slots will be added when the ring is fully populated.
/// Observations are overwritten when the full length of the oracle ring is populated.
/// The most recent observation is available, independent of the length of the oracle ring, by passing 0 to observe()
///
/// SolidVM dialect notes (vs canonical Uniswap V3 Oracle, otherwise function-for-function):
/// - The ring lives in a mapping(uint => V3Observation) (canonical: a fixed Observation[65535] array)
/// - uint/int replace uint16/uint32/int24/int56/uint128/uint160; timestamps are full-width and
///   never wrap, so canonical lte()'s uint32-overflow adjustment reduces to a plain comparison
///   and cumulatives are signed ints with no wrap semantics
/// - grow() omits canonical's slot pre-warming loop (an EVM SSTORE gas optimization): mapping
///   slots need no warming, and the pre-warmed values are never read (initialized stays false)
/// - divTrunc replicates the EVM's truncate-toward-zero division in the tick interpolation
///   (SolidVM's `/` floors: -7 / 2 == -4); explicit returns replace named-return fallthrough
/// - SolidVM memory structs are live storage views rather than copies; that is safe here
///   because nothing mutates observations through them
library Oracle {
    /// @dev EVM division truncating toward zero, needed for bit-identical tick interpolation
    function divTrunc(int a, int b) private pure returns (int) {
        int q = a / b;
        if (a % b != 0 && ((a < 0) != (b < 0))) {
            return q + 1;
        }
        return q;
    }

    /// @notice Transforms a previous observation into a new observation, given the passage of time and the current tick and liquidity values
    /// @dev blockTimestamp _must_ be chronologically equal to or greater than last.blockTimestamp
    /// @param last The specified observation to be transformed
    /// @param blockTimestamp The timestamp of the new observation
    /// @param tick The active tick at the time of the new observation
    /// @param liquidity The total in-range liquidity at the time of the new observation
    /// @return V3Observation The newly populated observation
    function transform(
        V3Observation memory last,
        uint blockTimestamp,
        int tick,
        uint liquidity
    ) private pure returns (V3Observation memory) {
        uint delta = blockTimestamp - last.blockTimestamp;
        return
            V3Observation({
                blockTimestamp: blockTimestamp,
                tickCumulative: last.tickCumulative + tick * int(delta),
                secondsPerLiquidityCumulativeX128: last.secondsPerLiquidityCumulativeX128 +
                    int((delta << 128) / (liquidity > 0 ? liquidity : 1)),
                initialized: true
            });
    }

    /// @notice Initialize the oracle ring by writing the first slot. Called once for the lifecycle of the observations ring
    /// @param self The stored oracle ring
    /// @param time The time of the oracle initialization
    /// @return cardinality The number of populated elements in the oracle ring
    /// @return cardinalityNext The new length of the oracle ring, independent of population
    function initialize(mapping(uint => V3Observation) storage self, uint time)
        internal
        returns (uint cardinality, uint cardinalityNext)
    {
        self[0] = V3Observation({
            blockTimestamp: time,
            tickCumulative: 0,
            secondsPerLiquidityCumulativeX128: 0,
            initialized: true
        });
        return (1, 1);
    }

    /// @notice Writes an oracle observation to the ring
    /// @dev Writable at most once per block. Index represents the most recently written element. cardinality and index must be tracked externally.
    /// If the index is at the end of the allowable ring length (according to cardinality), and the next cardinality
    /// is greater than the current one, cardinality may be increased. This restriction is created to preserve ordering.
    /// @param self The stored oracle ring
    /// @param index The index of the observation that was most recently written to the observations ring
    /// @param blockTimestamp The timestamp of the new observation
    /// @param tick The active tick at the time of the new observation
    /// @param liquidity The total in-range liquidity at the time of the new observation
    /// @param cardinality The number of populated elements in the oracle ring
    /// @param cardinalityNext The new length of the oracle ring, independent of population
    /// @return indexUpdated The new index of the most recently written element in the oracle ring
    /// @return cardinalityUpdated The new cardinality of the oracle ring
    function write(
        mapping(uint => V3Observation) storage self,
        uint index,
        uint blockTimestamp,
        int tick,
        uint liquidity,
        uint cardinality,
        uint cardinalityNext
    ) internal returns (uint indexUpdated, uint cardinalityUpdated) {
        V3Observation memory last = self[index];

        // early return if we've already written an observation this block
        if (last.blockTimestamp == blockTimestamp) return (index, cardinality);

        // if the conditions are right, we can bump the cardinality
        if (cardinalityNext > cardinality && index == (cardinality - 1)) {
            cardinalityUpdated = cardinalityNext;
        } else {
            cardinalityUpdated = cardinality;
        }

        indexUpdated = (index + 1) % cardinalityUpdated;
        self[indexUpdated] = transform(last, blockTimestamp, tick, liquidity);
        return (indexUpdated, cardinalityUpdated);
    }

    /// @notice Prepares the oracle ring to store up to `next` observations
    /// @param self The stored oracle ring
    /// @param current The current next cardinality of the oracle ring
    /// @param next The proposed next cardinality which will be populated in the oracle ring
    /// @return next The next cardinality which will be populated in the oracle ring
    function grow(
        mapping(uint => V3Observation) storage self,
        uint current,
        uint next
    ) internal returns (uint) {
        require(current > 0, "I");
        // no-op if the passed next value isn't greater than the current next value
        if (next <= current) return current;
        // canonical pre-warms slots [current, next) here to avoid fresh SSTOREs in swaps;
        // mapping slots need no warming and the values are never read (initialized is false)
        return next;
    }

    /// @notice comparator for timestamps
    /// @dev canonical adjusts for uint32 overflow ("safe for 0 or 1 overflows"); SolidVM
    ///      timestamps are full-width and never wrap, so this reduces to a plain comparison.
    ///      `time` is kept for the canonical signature and call sites
    /// @param time The current block.timestamp
    /// @param a A comparison timestamp from which to determine the relative position of `time`
    /// @param b From which to determine the relative position of `time`
    /// @return bool Whether `a` is chronologically <= `b`
    function lte(
        uint time,
        uint a,
        uint b
    ) private pure returns (bool) {
        return a <= b;
    }

    /// @notice Fetches the observations beforeOrAt and atOrAfter a target, i.e. where [beforeOrAt, atOrAfter] is satisfied.
    /// The result may be the same observation, or adjacent observations.
    /// @dev The answer must be contained in the ring, used when the target is located within the stored observation
    /// boundaries: older than the most recent observation and younger, or the same age as, the oldest observation
    /// @param self The stored oracle ring
    /// @param time The current block.timestamp
    /// @param target The timestamp at which the reserved observation should be for
    /// @param index The index of the observation that was most recently written to the observations ring
    /// @param cardinality The number of populated elements in the oracle ring
    /// @return beforeOrAt The observation recorded before, or at, the target
    /// @return atOrAfter The observation recorded at, or after, the target
    function binarySearch(
        mapping(uint => V3Observation) storage self,
        uint time,
        uint target,
        uint index,
        uint cardinality
    ) private view returns (V3Observation memory, V3Observation memory) {
        V3Observation memory beforeOrAt;
        V3Observation memory atOrAfter;
        uint l = (index + 1) % cardinality; // oldest observation
        uint r = l + cardinality - 1; // newest observation
        uint i;
        while (true) {
            i = (l + r) / 2;

            beforeOrAt = self[i % cardinality];

            // we've landed on an uninitialized tick, keep searching higher (more recently)
            if (!beforeOrAt.initialized) {
                l = i + 1;
                continue;
            }

            atOrAfter = self[(i + 1) % cardinality];

            bool targetAtOrAfter = lte(time, beforeOrAt.blockTimestamp, target);

            // check if we've found the answer!
            if (targetAtOrAfter && lte(time, target, atOrAfter.blockTimestamp)) break;

            if (!targetAtOrAfter) {
                r = i - 1;
            } else {
                l = i + 1;
            }
        }
        return (beforeOrAt, atOrAfter);
    }

    /// @notice Fetches the observations beforeOrAt and atOrAfter a given target, i.e. where [beforeOrAt, atOrAfter] is satisfied
    /// @dev Assumes there is at least 1 initialized observation.
    /// Used by observeSingle() to compute the counterfactual accumulator values as of a given block timestamp.
    /// @param self The stored oracle ring
    /// @param time The current block.timestamp
    /// @param target The timestamp at which the reserved observation should be for
    /// @param tick The active tick at the time of the returned or simulated observation
    /// @param index The index of the observation that was most recently written to the observations ring
    /// @param liquidity The total pool liquidity at the time of the call
    /// @param cardinality The number of populated elements in the oracle ring
    /// @return beforeOrAt The observation which occurred at, or before, the given timestamp
    /// @return atOrAfter The observation which occurred at, or after, the given timestamp
    function getSurroundingObservations(
        mapping(uint => V3Observation) storage self,
        uint time,
        uint target,
        int tick,
        uint index,
        uint liquidity,
        uint cardinality
    ) private view returns (V3Observation memory, V3Observation memory) {
        // optimistically set before to the newest observation
        V3Observation memory beforeOrAt = self[index];
        V3Observation memory atOrAfter;

        // if the target is chronologically at or after the newest observation, we can early return
        if (lte(time, beforeOrAt.blockTimestamp, target)) {
            if (beforeOrAt.blockTimestamp == target) {
                // if newest observation equals target, we're in the same block, so we can ignore atOrAfter
                return (beforeOrAt, atOrAfter);
            } else {
                // otherwise, we need to transform
                return (beforeOrAt, transform(beforeOrAt, target, tick, liquidity));
            }
        }

        // now, set before to the oldest observation
        beforeOrAt = self[(index + 1) % cardinality];
        if (!beforeOrAt.initialized) beforeOrAt = self[0];

        // ensure that the target is chronologically at or after the oldest observation
        require(lte(time, beforeOrAt.blockTimestamp, target), "OLD");

        // if we've reached this point, we have to binary search
        return binarySearch(self, time, target, index, cardinality);
    }

    /// @dev Reverts if an observation at or before the desired observation timestamp does not exist.
    /// 0 may be passed as `secondsAgo' to return the current cumulative values.
    /// If called with a timestamp falling between two observations, returns the counterfactual accumulator values
    /// at exactly the timestamp between the two observations.
    /// @param self The stored oracle ring
    /// @param time The current block timestamp
    /// @param secondsAgo The amount of time to look back, in seconds, at which point to return an observation
    /// @param tick The current tick
    /// @param index The index of the observation that was most recently written to the observations ring
    /// @param liquidity The current in-range pool liquidity
    /// @param cardinality The number of populated elements in the oracle ring
    /// @return tickCumulative The tick * time elapsed since the pool was first initialized, as of `secondsAgo`
    /// @return secondsPerLiquidityCumulativeX128 The time elapsed / max(1, liquidity) since the pool was first initialized, as of `secondsAgo`
    function observeSingle(
        mapping(uint => V3Observation) storage self,
        uint time,
        uint secondsAgo,
        int tick,
        uint index,
        uint liquidity,
        uint cardinality
    ) internal view returns (int tickCumulative, int secondsPerLiquidityCumulativeX128) {
        if (secondsAgo == 0) {
            V3Observation memory last = self[index];
            if (last.blockTimestamp != time) last = transform(last, time, tick, liquidity);
            return (last.tickCumulative, last.secondsPerLiquidityCumulativeX128);
        }

        uint target = time - secondsAgo;

        (V3Observation memory beforeOrAt, V3Observation memory atOrAfter) =
            getSurroundingObservations(self, time, target, tick, index, liquidity, cardinality);

        // sequential ifs with a terminal return (SolidVM's path analysis does not accept
        // canonical's all-branches-return if/else-if/else chain)
        if (target == beforeOrAt.blockTimestamp) {
            // we're at the left boundary
            return (beforeOrAt.tickCumulative, beforeOrAt.secondsPerLiquidityCumulativeX128);
        }
        if (target == atOrAfter.blockTimestamp) {
            // we're at the right boundary
            return (atOrAfter.tickCumulative, atOrAfter.secondsPerLiquidityCumulativeX128);
        }
        // we're in the middle
        uint observationTimeDelta = atOrAfter.blockTimestamp - beforeOrAt.blockTimestamp;
        uint targetDelta = target - beforeOrAt.blockTimestamp;
        return (
            beforeOrAt.tickCumulative +
                divTrunc(atOrAfter.tickCumulative - beforeOrAt.tickCumulative, int(observationTimeDelta)) *
                int(targetDelta),
            beforeOrAt.secondsPerLiquidityCumulativeX128 +
                int(
                    (uint(
                        atOrAfter.secondsPerLiquidityCumulativeX128 - beforeOrAt.secondsPerLiquidityCumulativeX128
                    ) * targetDelta) / observationTimeDelta
                )
        );
    }

    /// @notice Returns the accumulator values as of each time seconds ago from the given time in the array of `secondsAgos`
    /// @dev Reverts if `secondsAgos` > oldest observation
    /// @param self The stored oracle ring
    /// @param time The current block.timestamp
    /// @param secondsAgos Each amount of time to look back, in seconds, at which point to return an observation
    /// @param tick The current tick
    /// @param index The index of the observation that was most recently written to the observations ring
    /// @param liquidity The current in-range pool liquidity
    /// @param cardinality The number of populated elements in the oracle ring
    /// @return tickCumulatives The tick * time elapsed since the pool was first initialized, as of each `secondsAgo`
    /// @return secondsPerLiquidityCumulativeX128s The cumulative seconds / max(1, liquidity) since the pool was first initialized, as of each `secondsAgo`
    function observe(
        mapping(uint => V3Observation) storage self,
        uint time,
        uint[] secondsAgos,
        int tick,
        uint index,
        uint liquidity,
        uint cardinality
    ) internal view returns (int[] memory tickCumulatives, int[] memory secondsPerLiquidityCumulativeX128s) {
        require(cardinality > 0, "I");

        tickCumulatives = new int[](secondsAgos.length);
        secondsPerLiquidityCumulativeX128s = new int[](secondsAgos.length);
        for (uint i = 0; i < secondsAgos.length; i++) {
            // via locals: SolidVM cannot tuple-assign directly into array elements here
            (int tickCumulative, int secondsPerLiquidityCumulativeX128) = observeSingle(
                self,
                time,
                secondsAgos[i],
                tick,
                index,
                liquidity,
                cardinality
            );
            tickCumulatives[i] = tickCumulative;
            secondsPerLiquidityCumulativeX128s[i] = secondsPerLiquidityCumulativeX128;
        }
        return (tickCumulatives, secondsPerLiquidityCumulativeX128s);
    }
}
