// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ERC20 { // minimal for CDPReserve casting
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}
