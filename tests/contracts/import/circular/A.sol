import "B.sol";
contract record C {
    D d;

    function testD() returns (uint retVal) {
        return d.test();
    }

    function test() returns (uint retVal) {
        return 1;
    }
}
