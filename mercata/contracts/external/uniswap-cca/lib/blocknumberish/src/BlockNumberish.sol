// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @title BlockNumberish
/// A helper contract to get the current block number on different chains
/// inspired by https://github.com/ProjectOpenSea/tstorish/blob/main/src/Tstorish.sol
/// @custom:security-contact security@uniswap.org
contract BlockNumberish {
    /// @notice Internal view function to get the current block number.
    /// @dev The STRATO port uses the canonical block number directly.
    function _getBlockNumberish() internal view returns (uint256 blockNumber) {
        blockNumber = block.number;
    }

    /// @notice Internal view function to get the current flashblock number.
    /// @dev Flashblocks are not used in the STRATO port.
    function _getFlashblockNumberish() internal view returns (uint256 flashblockNumber) {
        flashblockNumber = 0;
    }
}
