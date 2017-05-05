contract SimpleStorageBytes32Array {
    bytes32[] storedData;
    function set(bytes32[] x) {
        storedData = x;
    }
    function get() returns (bytes32[] retVal) {
        return storedData;
    }
}
