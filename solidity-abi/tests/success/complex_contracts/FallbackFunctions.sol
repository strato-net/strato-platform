contract Test {
  function() { x = 1; }
  uint x;
}

contract Caller {
  function callTest(address testAddress) {
    Test(testAddress).call(0xabcdefgh); // hash does not exist
    // results in Test(testAddress).x becoming == 1.
  }
}