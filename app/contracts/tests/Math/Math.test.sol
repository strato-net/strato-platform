contract Describe_Math_Test {
    uint stored;

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

    function property_unchecked_rejects_unsigned_underflow(uint x, uint y) {
        uint z = 0;
        bool thrown = false;
        try {
            unchecked {
                z = x - y;
            }
        } catch {
            thrown = true;
        }

        if (x < y) {
            require(thrown, "SolidVM didn't throw when x < y: " + string(x) + ", " + string(y));
            require(z == 0, "z was still updated: " + string(z));
        } else {
            require(!thrown, "SolidVM threw when x >= y: " + string(x) + ", " + string(y));
            require(z == x - y, "incorrect subtraction result: " + string(z));
        }
    }

    function it_unchecked_executes_as_an_ordinary_block() {
        uint x = 3;
        unchecked {
            x += 2;
            stored = x;
            int difference = int(3) - int(6);
            require(difference == -3, "signed subtraction changed");
        }
        require(x == 5, "local assignment was lost");
        require(stored == 5, "storage assignment was lost");
    }
}

