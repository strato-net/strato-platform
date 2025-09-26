// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../../interfaces/ITimeProvider.sol";

/**
 * @title BlockTimeProvider
 * @dev Production implementation of ITimeProvider that returns the actual
 * block.timestamp. This is used in production deployments.
 */
contract BlockTimeProvider is ITimeProvider {
    /**
     * @dev Returns the current block timestamp
     * @return Current block timestamp in seconds since Unix epoch
     */
    function currentTimestamp() external view override returns (uint256) {
        return block.timestamp;
    }
}