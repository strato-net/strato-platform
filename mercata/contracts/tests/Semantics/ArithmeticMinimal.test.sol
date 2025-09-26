// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;
contract Describe_ArithmeticMinimal {
    constructor() {
    }

    function it_adds_uints() public {
        require(1 + 2 == 3, "1+2 should equal 3");
    }
}


