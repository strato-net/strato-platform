/**
 * Util contract
 */
contract record Util {
  function stringToBytes32(string memory source) returns (bytes32 result) {
    assembly {
      result := mload(add(source, 32))
    }
  }

  function b32(string memory source) returns (bytes32) {
    return stringToBytes32(source);
  }

  function uintToString(uint i) returns (string){
    if (i == 0) return "0";
    uint j = i;
    uint length;
    while (j != 0){
      length++;
      j /= 10;
    }
    bytes memory bstr = new bytes(length);
    uint k = length - 1;
    while (i != 0){
      bstr[k--] = byte(48 + i % 10);
      i /= 10;
    }
    return string(bstr);
  }
}
