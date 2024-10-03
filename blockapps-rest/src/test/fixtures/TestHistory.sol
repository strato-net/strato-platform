pragma solidvm 11.4;

abstract contract ATestHistory {
  uint x;
  constructor(uint _x) {
    x = _x;
  }
  function setX(uint _x) {
    x = _x;
  }
}

contract TestHistory is ATestHistory {
  constructor(uint _x) ATestHistory(_x) { }
}