pragma solidity ^0.4.8;

contract TwoContract1 {
  uint public _c1;
  function TwoContract1() {
    _c1 = 1;
  }
}

contract TwoContract2 {
  string public _c2;
  function TwoContract2() {
    _c2 = "2";
  }
}
