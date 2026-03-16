pragma solidity ^0.8.0;

contract SimpleIncrement {
    uint256 public counter;

    constructor() {
        counter = 0;
    }

    function increment() public {
        counter = counter + 1;
    }

    function getCounter() public view returns (uint256) {
        return counter;
    }
}
