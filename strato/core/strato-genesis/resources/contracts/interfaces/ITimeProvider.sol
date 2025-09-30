// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title ITimeProvider
 * @dev Interface for providing current timestamp functionality.
 * This allows for dependency injection of time providers, enabling
 * both production use (with actual block.timestamp) and testing
 * scenarios (with controllable mock time).
 */
interface ITimeProvider {
    /**
     * @dev Returns the current timestamp
     * @return Current timestamp in seconds since Unix epoch
     */
    function currentTimestamp() external view returns (uint256);
}