/**
 * @title OracleTypes
 * @notice Shared struct types for PriceOracle TWAP (queue of historical points + current).
 */
library OracleTypes {
    /// @dev Per-asset state: queue of (timestamp, price) entries. When full, writeIndex is next slot to overwrite (oldest). Current price in PriceOracle.prices/lastUpdated.
    struct OracleState {
        uint256[] timestamps;
        uint256[] prices;
        uint256 writeIndex; // ring buffer: oldest slot when at capacity
    }
}
