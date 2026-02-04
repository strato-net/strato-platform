/**
 * @title OracleTypes
 * @notice Shared struct types for PriceOracle TWAP (append until max, then ring overwrite).
 */
library OracleTypes {
    struct Observation {
        uint256 blockTimestamp;
        uint256 priceCumulative;
    }

    struct OracleState {
        uint256 lastPrice;       // most recent spot price
        uint256 lastTimestamp;  // timestamp of last price update
        uint256 priceCumulative;// integral of price over time
        uint256 index;          // index of most recently written observation (ring mode when full)
        Observation[] observations;
    }
}
