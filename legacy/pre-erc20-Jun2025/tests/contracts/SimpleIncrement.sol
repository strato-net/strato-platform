pragma solidity ^0.4.8;

contract record SimpleIncrement {

  uint x;

  function SimpleIncrement() public {
    x = 0;
  }

  function increment() public {
    x = x + 1;
  }

  function get() public returns (uint) { return x; }

}