import "A.sol";


contract D {
    C c;

    uint value;

    function D(uint set) {
        value = set;
    }

    function testC() returns (uint retVal) {
        return c.test();
    }

    function test() returns (uint retVal) {
        return value;
    }
}
