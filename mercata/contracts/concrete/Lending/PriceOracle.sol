import "../../abstract/ERC20/access/Ownable.sol";

/**
 * @title PriceOracle
 * @notice Provides asset price feeds used for loan value and collateral validation.
 * @dev Asset prices are set manually for now; can be upgraded to use external oracles.
 *      TWAP = time-weighted average over last queueSize+1 prices. Queue size is per-asset.
 */
contract record PriceOracle is Ownable {
    struct Observation {
        uint256 timestamp;
        uint256 price;
    }

    /// @dev Per-asset state: queue of observations. When full, writeIndex is next slot to overwrite (oldest).
    struct OracleState {
        Observation[] observations;
        uint256 writeIndex;
        uint256 queueSize;
    }

    // Asset price storage (price in 8-decimal format: 1e8 = $1.00)
    mapping(address => uint256) public record prices;
    mapping(address => uint256) public record lastUpdated;
    mapping(address => OracleState) public record oracleState;

    uint256 public queueSize = 2;  // Global queue size, synced to per-asset on push

    // Events
    event PriceUpdated(address indexed asset, uint256 price, uint256 timestamp);
    event BatchPricesUpdated(address[] assets, uint256[] priceValues, uint256 timestamp);

    constructor(address _owner) Ownable(_owner) {}

    function initialize() external onlyOwner {
        // @dev important: must be set here for proxied instances; ensure consistency with desired initial values
        queueSize = 2;
    }

    /**
     * @dev Rotate ring buffer to linear order (oldest at index 0).
     *      NOTE: Uses temp variables when copying from storage to avoid solid-vm reference bug.
     */
    function _rotateToLinear(address asset) internal {
        OracleState storage state = oracleState[asset];
        uint256 len = state.observations.length;
        uint256 w = state.writeIndex;
        if (len <= 1 || w == 0) {
            state.writeIndex = 0;
            return;
        }
        // Copy to memory in chronological order (oldest first)
        // NOTE: solid-vm creates references instead of copies when assigning directly from storage.
        // Using separate primitive arrays avoids struct reference issues.
        uint256[] memory ts = new uint256[](len);
        uint256[] memory px = new uint256[](len);
        for (uint256 i = 0; i < len; i++) {
            uint256 idx = (w + i) % len;
            uint256 tmpTs = state.observations[idx].timestamp;
            uint256 tmpPx = state.observations[idx].price;
            ts[i] = tmpTs;
            px[i] = tmpPx;
        }
        // Write back in order
        for (uint256 j = 0; j < len; j++) {
            state.observations[j].timestamp = ts[j];
            state.observations[j].price = px[j];
        }
        state.writeIndex = 0;
    }

    /**
     * @dev Sync per-asset queue size to global, with rotation and resize if needed.
     */
    function _syncQueueSize(address asset) internal {
        OracleState storage state = oracleState[asset];
        uint256 globalSize = queueSize;
        if (state.queueSize == globalSize) return;
        
        _rotateToLinear(asset);
        uint256 len = state.observations.length;
        
        if (len > globalSize) {
            // Shrink: keep most recent entries (at end after rotation)
            // NOTE: Use temp variables to avoid solid-vm reference bug
            for (uint256 i = 0; i < globalSize; i++) {
                uint256 srcIdx = len - globalSize + i;
                uint256 tmpTs = state.observations[srcIdx].timestamp;
                uint256 tmpPx = state.observations[srcIdx].price;
                state.observations[i].timestamp = tmpTs;
                state.observations[i].price = tmpPx;
            }
            for (uint256 k = globalSize; k < len; k++) {
                state.observations[k].timestamp = 0;
                state.observations[k].price = 0;
            }
            state.observations.length = globalSize;
        }
        state.queueSize = globalSize;
    }

    /**
     * @dev Push the previous (timestamp, price) into the queue. Ring buffer overwrites oldest when full.
     */
    function _pushObservation(address asset, uint256 prevTs, uint256 prevPrice) internal {
        if (prevPrice == 0) return;
        OracleState storage state = oracleState[asset];
        
        // Sync per-asset queue size to global (handles first init and size changes)
        if (state.queueSize != queueSize) {
            _syncQueueSize(asset);
        }
        
        uint256 size = state.queueSize;
        if (size == 0) {
            size = 2; // default queue size if not initialized
        }
        uint256 len = state.observations.length;
        if (len < size) {
            state.observations.push(Observation(prevTs, prevPrice));
        } else {
            uint256 idx = state.writeIndex;
            state.observations[idx].timestamp = prevTs;
            state.observations[idx].price = prevPrice;
            state.writeIndex = (idx + 1) % size;
        }
    }

    /**
     * @dev TWAP over queue points plus current spot price.
     */
    function _twapOverWindow(address asset) internal view returns (uint256) {
        uint256 nowTs = block.timestamp;
        uint256 spot = prices[asset];
        if (spot == 0) return 0;

        OracleState storage state = oracleState[asset];
        uint256 size = state.queueSize;
        if (size == 0) return spot;

        uint256 len = state.observations.length;
        if (len == 0) return spot;

        uint256 w = state.writeIndex;
        bool wrapped = (len == size && w != 0);
        uint256 oldestIndex = wrapped ? w : 0;
        uint256 t0 = state.observations[oldestIndex].timestamp;

        if (nowTs <= t0) return state.observations[oldestIndex].price;

        uint256 weighted = 0;
        for (uint256 i = 0; i < len; i++) {
            uint256 idx = wrapped ? (w + i) % len : i;
            uint256 tStart = state.observations[idx].timestamp;
            uint256 tEnd = (i + 1 < len)
                ? state.observations[wrapped ? (w + i + 1) % len : (i + 1)].timestamp
                : lastUpdated[asset];
            weighted += state.observations[idx].price * (tEnd - tStart);
        }

        weighted += spot * (nowTs - lastUpdated[asset]);

        uint256 window = nowTs - t0;
        if (window == 0) return spot;
        return weighted / window;
    }

    /**
     * @dev Internal helper to set price for a single asset with validation
     */
    function _setAssetPrice(address asset, uint256 price) internal {
        require(asset != address(0), "Invalid asset address");
        require(price > 0, "Price must be greater than 0");

        _pushObservation(asset, lastUpdated[asset], prices[asset]);
        prices[asset] = price;
        lastUpdated[asset] = block.timestamp;
    }

    /**
     * @dev Set global TWAP queue size. Per-asset queues sync on next push. Only owner.
     */
    function setTwapQueueSize(uint256 newSize) external onlyOwner {
        require(newSize > 0, "Queue size must be > 0");
        queueSize = newSize;
    }

    /**
     * @dev Set price for a single asset
     */
    function setAssetPrice(address asset, uint256 price) external onlyOwner {
        _setAssetPrice(asset, price);
        emit PriceUpdated(asset, price, block.timestamp);
    }

    /**
     * @dev Set prices for multiple assets in batch (main function for oracle service)
     */
    function setAssetPrices(address[] calldata assets, uint256[] calldata priceValues) external onlyOwner {
        require(assets.length == priceValues.length, "Arrays length mismatch");
        require(assets.length > 0, "Empty arrays");

        for (uint256 i = 0; i < assets.length; i++) {
            _setAssetPrice(assets[i], priceValues[i]);
        }

        emit BatchPricesUpdated(assets, priceValues, block.timestamp);
    }

    /**
     * @dev Get price for an asset
     */
    function getAssetPrice(address asset) external view returns (uint256) {
        require(asset != address(0), "Invalid asset address");
        uint256 price = prices[asset];
        require(price > 0, "Price not available");
        return price;
    }

    /**
     * @dev Get price with timestamp for an asset
     */
    function getAssetPriceWithTimestamp(address asset) external view returns (uint256 price, uint256 timestamp) {
        require(asset != address(0), "Invalid asset address");
        price = prices[asset];
        require(price > 0, "Price not available");
        timestamp = lastUpdated[asset];
        return (price, timestamp);
    }

    /**
     * @dev Get TWAP over queue history plus current.
     */
    function getAssetPriceTwap(address asset) external view returns (uint256) {
        require(asset != address(0), "Invalid asset address");
        uint256 twap = _twapOverWindow(asset);
        require(twap > 0, "TWAP not available");
        return twap;
    }

    /**
     * @dev Get TWAP and timestamp of most recent update.
     */
    function getAssetPriceTwapWithTimestamp(address asset) external view returns (uint256 price, uint256 timestamp) {
        require(asset != address(0), "Invalid asset address");
        price = _twapOverWindow(asset);
        require(price > 0, "TWAP not available");
        timestamp = lastUpdated[asset];
        return (price, timestamp);
    }

    /**
     * @dev Check if price is fresh (updated within specified time)
     */
    function isPriceFresh(address asset, uint256 maxAge) external view returns (bool) {
        if (prices[asset] == 0) return false;
        return (block.timestamp - lastUpdated[asset]) <= maxAge;
    }

    function getOracleState(address asset) external view returns (OracleState memory) {
        return oracleState[asset];
    }
}
