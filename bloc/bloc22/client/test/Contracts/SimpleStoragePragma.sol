pragma solidity ^0.4.8;

contract SimpleStoragePragma {
    uint storedData;
    function set(uint x) {
        storedData = x;
    }
    function get() returns (uint retVal) {
        return storedData;
    }
}
