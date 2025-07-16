contract record SimpleBoolStorage {
    bool storedData;

    bool[] storedDatum;

    function SimpleBytesStorage(bool value) {
        storedData = value;
    }

    function set(bool value) {
        storedData = value;
    }

    function get() returns (bool retVal) {
        return storedData;
    }

    function setArray(bool value) {
        storedDatum.push(value);
    }

    function getArray(uint ind) returns (bool retVal){
        return storedDatum[ind];
    }

    function getFirst2() returns (bool retVal1, bool retVal2){
        return (storedDatum[0], storedDatum[1]);
    }

    function getDatum() returns (bool[] retVal) {
        bool[] memory rtn = new bool[](storedDatum.length);
        for (uint i = 0; i < storedDatum.length; i++) {
            rtn[i] = storedDatum[i];
        }
        return rtn;
    }

    function getDatumHalves() returns (bool[] retVal1, bool[] retVal2) {
        bool[] memory rtn1 = new bool[](storedDatum.length/2);
        bool[] memory rtn2 = new bool[](storedDatum.length-storedDatum.length/2);
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
