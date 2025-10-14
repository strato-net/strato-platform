contract Describe_Math_Test {
    constructor() {
    }

    function beforeAll() {
    }

    function beforeEach() {
    }

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
}

