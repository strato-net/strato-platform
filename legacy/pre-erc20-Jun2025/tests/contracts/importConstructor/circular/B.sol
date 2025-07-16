import "A.sol";


contract record D {
    C c;

    uint storedD;

    function D(uint caD) {
        storedD = caD;
    }

    function testC() returns (uint retVal) {
        return c.test();
    }

    function test() returns (uint retVal) {
        return storedD;
    }
}
