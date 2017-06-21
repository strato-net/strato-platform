contract DataTypeUint {
    uint storedData;

    uint[] storedDatum;

    function DataTypeUint(uint _storedData) {
        storedData = _storedData;
    }

    function set(uint value) {
        storedData = value;
    }

    function get() returns (uint retVal) {
        return storedData;
    }

    function setArray(uint[] values) {
      for (uint i = 0; i < values.length; i++) {
        storedDatum.push(values[i]);
      }
    }

    function getArray() returns (uint[] retVal) {
        return storedDatum;
    }

    function getTuple(uint v1, uint v2, uint v3) returns (uint, uint, uint) {
      return (v1, v2, v3);
    }

}
