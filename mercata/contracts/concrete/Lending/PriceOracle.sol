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
    mapping(address => uint256) public record rebaseFactors;
    mapping(address => uint256) public record exchangeRates;
    mapping(address => uint256) public record priceDeviationThresholdBps;

    uint256 public queueSize = 2;  // Global queue size, synced to per-asset on push

    // Events
    event PriceUpdated(address indexed asset, uint256 price, uint256 timestamp);
    event BatchPricesUpdated(address[] assets, uint256[] priceValues, uint256 timestamp);
    event RebaseFactorsUpdated(address[] assets, uint256[] factors, uint256 timestamp);
    event ExchangeRatesUpdated(address[] assets, uint256[] rates, uint256 timestamp);
    event PriceDeviationThresholdUpdated(address indexed asset, uint256 thresholdBps, uint256 timestamp);
    event PriceDeviationThresholdExceeded(address indexed asset, uint256 previousPrice, uint256 attemptedPrice, uint256 thresholdBps, uint256 timestamp);

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
        for (uint256 i = 0; i < len; i++) {
            state.observations[i].timestamp = ts[i];
            state.observations[i].price = px[i];
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
            for (uint256 i = globalSize; i < len; i++) {
                state.observations[i].timestamp = 0;
                state.observations[i].price = 0;
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
    function _setAssetPrice(address asset, uint256 price) internal returns (bool) {
        require(asset != address(0), "Invalid asset address");
        require(price > 0, "Price must be greater than 0");

        uint256 previousPrice = prices[asset];
        uint256 thresholdBps = priceDeviationThresholdBps[asset];
        if (thresholdBps > 0 && previousPrice > 0 && _exceedsPriceDeviation(previousPrice, price, thresholdBps)) {
            emit PriceDeviationThresholdExceeded(asset, previousPrice, price, thresholdBps, block.timestamp);
            return false;
        }

        _pushObservation(asset, lastUpdated[asset], prices[asset]);
        prices[asset] = price;
        lastUpdated[asset] = block.timestamp;
        return true;
    }

    function _exceedsPriceDeviation(uint256 previousPrice, uint256 newPrice, uint256 thresholdBps) internal pure returns (bool) {
        uint256 maxDeviation = (previousPrice * thresholdBps) / 10000;
        uint256 minPrice = previousPrice > maxDeviation ? previousPrice - maxDeviation : 1;
        uint256 maxPrice = previousPrice + maxDeviation;
        return newPrice < minPrice || newPrice > maxPrice;
    }

    /**
     * @dev Set global TWAP queue size. Per-asset queues sync on next push. Only owner.
     */
    function setTwapQueueSize(uint256 newSize) external onlyOwner {
        require(newSize > 0, "Queue size must be > 0");
        queueSize = newSize;
    }

    function setPriceDeviationThreshold(address asset, uint256 thresholdBps) external onlyOwner {
        require(asset != address(0), "Invalid asset address");
        require(thresholdBps <= 10000, "Threshold too high");
        priceDeviationThresholdBps[asset] = thresholdBps;
        emit PriceDeviationThresholdUpdated(asset, thresholdBps, block.timestamp);
    }

    /**
     * @dev Set price for a single asset
     */
    function setAssetPrice(address asset, uint256 price) external onlyOwner {
        if (_setAssetPrice(asset, price)) {
            emit PriceUpdated(asset, price, block.timestamp);
        }
    }

    /**
     * @dev Set prices for multiple assets in batch (main function for oracle service)
     */
    function setAssetPrices(address[] calldata assets, uint256[] calldata priceValues) external onlyOwner {
        require(assets.length == priceValues.length, "Arrays length mismatch");
        require(assets.length > 0, "Empty arrays");

        bool[] memory updated = new bool[](assets.length);
        uint256 updatedCount = 0;
        for (uint256 i = 0; i < assets.length; i++) {
            if (_setAssetPrice(assets[i], priceValues[i])) {
                updated[i] = true;
                updatedCount++;
            }
        }

        address[] memory updatedAssets = new address[](updatedCount);
        uint256[] memory updatedPriceValues = new uint256[](updatedCount);
        uint256 writeIndex = 0;
        for (uint256 i = 0; i < assets.length; i++) {
            if (updated[i]) {
                updatedAssets[writeIndex] = assets[i];
                updatedPriceValues[writeIndex] = priceValues[i];
                writeIndex++;
            }
        }

        emit BatchPricesUpdated(updatedAssets, updatedPriceValues, block.timestamp);
    }

    /**
     * @dev Set rebase factors for multiple assets in batch.
     *      STRATO tokens do not rebase, but these factors refer to the external asset's multiplier/index.
     */
    function setRebaseFactors(address[] calldata assets, uint256[] calldata factors) external onlyOwner {
        require(assets.length == factors.length, "Arrays length mismatch");
        require(assets.length > 0, "Empty arrays");

        for (uint256 i = 0; i < assets.length; i++) {
            require(assets[i] != address(0), "Invalid asset address");
            rebaseFactors[assets[i]] = factors[i];
        }

        emit RebaseFactorsUpdated(assets, factors, block.timestamp);
    }

    /**
     * @dev Set exchange rates for yield-bearing tokens (e.g. rETH/ETH, wstETH/stETH).
     *      Stored in mapping for other contracts to read; history table used for APY calculation.
     */
    function setExchangeRates(address[] calldata assets, uint256[] calldata rates) external onlyOwner {
        require(assets.length == rates.length, "Arrays length mismatch");
        require(assets.length > 0, "Empty arrays");

        for (uint256 i = 0; i < assets.length; i++) {
            require(assets[i] != address(0), "Invalid asset address");
            require(rates[i] > 0, "Rate must be greater than 0");
            exchangeRates[assets[i]] = rates[i];
        }

        emit ExchangeRatesUpdated(assets, rates, block.timestamp);
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
