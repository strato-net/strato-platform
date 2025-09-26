// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

contract RevertCallee {
    uint public hits;
    function mutateThenRevert() external {
        hits += 10;
        revert("inner failure");
    }
    function byRequire() external {
        require(false, "req");
    }
    function byAssert() external {
        assert(false);
    }
    function add(uint a, uint b) external returns (uint) {
        hits += 1;
        return a + b;
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

    // Additional small-width overflow/underflow wrap tests
    function it_uint8_add_overflow_wraps() public {
        uint8 x = 255;
        uint8 y = x + 1;
        require(y == 0, "uint8 add did not wrap");
    }

    function it_uint8_mul_overflow_wraps() public {
        uint8 x = 200;
        uint8 y = x * 2; // 400 % 256 = 144
        require(y == 144, "uint8 mul did not wrap as expected");
    }

    function it_int8_add_overflow_wraps() public {
        int8 x = 127;
        int8 y = x + 1; // should wrap to -128 in wrapping semantics
        require(y == -128, "int8 add did not wrap to -128");
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

    function it_external_call_returns_and_updates_callee() public {
        RevertCallee callee = new RevertCallee();
        uint r = callee.add(5, 7);
        require(r == 12, "External add returned wrong value");
        require(callee.hits() == 1, "Callee state not updated on success");
    }

    // SolidVM-specific delegate mapping test moved to DelegateMappingSolidVMOnly.test.sol

    // NOTE: EVM-only selector checks were removed from shared suite to keep SolidVM compatible
}


