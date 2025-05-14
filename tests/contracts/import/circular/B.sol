import "A.sol";
contract record D {
    C c;

    function testC() returns (uint retVal) {
        return c.test();
    }

    function test() returns (uint retVal) {
        return 2;
    }
}
