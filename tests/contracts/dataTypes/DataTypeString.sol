contract DataTypeString {
    string storedData;

    string[] storedDatum;

    struct StoredStruct {
      string value;
      string[] values;
    }
    StoredStruct storedStruct;
    StoredStruct[] storedStructs;

    mapping (string => string) valueMapping;

    function DataTypeString(string _storedData) {
        storedData = _storedData;
    }

    function set(string value) {
        storedData = value;
    }

    function get() returns (string retVal) {
        return storedData;
    }

    /* Array of strings as a function argument is not supported by solidity
     * Using index instead
     */
    function setArray(string value, uint index) {
      if(index >= storedDatum.length) {
        for(uint i = storedDatum.length; i <= index; i++) {
          storedDatum.push("");
        }
      }
      storedDatum[index] = value;
    }


    /* Array of strings as a function return is not supported by solidity
     * Using index instead
     */
    function getArray(uint index) returns (string retVal) {
      return storedDatum[index];
    }


    function getTuple(string v1, string v2, string v3) returns (string, string, string) {
      return (v1, v2, v3);
    }

    /* Array of strings as a function argument is not supported by solidity
     * Using index instead
     */
    function setStruct(string value, string arrayValue, uint index) returns (string, string) {
      storedStruct.value = value;
      if(index >= storedStruct.values.length) {
        for(uint i = storedStruct.values.length; i <= index; i++) {
          storedStruct.values.push("");
        }
      }
      storedStruct.values[index] = arrayValue;
      return (storedStruct.value, storedStruct.values[index]);
    }

    /* Array of strings as a function argument is not supported by solidity
     * Using storedStruct instead
     */
    function setStructArray() {
      storedStructs.push(storedStruct);
      storedStructs.push(storedStruct);
      storedStructs.push(storedStruct);
    }

    function setMapping(string value, string key) returns (string) {
      valueMapping[key] = value;
      return valueMapping[key];
    }
}
