// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

struct AuctionStep {
    uint24 mps; // Mps to sell per block in the step
    uint64 startBlock; // Start block of the step (inclusive)
    uint64 endBlock; // Ending block of the step (exclusive)
}

/// @notice Library for auction step calculations and parsing
library StepLib {
    /// @notice The size of a uint64 in bytes
    uint256 public constant UINT64_SIZE = 8;

    /// @notice Error thrown when the offset is too large for the data length
    error StepLib__InvalidOffsetTooLarge();
    /// @notice Error thrown when the offset is not at a step boundary - a uint64 aligned offset
    error StepLib__InvalidOffsetNotAtStepBoundary();

    /// @notice Unpack the mps and block delta from the auction steps data
    function parse(bytes8 data) internal pure returns (uint24 mps, uint40 blockDelta) {
        mps = uint24(bytes3(data));
        blockDelta = uint40(uint64(data));
    }

    /// @notice Load a word at `offset` from data and parse it into mps and blockDelta
    function get(bytes memory data, uint256 offset) internal pure returns (uint24 mps, uint40 blockDelta) {
        // Offset cannot be greater than the data length
        if (offset >= data.length) revert StepLib__InvalidOffsetTooLarge();
        // Offset must be a multiple of a step (uint64 -  uint24|uint40)
        if (offset % UINT64_SIZE != 0) revert StepLib__InvalidOffsetNotAtStepBoundary();
        if (offset + UINT64_SIZE > data.length) revert StepLib__InvalidOffsetTooLarge();

        uint64 packedValue = (uint64(uint8(data[offset])) << 56) | (uint64(uint8(data[offset + 1])) << 48)
            | (uint64(uint8(data[offset + 2])) << 40) | (uint64(uint8(data[offset + 3])) << 32)
            | (uint64(uint8(data[offset + 4])) << 24) | (uint64(uint8(data[offset + 5])) << 16)
            | (uint64(uint8(data[offset + 6])) << 8) | uint64(uint8(data[offset + 7]));

        mps = uint24(packedValue >> 40);
        blockDelta = uint40(packedValue);
    }
}
