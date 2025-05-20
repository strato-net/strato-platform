import "B.sol";


contract record C {
    D d;

    uint storedC;

    function C(uint caC) {
        storedC = caC;
    }

    function testD() returns (uint retVal) {
        return d.test();
    }

    function test() returns (uint retVal) {
        return storedC;
    }
}
