import "../data/Address.sol";

/**
  * Inheritable contract for interfacing with Address contract json representations
*/
contract Addressed {
  /**
    * Return a null json representation of an invalid Address contract (all fields empty)
    * @return {string} - null json array
  */
  function nullJson() internal returns (string) {
    bytes memory array = new bytes(16);
    uint index = 0;
    array[index++] = '[';

    for (uint i = 0; i < 5; i ++) {
      array[index++] = '"';
      array[index++] = '"';
      array[index++] = ',';
    }
    array[index - 1] = ']';
    return string(array);
  }

  /**
    * Return the json string for a given Address contract
    * @param _address {address} - address of the Address contract
    * @return {string} - string json array
  */
  function addressJson(address _address) constant returns (string) {
    if (uint(Address(_address).getOwner()) == 0) return nullJson();

    uint length = Address(_address).jsonLength();

    bytes memory json = new bytes(length);

    // todo: test a direct assignment of bytes
    for (uint i = 0; i < length; i++) {
      json[i] = Address(_address).getJsonAt(i);
    }

    return string(json);
  }

}
