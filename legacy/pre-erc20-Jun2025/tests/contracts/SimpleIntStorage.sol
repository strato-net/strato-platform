contract record SimpleIntStorage {
    uint storedData;

    uint[] storedDatum;

    function SimpleIntStorage(uint _storedData) {
        storedData = _storedData;
    }

    function set(uint value) {
        storedData = value;
    }

    function get() returns (uint retVal) {
        return storedData;
    }

    function setArray(uint value) {
        storedDatum.push(value);
    }

    function getArray(uint ind) returns (uint retVal){
        return storedDatum[ind];
    }

    function getFirst2() returns (uint retVal1, uint retVal2){
        return (storedDatum[0], storedDatum[1]);
    }

    function getDatum() returns (uint[] retVal) {
        uint[] memory rtn = new uint[](storedDatum.length);
        for (uint i = 0; i < storedDatum.length; i++) {
            rtn[i] = storedDatum[i];
        }
        return rtn;
    }

    function getDatumHalves() returns (uint[] retVal1, uint[] retVal2) {
        uint[] memory rtn1 = new uint[](storedDatum.length/2);
        uint[] memory rtn2 = new uint[](storedDatum.length-storedDatum.length/2);
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
