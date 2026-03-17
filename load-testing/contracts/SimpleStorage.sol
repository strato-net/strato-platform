pragma solidity ^0.8.0;

contract SimpleStorage {
    uint256 public storedValue;

    constructor(uint256 _value) {
        storedValue = _value;
    }

    function set(uint256 _value) public {
        storedValue = _value;
    }

    function get() public view returns (uint256) {
        return storedValue;
    }
}
