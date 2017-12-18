pragma solidity 0.4.x;

contract SimpleStoragePragma {
    uint storedData;
    function set(uint x) {
        storedData = x;
    }
    function get() returns (uint retVal) {
        return storedData;
    }
}