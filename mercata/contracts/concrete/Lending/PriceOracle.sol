import "../../abstract/ERC20/access/Ownable.sol";
import "../../libraries/Oracle/OracleTypes.sol";

/**
 * @title PriceOracle
 * @notice Provides asset price feeds used for loan value and collateral validation.
 * @dev TWAP: append observations until max, then ring overwrite. Binary search + interpolation.
 *      TWAP(secondsAgo) = (cum(now) - cum(now - secondsAgo)) / secondsAgo
 */
contract record PriceOracle is Ownable {
    using OracleTypes for *;

    // Asset price storage (price in 8-decimal format: 1e8 = $1.00)
    mapping(address => uint256) public record prices;
    mapping(address => uint256) public record lastUpdated;

    // Oracle state per asset (capacity = min(observations.length, maxCardinality))
    mapping(address => OracleState) public record oracleState;

    uint256 public maxCardinality = 60;

    // Events
    event PriceUpdated(address indexed asset, uint256 price, uint256 timestamp);
    event BatchPricesUpdated(address[] assets, uint256[] priceValues, uint256 timestamp);

    constructor(address _owner) Ownable(_owner) {}

    /**
     * @dev Set max observation buffer size per asset (default 60).
     */
    function setMaxCardinality(uint256 _maxCardinality) external onlyOwner {
        require(_maxCardinality > 0, "Max cardinality must be positive");
        maxCardinality = _maxCardinality;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ORACLE WRITE (append until max, then ring overwrite)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @dev Transform: compute new cumulative given passage of time.
     *      newCum = lastCum + lastPrice * (newTs - lastTs)
     */
    function _transform(
        uint256 lastTimestamp,
        uint256 lastPriceCumulative,
        uint256 lastPrice,
        uint256 blockTimestamp
    ) internal pure returns (uint256) {
        uint256 delta = blockTimestamp - lastTimestamp;
        return lastPriceCumulative + lastPrice * delta;
    }

    /**
     * @dev Write an observation. Append until maxCardinality, then ring overwrite.
     *      Skips if already written this block. Newest is last element when appending, index when ring.
     */
    function _write(address asset, uint256 price) internal {
        uint256 blockTimestamp = block.timestamp;
        uint256 len = oracleState[asset].observations.length;
        uint256 index = oracleState[asset].index;

        // First write ever: push single observation
        if (len == 0) {
            oracleState[asset].observations.length = 1;
            oracleState[asset].observations[0].blockTimestamp = blockTimestamp;
            oracleState[asset].observations[0].priceCumulative = 0;
            oracleState[asset].index = 0;
            oracleState[asset].lastPrice = price;
            oracleState[asset].lastTimestamp = blockTimestamp;
            oracleState[asset].priceCumulative = 0;
            return;
        }

        // Newest slot: when ring (full) use index; when appending use last element
        uint256 newestIdx = (len >= maxCardinality) ? index : (len - 1);
        if (oracleState[asset].observations[newestIdx].blockTimestamp == blockTimestamp) {
            oracleState[asset].lastPrice = price;
            return;
        }

        uint256 lastTs = oracleState[asset].lastTimestamp;
        uint256 lastPrice = oracleState[asset].lastPrice;
        uint256 lastCum = oracleState[asset].priceCumulative;
        uint256 newCum = _transform(lastTs, lastCum, lastPrice, blockTimestamp);

        uint256 indexUpdated;
        if (len < maxCardinality) {
            oracleState[asset].observations.length = len + 1;
            indexUpdated = len;
        } else {
            indexUpdated = (index + 1) % maxCardinality;
        }

        oracleState[asset].observations[indexUpdated].blockTimestamp = blockTimestamp;
        oracleState[asset].observations[indexUpdated].priceCumulative = newCum;
        oracleState[asset].index = indexUpdated;
        oracleState[asset].priceCumulative = newCum;
        oracleState[asset].lastTimestamp = blockTimestamp;
        oracleState[asset].lastPrice = price;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ORACLE OBSERVE (binary search + interpolation)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @dev Binary search to find observations surrounding the target timestamp.
     *      When not full: linear indices 0..cardinality-1, next = idx+1.
     *      When full: ring, next = (idx+1) % cardinality.
     */
    function _binarySearch(
        address asset,
        uint256 target,
        uint256 index,
        uint256 cardinality,
        uint256 oldestIdx
    ) internal view returns (
        uint256 beforeOrAtTs,
        uint256 beforeOrAtCum,
        uint256 atOrAfterTs,
        uint256 atOrAfterCum
    ) {
        bool isFull = (cardinality == maxCardinality);
        uint256 l = oldestIdx;
        uint256 r = isFull ? (oldestIdx + cardinality - 1) : (cardinality - 2); // when not full, last slot has no next
        uint256 i;

        while (l <= r) {
            i = (l + r) / 2;
            uint256 idx = isFull ? (i % cardinality) : i;

            beforeOrAtTs = oracleState[asset].observations[idx].blockTimestamp;
            beforeOrAtCum = oracleState[asset].observations[idx].priceCumulative;

            uint256 nextIdx = isFull ? (idx + 1) % cardinality : (idx + 1);
            atOrAfterTs = oracleState[asset].observations[nextIdx].blockTimestamp;
            atOrAfterCum = oracleState[asset].observations[nextIdx].priceCumulative;

            bool targetAtOrAfter = (beforeOrAtTs <= target);
            if (targetAtOrAfter && (target <= atOrAfterTs)) {
                return (beforeOrAtTs, beforeOrAtCum, atOrAfterTs, atOrAfterCum);
            }

            if (!targetAtOrAfter) {
                if (i == l) break;
                r = i - 1;
            } else {
                l = i + 1;
            }
        }

        beforeOrAtTs = oracleState[asset].observations[index].blockTimestamp;
        beforeOrAtCum = oracleState[asset].observations[index].priceCumulative;
        atOrAfterTs = beforeOrAtTs;
        atOrAfterCum = beforeOrAtCum;
        return (beforeOrAtTs, beforeOrAtCum, atOrAfterTs, atOrAfterCum);
    }

    /**
     * @dev Get surrounding observations for a target timestamp.
     */
    function _getSurroundingObservations(
        address asset,
        uint256 target
    ) internal view returns (
        uint256 beforeOrAtTs,
        uint256 beforeOrAtCum,
        uint256 atOrAfterTs,
        uint256 atOrAfterCum
    ) {
        uint256 index = oracleState[asset].index;
        uint256 len = oracleState[asset].observations.length;
        uint256 lastPrice = oracleState[asset].lastPrice;
        uint256 newestIdx = (len >= maxCardinality) ? index : (len - 1);
        uint256 oldestIdx = (len >= maxCardinality) ? (index + 1) % len : 0;

        beforeOrAtTs = oracleState[asset].observations[newestIdx].blockTimestamp;
        beforeOrAtCum = oracleState[asset].observations[newestIdx].priceCumulative;

        if (beforeOrAtTs <= target) {
            if (beforeOrAtTs == target) {
                atOrAfterTs = beforeOrAtTs;
                atOrAfterCum = beforeOrAtCum;
                return (beforeOrAtTs, beforeOrAtCum, atOrAfterTs, atOrAfterCum);
            }
            atOrAfterTs = target;
            atOrAfterCum = _transform(beforeOrAtTs, beforeOrAtCum, lastPrice, target);
            return (beforeOrAtTs, beforeOrAtCum, atOrAfterTs, atOrAfterCum);
        }

        uint256 oldestTs = oracleState[asset].observations[oldestIdx].blockTimestamp;
        uint256 oldestCum = oracleState[asset].observations[oldestIdx].priceCumulative;

        if (oldestTs > target) {
            beforeOrAtTs = oldestTs;
            beforeOrAtCum = oldestCum;
            atOrAfterTs = oldestTs;
            atOrAfterCum = oldestCum;
            return (beforeOrAtTs, beforeOrAtCum, atOrAfterTs, atOrAfterCum);
        }

        return _binarySearch(asset, target, index, len, oldestIdx);
    }

    /**
     * @dev Observe cumulative price at a specific secondsAgo.
     *      Returns the priceCumulative at (now - secondsAgo) via interpolation.
     */
    function _observeSingle(address asset, uint256 secondsAgo) internal view returns (uint256 result) {
        uint256 time = block.timestamp;
        uint256 len = oracleState[asset].observations.length;

        if (len == 0) {
            result = 0;
        } else if (secondsAgo == 0) {
            uint256 newestIdx = (len >= maxCardinality) ? oracleState[asset].index : (len - 1);
            uint256 lastTs = oracleState[asset].observations[newestIdx].blockTimestamp;
            uint256 lastCum = oracleState[asset].observations[newestIdx].priceCumulative;
            uint256 lastPrice = oracleState[asset].lastPrice;
            
            if (lastTs != time) {
                result = _transform(lastTs, lastCum, lastPrice, time);
            } else {
                result = lastCum;
            }
        } else {
            uint256 target = time - secondsAgo;

            (
                uint256 beforeOrAtTs,
                uint256 beforeOrAtCum,
                uint256 atOrAfterTs,
                uint256 atOrAfterCum
            ) = _getSurroundingObservations(asset, target);

            if (target == beforeOrAtTs) {
                result = beforeOrAtCum;
            } else if (target == atOrAfterTs) {
                result = atOrAfterCum;
            } else if (atOrAfterTs > beforeOrAtTs) {
                uint256 observationTimeDelta = atOrAfterTs - beforeOrAtTs;
                uint256 targetDelta = target - beforeOrAtTs;
                result = beforeOrAtCum + ((atOrAfterCum - beforeOrAtCum) * targetDelta) / observationTimeDelta;
            } else {
                result = beforeOrAtCum;
            }
        }
    }

    /**
     * @dev Compute TWAP over exact secondsAgo window.
     *      TWAP = (cumNow - cumAtTarget) / secondsAgo
     */
    function _consult(address asset, uint256 secondsAgo) internal view returns (uint256) {
        uint256 len = oracleState[asset].observations.length;
        if (secondsAgo == 0 || secondsAgo > block.timestamp || len == 0) {
            return prices[asset];
        }

        uint256 target = block.timestamp - secondsAgo;
        uint256 oldestIdx = (len >= maxCardinality) ? (oracleState[asset].index + 1) % len : 0;
        if (target < oracleState[asset].observations[oldestIdx].blockTimestamp) {
            return 0;
        }

        uint256 cumNow = _observeSingle(asset, 0);
        uint256 cumAtTarget = _observeSingle(asset, secondsAgo);
        if (cumNow <= cumAtTarget) {
            return prices[asset];
        }
        return (cumNow - cumAtTarget) / secondsAgo;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PRICE SETTERS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @dev Internal helper to set price for a single asset with validation.
     */
    function _setAssetPrice(address asset, uint256 price) internal {
        require(asset != address(0), "Invalid asset address");
        require(price > 0, "Price must be greater than 0");

        prices[asset] = price;
        lastUpdated[asset] = block.timestamp;
        _write(asset, price);
    }

    /**
     * @dev Set price for a single asset
     */
    function setAssetPrice(address asset, uint256 price) external onlyOwner {
        _setAssetPrice(asset, price);
        emit PriceUpdated(asset, price, block.timestamp);
    }

    /**
     * @dev Set prices for multiple assets in batch (main function for oracle service).
     */
    function setAssetPrices(address[] calldata assets, uint256[] calldata priceValues) external onlyOwner {
        require(assets.length == priceValues.length, "Arrays length mismatch");
        require(assets.length > 0, "Empty arrays");

        for (uint256 i = 0; i < assets.length; i++) {
            _setAssetPrice(assets[i], priceValues[i]);
        }

        emit BatchPricesUpdated(assets, priceValues, block.timestamp);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PRICE GETTERS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @dev Get spot price for an asset
     */
    function getAssetPrice(address asset) external view returns (uint256) {
        require(asset != address(0), "Invalid asset address");
        uint256 price = prices[asset];
        require(price > 0, "Price not available");
        return price;
    }

    /**
     * @dev Get spot price with timestamp for an asset
     */
    function getAssetPriceWithTimestamp(address asset) external view returns (uint256 price, uint256 timestamp) {
        require(asset != address(0), "Invalid asset address");
        price = prices[asset];
        require(price > 0, "Price not available");
        timestamp = lastUpdated[asset];
        return (price, timestamp);
    }

    /**
     * @dev Get TWAP price for an asset over a given time window.
     *      TWAP(secondsAgo) = (cum(now) - cum(now - secondsAgo)) / secondsAgo.
     *      Returns spot if secondsAgo == 0 or insufficient history.
     */
    function getAssetPriceTwap(address asset, uint256 secondsAgo) external view returns (uint256) {
        require(asset != address(0), "Invalid asset address");
        uint256 twap = _consult(asset, secondsAgo);
        require(twap > 0, "TWAP not available");
        return twap;
    }

    /**
     * @dev Get TWAP price with timestamp for an asset over a given time window.
     * @param asset The asset address to query
     * @param secondsAgo The time window for TWAP calculation
     * @return price The TWAP over the specified window
     * @return timestamp The timestamp of the most recent price update (not the TWAP window start)
     */
    function getAssetPriceTwapWithTimestamp(address asset, uint256 secondsAgo) external view returns (uint256 price, uint256 timestamp) {
        require(asset != address(0), "Invalid asset address");
        price = _consult(asset, secondsAgo);
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

    /**
     * @dev Get oracle state for an asset (for debugging/monitoring).
     */
    function getOracleState(address asset) external view returns (
        uint256 lastPrice,
        uint256 lastTimestamp,
        uint256 priceCumulative,
        uint256 index,
        uint256 observationCount
    ) {
        lastPrice = oracleState[asset].lastPrice;
        lastTimestamp = oracleState[asset].lastTimestamp;
        priceCumulative = oracleState[asset].priceCumulative;
        index = oracleState[asset].index;
        observationCount = oracleState[asset].observations.length;
    }
}
