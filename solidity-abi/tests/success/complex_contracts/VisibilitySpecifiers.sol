contract c {
  function f(uint a) private returns (uint b) { return a + 1; }
  function setData(uint a) internal { data = a; }
  uint public data;
}