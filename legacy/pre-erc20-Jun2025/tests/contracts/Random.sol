pragma solidity ^0.4.24;

contract record Random {
  bytes32 value;

  constructor() {
    value = blockhash(block.number - 1);
  }
}
