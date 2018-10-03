contract DataTypeInt {
    int storedData;

    int[] storedDatum;

    struct StoredStruct {
      int value;
      int[] values;
    }
    StoredStruct storedStruct;
    StoredStruct[] storedStructs;

    mapping (int => int) valueMapping;

    function DataTypeInt(int _storedData) {
        storedData = _storedData;
    }

    function set(int value) {
        storedData = value;
    }

    function get() returns (int retVal) {
        return storedData;
    }

    function setArray(int[] values) {
      for (uint i = 0; i < values.length; i++) {
        storedDatum.push(values[i]);
      }
    }

    function getArray() returns (int[] retVal) {
        return storedDatum;
    }

    function getTuple(int v1, int v2, int v3) returns (int, int, int) {
      return (v1, v2, v3);
    }

    // structs can not be returned in solidity
    // this tests returning tuple(int, int[]) instead
    function setStruct(int value, int[] values) returns (int, int[]) {
      storedStruct = StoredStruct(value, values);
      return (storedStruct.value, storedStruct.values);
    }

    function setStructArray(int value, int[] values) {
      StoredStruct memory storedStruct = StoredStruct(value, values);
      storedStructs.push(storedStruct);
      storedStructs.push(storedStruct);
      storedStructs.push(storedStruct);
    }

    function setMapping(int value, int key) returns (int) {
      valueMapping[key] = value;
      return valueMapping[key];
    }
}
