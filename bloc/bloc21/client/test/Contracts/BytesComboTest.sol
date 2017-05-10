contract BytesComboTest {
  bytes32 public bites;
  bytes32[] public bytesArray;
  string public theString;
  address public a1;
  address public a2;

  function BytesComboTest(address _a1, address _a2, bytes32 a, bytes32[] b, string c) {
      bites = a;
      bytesArray = b;
      theString =c;
      a1 = _a1;
      a2 = _a2;
  }

  function set(bytes32 a, bytes32[] b, string c) returns(bytes32) {
      /*bites = a;*/
      return bites;
  }

  function get() returns(bytes32) {
      return bites;
  }
}
