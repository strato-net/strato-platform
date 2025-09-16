// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "./LiquidityPool.sol";
import "./CollateralVault.sol";
import "./PriceOracle.sol";
interface LendingRegistry { function liquidityPool() external view returns (LiquidityPool); function collateralVault() external view returns (CollateralVault); function priceOracle() external view returns (PriceOracle); }


