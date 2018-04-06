import "A.sol";
contract D {
    C c;

    function testC() returns (uint retVal) {
        return c.test();
    }

    function test() returns (uint retVal) {
        return 2;
    }
}
