pragma solidity ^0.4.8;

import "./Title.sol";
import "./TitleMo.sol";
import "./ErrorCodes.sol";
import "./Util.sol";

/**
* Interface for Title data contracts
*/

contract record TitleManager is ErrorCodes, Util {

  // creator of the contract
  address creator;
  // titles array
  Title[] titles;
  /*
    note on mapping to array index:
    a non existing mapping will return 0, so 0 should not be a valid value in a map,
    otherwise exists() will not work
  */
  mapping (bytes32 => uint) titleMap;
  mapping (uint => address) titlesMapping;


  /**
  * Constructor
  */
  function TitleManager(address _creator) public {
    creator = _creator;
    titles.length = 1; // see above note
  }

  function exists(string vin) public returns (bool) {
    return titleMap[b32(vin)] != 0;
  }

  function createTitle(string _vin) public returns (ErrorCodes, address) {
    // only creator can execute
    if (msg.sender != creator) {
      return (ErrorCodes.UNAUTHORIZED, msg.sender);
    }
    // check validity
    if (bytes(_vin).length > 32) {
      return (ErrorCodes.ERROR, 0);
    }
    // check Duplicate
    if (exists(_vin)) {
      return (ErrorCodes.EXISTS, 0);
    }
    uint index = titles.length;
    titleMap[b32(_vin)] = index;
    Title title = new Title(_vin);
    // validate new instance
    address temp = title;
    if (temp == 0x0) {
      return (ErrorCodes.ERROR, 13);
    }
    // save
    titles.push(title);
    return (ErrorCodes.SUCCESS, title);
  }

  function testState(uint count) public returns (uint, address) {
    for (uint8 i = 0; i < count; i++) {
      address adrs = address(titles.length);
      Title title = Title(adrs);
      titles.push(title);
    }
    return (titles.length, titles[titles.length-1]);
  }

  function testMapping(uint batchSize, uint batchIndex) public returns (address) {
    uint offset = batchSize * batchIndex;
    for (uint8 i = 0; i < batchSize; i++) {
      uint index = offset + i;
      address adrs = address(index);
      Title title = Title(adrs);
      titlesMapping[index] = title;
    }
    return (titlesMapping[offset+batchSize-1]);
  }

  function getMapping(uint key) returns (address value) {
    return titlesMapping[key];
  }

}
