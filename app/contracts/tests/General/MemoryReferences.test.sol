// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title A memory array is a reference
/// @notice As in Solidity: assigning a memory array to another variable,
///         passing it to an internal function or returning it gives another
///         name for the same array. Only a call to another contract and an
///         assignment to storage copy it.

contract Callee {
    function change(uint[] memory a) public returns (uint) { a[0] = 55; return a[0]; }

    function make() public returns (uint[] memory) {
        uint[] memory r = new uint[](2);
        r[0] = 3;
        return r;
    }
}

contract Describe_MemoryReferences {
    struct P { uint n; uint[] xs; }

    uint[] st;
    Callee callee;

    function beforeAll() public {
        callee = new Callee();
    }

    function setFirst(uint[] memory a, uint v) internal { a[0] = v; }
    function same(uint[] memory a) internal returns (uint[] memory) { return a; }

    function it_shares_an_array_declared_from_another() public {
        uint[] memory a = new uint[](2);
        uint[] memory b = a;
        b[0] = 1;
        require(a[0] == 1, "a");
        a[1] = 2;
        require(b[1] == 2, "b");
    }

    function it_shares_an_array_assigned_from_another() public {
        uint[] memory a = new uint[](2);
        uint[] memory b;
        b = a;
        b[0] = 1;
        require(a[0] == 1, "a");
    }

    function it_shares_arrays_of_other_element_types() public {
        int[] memory a = new int[](2);
        int[] memory b = a;
        b[0] = -1;
        require(a[0] == -1, "int");

        address[] memory c = new address[](2);
        address[] memory d;
        d = c;
        d[0] = address(5);
        require(c[0] == address(5), "address");

        string[] memory e = ["x", "y"];
        string[] memory f = e;
        f[0] = "z";
        require(e[0] == "z", "string");
    }

    function it_shares_an_array_passed_to_an_internal_function() public {
        uint[] memory a = new uint[](2);
        setFirst(a, 9);
        require(a[0] == 9, "a");
    }

    function it_shares_an_array_returned_by_an_internal_function() public {
        uint[] memory a = new uint[](2);
        uint[] memory b = same(a);
        b[0] = 4;
        require(a[0] == 4, "a");
    }

    function it_copies_an_array_passed_to_another_contract() public {
        uint[] memory a = new uint[](2);
        a[0] = 1;
        require(callee.change(a) == 55, "callee");
        require(a[0] == 1, "a");
    }

    function it_shares_an_array_written_as_a_literal() public {
        uint[] memory a = [uint(1), 2, 3];
        uint[] memory b = a;
        b[0] = 9;
        require(a[0] == 9, "a");
    }

    function it_shares_an_array_returned_by_another_contract() public {
        uint[] memory a = callee.make();
        uint[] memory b = a;
        b[1] = 6;
        require(a[0] == 3 && a[1] == 6, "a");
    }

    function it_copies_an_array_assigned_to_storage() public {
        uint[] memory m = new uint[](2);
        m[0] = 1;
        st = m;
        m[0] = 2;
        require(st[0] == 1, "storage");
    }

    function it_shares_a_nested_array() public {
        uint[][] memory outer = new uint[][](2);
        outer[0] = new uint[](2);
        uint[] memory inner = outer[0];
        inner[1] = 5;
        require(outer[0][1] == 5, "outer");
        outer[0][0] = 6;
        require(inner[0] == 6, "inner");
    }

    function it_shares_an_array_held_in_a_struct() public {
        P memory p;
        uint[] memory a = new uint[](2);
        p.xs = a;
        a[0] = 1;
        require(p.xs[0] == 1, "field");
        p.xs[1] = 2;
        require(a[1] == 2, "a");
    }

    function it_hashes_an_array_by_its_contents() public {
        string[] memory literal = ["a", "b"];
        string[] memory built = new string[](2);
        built[0] = "a";
        built[1] = "b";
        string[] memory pushed;
        pushed.push("a");
        pushed.push("b");
        require(keccak256(literal) == keccak256(built), "literal and built");
        require(keccak256(literal) == keccak256(pushed), "literal and pushed");
        pushed[1] = "c";
        require(keccak256(literal) != keccak256(pushed), "different contents");
    }

    function it_keeps_a_literal_element_after_its_variable_changes() public {
        uint x = 1;
        uint[] memory a = [x, 2];
        x = 9;
        require(a[0] == 1, "a");
    }
}
