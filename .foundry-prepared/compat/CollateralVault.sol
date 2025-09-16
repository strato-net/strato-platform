// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
interface CollateralVault { function userCollaterals(address user, address asset) external view returns (uint); function addCollateral(address user,address asset,uint amount) external; function removeCollateral(address user,address asset,uint amount) external; function seizeCollateral(address user,address liq,address asset,uint amount) external; }


