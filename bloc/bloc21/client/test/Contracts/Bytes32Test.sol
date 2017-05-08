contract Bytes32Test {
  bytes32 bites;

  function Bytes32Test(bytes32 b) {
      bites = b;
  }

  function set(bytes32 a, bytes32[] b, string c) returns(bytes32) {
      bites = a;
      return bites;
  }

  function get() returns(bytes32) {
      return bites;
  }
}
