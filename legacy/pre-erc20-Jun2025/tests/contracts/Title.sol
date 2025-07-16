/* pragma solidity ^0.4.8; */
import "./TitleMo.sol";

/**
 * Title wrapper
 */
contract record Title is TitleMo {
  // NOTE: members must be public to be indexed for search
  string public vin;

  function Title(string _vin) public {
    vin = _vin;
  }
}
