contract SimpleConstructor {
    uint public storedData;
    function SimpleConstructor(uint x) {
        storedData = x;
    }
    function get() returns (uint retVal) {
        return storedData;
    }
}
