import "../../abstract/ERC20/access/Ownable.sol";
import "../../libraries/Oracle/OracleTypes.sol";

/**
 * @title PriceOracle
 * @notice Provides asset price feeds used for loan value and collateral validation.
 * @dev Asset prices are set manually for now; can be upgraded to use external oracles.
 *      TWAP = time-weighted average over last 3 prices (2 historical slots + current). Queue of 2 (timestamp, price) per asset.
 */
contract record PriceOracle is Ownable {
    using OracleTypes for *;

    // Asset price storage (price in 8-decimal format: 1e8 = $1.00)
    mapping(address => uint256) public record prices;
    mapping(address => uint256) public record lastUpdated;
    mapping(address => OracleState) public record oracleState;

    uint256 public twapQueueSize;

    // Events
    event PriceUpdated(address indexed asset, uint256 price, uint256 timestamp);
    event BatchPricesUpdated(address[] assets, uint256[] priceValues, uint256 timestamp);

    constructor(address _owner) Ownable(_owner) {
        twapQueueSize = 2;
    }

    /**
     * @dev Push the previous (timestamp, price) into the queue. When at capacity, overwrite at writeIndex (ring buffer).
     */
    function _pushObservation(address asset, uint256 prevTs, uint256 prevPrice) internal {
        if (prevPrice == 0) return;
        uint256 len = oracleState[asset].timestamps.length;
        uint256 size = twapQueueSize;
        if (len < size) {
            oracleState[asset].timestamps.push(prevTs);
            oracleState[asset].prices.push(prevPrice);
        } else {
            uint256 idx = oracleState[asset].writeIndex;
            oracleState[asset].timestamps[idx] = prevTs;
            oracleState[asset].prices[idx] = prevPrice;
            oracleState[asset].writeIndex = (idx + 1) % size;
        }
    }

    /**
     * @dev TWAP over queue points plus current. Uses queue length; weighted sum / (now - oldest).
     */
    function _twapOverWindow(address asset) internal view returns (uint256) {
        uint256 now_ = block.timestamp;
        uint256 spot = prices[asset];
        if (spot == 0) return 0;

        uint256 n = oracleState[asset].timestamps.length;
        if (n == 0) return spot;

        uint256 size = twapQueueSize;
        uint256 w = oracleState[asset].writeIndex;
        uint256 idx0 = (n == size) ? w : 0;
        uint256 t0 = oracleState[asset].timestamps[idx0];
        if (now_ <= t0) return oracleState[asset].prices[idx0];

        uint256 weighted = 0;
        for (uint256 i = 0; i < n; i++) {
            uint256 idx = (n == size) ? (w + i) % size : i;
            uint256 tStart = oracleState[asset].timestamps[idx];
            uint256 tEnd;
            if (i + 1 < n) {
                uint256 idxNext = (n == size) ? (w + i + 1) % size : (i + 1);
                tEnd = oracleState[asset].timestamps[idxNext];
            } else {
                tEnd = lastUpdated[asset];
            }
            weighted += oracleState[asset].prices[idx] * (tEnd - tStart);
        }
        weighted += spot * (now_ - lastUpdated[asset]);
        uint256 window = now_ - t0;
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
     * @dev Get TWAP over last 3 prices (2 historical + current). No time interval.
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
}
