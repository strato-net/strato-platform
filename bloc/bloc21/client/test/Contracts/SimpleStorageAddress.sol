contract SimpleStorageAddress {
    address storedData;
    function set(address x) {
        storedData = x;
    }
    function get() returns (address retVal) {
        return storedData;
    }
}
