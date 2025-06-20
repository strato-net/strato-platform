contract record SimpleStorage {
    uint storedData;

    function SimpleStorage(uint _storedData) {
            storedData = _storedData;
    }

    function set(uint x) {
            storedData = x;
    }
    function get() returns (uint retVal) {
            return (storedData);
    }
}