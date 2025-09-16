// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
interface LiquidityPool { function setMToken(address m) external; function deposit(uint amount,uint mAmt,address sender) external; function withdraw(uint mAmt,address to,uint amount) external; function borrow(uint amount,address to) external; function repay(uint amount,address from) external; function transferReserve(uint amount,address to) external; }


