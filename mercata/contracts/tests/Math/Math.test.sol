contract Describe_Math_Test {
    uint constant WAD = 1e18;

    constructor() {}

    function beforeAll() {}

    function beforeEach() {}

    function property_throws_on_underflow(uint x, uint y) {
        uint z = 0;
        bool thrown = false;
        try {
            z = x - y;
        } catch {
            thrown = true;
        }

        if (x < y) {
            require(thrown, "SolidVM didn't throw when x < y: " + string(x) + ", " + string(y));
            require(z == 0, "z was still updated: " + string(z));
        } else {
            require(!thrown, "SolidVM threw when x >= y" + string(x) + ", " + string(y));
        }
    }

    function property_allows_unchecked(uint x, uint y) {
        uint z = 0;
        bool thrown = false;
        try {
            unchecked {
                z = x - y;
            }
        } catch {
            thrown = true;
        }

        require(!thrown, "SolidVM threw when x >= y" + string(x) + ", " + string(y));
    }

    // --- Fixed Point Math Tests ---

    function wadMul(uint x, uint y) internal pure returns (uint) {
        return (x * y) / WAD;
    }

    function wadDiv(uint x, uint y) internal pure returns (uint) {
        return (x * WAD) / y;
    }

    function it_calculates_wadMul_correctly() {
        // 2.5 * 2.0 = 5.0
        uint x = 25 * 1e17; // 2.5
        uint y = 2 * 1e18;   // 2.0
        uint expected = 5 * 1e18;
        require(wadMul(x, y) == expected, "wadMul failed for 2.5 * 2.0");
    }

    function it_calculates_wadDiv_correctly() {
        // 5.0 / 2.0 = 2.5
        uint x = 5 * 1e18;
        uint y = 2 * 1e18;
        uint expected = 25 * 1e17; // 2.5
        require(wadDiv(x, y) == expected, "wadDiv failed for 5.0 / 2.0");
    }

    function property_wadMul_is_commutative(uint x, uint y) {
        // Bound inputs to avoid overflow in intermediate multiplication (uint256)
        // x * y < 2^256
        if (x > 0 && y > 0 && x < 1e38 && y < 1e38) {
            require(wadMul(x, y) == wadMul(y, x), "wadMul should be commutative");
        }
    }

    function property_wadMul_identity(uint x) {
        if (x < 1e50) {
            require(wadMul(x, WAD) == x, "wadMul(x, 1) should be x");
        }
    }

    function property_wadDiv_identity(uint x) {
        if (x > 0 && x < 1e50) {
            require(wadDiv(x, WAD) == x, "wadDiv(x, 1) should be x");
        }
    }

    function it_throws_on_wadDiv_by_zero() {
        bool thrown = false;
        try {
            wadDiv(1e18, 0);
        } catch {
            thrown = true;
        }
        require(thrown, "wadDiv should throw on division by zero");
    }
}
