// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Describe_ArithmeticMinimal} from "mercata/contracts/tests/Semantics/ArithmeticMinimal.test.sol";

contract ArithmeticTest {
    function testAdd() public {
        Describe_ArithmeticMinimal c = new Describe_ArithmeticMinimal();
        c.it_adds_uints();
    }
}


