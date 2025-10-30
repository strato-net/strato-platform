contract record DataTypeUint {
    uint storedData;

    uint[] storedDatum;

    struct StoredStruct {
      uint value;
      uint[] values;
    }
    StoredStruct storedStruct;
    StoredStruct[] storedStructs;

    mapping (uint => uint) valueMapping;

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

    // structs can not be returned in solidity
    // this tests returning tuple(uint, uint[]) instead
    function setStruct(uint value, uint[] values) returns (uint, uint[]) {
      storedStruct = StoredStruct(value, values);
      return (storedStruct.value, storedStruct.values);
    }

    function setStructArray(uint value, uint[] values) {
      StoredStruct memory storedStruct = StoredStruct(value, values);
      storedStructs.push(storedStruct);
      storedStructs.push(storedStruct);
      storedStructs.push(storedStruct);
    }

    function setMapping(uint value, uint key) returns (uint) {
      valueMapping[key] = value;
      return valueMapping[key];
    }
}
