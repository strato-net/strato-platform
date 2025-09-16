// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
interface PriceOracle { function getAssetPrice(address asset) external view returns (uint); }


