pragma solidity ^0.4.24;

contract Random {
  bytes32 value;

  constructor() {
    value = blockhash(block.number - 1);
  }
}
