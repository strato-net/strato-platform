// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

contract RevertCallee {
    uint public hits;
    function mutateThenRevert() external {
        hits += 10;
        revert("inner failure");
    }
}

contract Describe_ArithmeticMinimal {
    constructor() {
    }

    function it_adds_uints() public {
        require(1 + 2 == 3, "1+2 should equal 3");
    }

    function it_uint_underflow_wraps() public {
        uint x = 0;
        uint y = x - 1;
        require(y + 1 == x, "Underflow did not wrap");
    }

    uint public counter;
    event Before(uint counter);
    event After(uint counter);

    function it_try_catch_external_revert_rolls_back_callee_and_keeps_caller() public {
        emit Before(counter);
        uint beforeCaller = counter;
        counter = counter + 1;
        RevertCallee callee = new RevertCallee();
        try callee.mutateThenRevert() {
            require(false, "unexpected success");
        } catch {
        }
        emit After(counter);
        require(counter == beforeCaller + 1, "Caller outer change missing");
        require(callee.hits() == 0, "Callee state not rolled back");
    }
}


