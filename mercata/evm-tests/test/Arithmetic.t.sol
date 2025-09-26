// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Describe_ArithmeticMinimal} from "mercata/contracts/tests/Semantics/ArithmeticMinimal.test.sol";

contract SharedSemanticsHarness {
    function test_shared_arithmetic_minimal() public {
        Describe_ArithmeticMinimal c = new Describe_ArithmeticMinimal();
        c.it_adds_uints();
        // On EVM 0.8.x, unsigned underflow reverts before reaching the require in the shared test.
        try c.it_uint_underflow_wraps() {
            revert("Expected revert due to 0.8.x checked arithmetic");
        } catch {
            // pass
        }
        // Try/catch revert rollback semantics using external callee: outer +1 persists, callee hits rolled back
        uint beforeVal = c.counter();
        c.it_try_catch_external_revert_rolls_back_callee_and_keeps_caller();
        uint afterVal = c.counter();
        require(afterVal == beforeVal + 1, "Callee change not rolled back or caller outer change lost");
    }
}


