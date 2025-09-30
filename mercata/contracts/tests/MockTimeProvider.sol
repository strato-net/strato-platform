// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../../interfaces/ITimeProvider.sol";

/**
 * @title MockTimeProvider
 * @dev Test implementation of ITimeProvider that allows manual control
 * of time progression. Used in unit tests to simulate the passage of time
 * without waiting for actual time to pass.
 */
contract MockTimeProvider is ITimeProvider {
    uint256 private mockTime;

    /**
     * @dev Constructor initializes mock time to current block timestamp
     */
    constructor() {
        mockTime = block.timestamp;
    }

    /**
     * @dev Returns the mock timestamp
     * @return Current mock timestamp in seconds since Unix epoch
     */
    function currentTimestamp() external view override returns (uint256) {
        return mockTime;
    }

    /**
     * @dev Sets the mock time to a specific timestamp
     * @param _time The timestamp to set
     */
    function setTime(uint256 _time) external {
        mockTime = _time;
    }

    /**
     * @dev Advances the mock time by a specified number of seconds
     * @param _seconds Number of seconds to advance
     */
    function advanceTime(uint256 _seconds) external {
        mockTime += _seconds;
    }

    /**
     * @dev Returns the current mock time (convenience function for tests)
     * @return Current mock timestamp
     */
    function getCurrentTime() external view returns (uint256) {
        return mockTime;
    }
}