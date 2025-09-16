// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract PriceOracle {
    function getPrice(address) external pure returns (uint256) { return 1e18; }
    function getAssetPrice(address) external pure returns (uint256) { return 1e18; }
}
