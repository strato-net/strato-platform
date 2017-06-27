import "B.sol";


contract C {
    D d;

    uint value;

    function C(uint set) {
        value = set;
    }

    function testD() returns (uint retVal) {
        return d.test();
    }

    function test() returns (uint retVal) {
        return value;
    }
}
