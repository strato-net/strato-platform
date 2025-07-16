contract record SimpleBytesStorage {
    bytes32 storedData;

    bytes32[] storedDatum;

    function SimpleBytesStorage(string value) {
        storedData = stringToBytes32(value);
    }

    function stringToBytes32(string source) returns (bytes32 result) {
        assembly {
            result := mload(add(source, 32))
        }
    }

    function set(bytes32 value) {
        storedData = value;
    }

    function get() returns (bytes32 retVal) {
        return storedData;
    }

    function setArray(bytes32 value) {
        storedDatum.push(value);
    }

    function getArray(uint ind) returns (bytes32 retVal){
        return storedDatum[ind];
    }

    function getFirst2() returns (bytes32 retVal1, bytes32 retVal2){
        return (storedDatum[0], storedDatum[1]);
    }

    function getDatum() returns (bytes32[] retVal) {
        bytes32[] memory rtn = new bytes32[](storedDatum.length);
        for (uint i = 0; i < storedDatum.length; i++) {
            rtn[i] = storedDatum[i];
        }
        return rtn;
    }

    function getDatumHalves() returns (bytes32[] retVal1, bytes32[] retVal2) {
        bytes32[] memory rtn1 = new bytes32[](storedDatum.length/2);
        bytes32[] memory rtn2 = new bytes32[](storedDatum.length-storedDatum.length/2);
        uint i = 0;
        for (i = 0; i < storedDatum.length/2; i++) {
            rtn1[i] = storedDatum[i];
        }

        uint j = 0;
        for(; i < storedDatum.length; i++) {
            rtn2[j++] = storedDatum[i];
        }

        return (rtn1, rtn2);
    }
}
