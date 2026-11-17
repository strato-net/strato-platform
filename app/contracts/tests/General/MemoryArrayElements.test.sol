// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title Assigning a variable into a memory array stores its value
/// @notice An element holds the value the variable had when it was assigned.
///         Changing the variable afterwards must not change the element.
contract Describe_MemoryArrayElements {
    function it_keeps_each_value_of_a_loop_counter() public {
        uint[] memory a = new uint[](3);
        for (uint i = 0; i < 3; i++) { a[i] = i; }
        require(a[0] == 0 && a[1] == 1 && a[2] == 2, "counter");
    }

    function it_keeps_each_value_of_a_running_total() public {
        uint[] memory a = new uint[](3);
        uint total;
        for (uint i = 0; i < 3; i++) { total = total + 10; a[i] = total; }
        require(a[0] == 10 && a[1] == 20 && a[2] == 30, "total");
    }

    function it_keeps_a_uint_after_the_variable_changes() public {
        uint[] memory a = new uint[](1);
        uint v = 5;
        a[0] = v;
        v = 6;
        require(a[0] == 5, "uint");
    }

    function it_keeps_an_int_after_the_variable_changes() public {
        int[] memory a = new int[](1);
        int v = -5;
        a[0] = v;
        v = 6;
        require(a[0] == -5, "int");
    }

    function it_keeps_an_address_after_the_variable_changes() public {
        address[] memory a = new address[](1);
        address v = address(5);
        a[0] = v;
        v = address(6);
        require(a[0] == address(5), "address");
    }

    function it_keeps_a_bool_after_the_variable_changes() public {
        bool[] memory a = new bool[](1);
        bool v = true;
        a[0] = v;
        v = false;
        require(a[0], "bool");
    }

    function it_keeps_a_string_after_the_variable_changes() public {
        string[] memory a = new string[](1);
        string v = "x";
        a[0] = v;
        v = "y";
        require(a[0] == "x", "string");
    }

    function it_keeps_a_parameter_after_the_parameter_changes() public {
        require(storeThenChange(3) == 3, "parameter");
    }

    function storeThenChange(uint p) internal returns (uint) {
        uint[] memory a = new uint[](1);
        a[0] = p;
        p = 77;
        return a[0];
    }

    function it_keeps_a_literal_element_after_its_variable_changes() public {
        uint x = 1;
        uint[] memory a = [x, 2];
        x = 9;
        require(a[0] == 1, "literal");
    }

    function it_still_overwrites_an_element() public {
        uint[] memory a = new uint[](2);
        uint v = 1;
        a[0] = v;
        v = 2;
        a[0] = v;
        a[1] += 4;
        require(a[0] == 2 && a[1] == 4, "overwrite");
    }
}
