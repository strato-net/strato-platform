contract record DataTypeString {
    string storedData;

    string[] storedDatum;

    struct StoredStruct {
      string value;
      string[3] values;
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
     * Using count instead
     */
    function setArray(string value, uint count) {
      for(uint i = 0;i < count; i++) {
        storedDatum.push(value);
      }
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
    function setStruct(string value, string arrayValue, uint count) returns (string, uint) {
      storedStruct.value = value;
      for(uint i = 0;i < count; i++) {
        storedStruct.values[i] = arrayValue;
      }
      return (storedStruct.value, storedStruct.values.length);
    }

    /* Array of strings as a function argument is not supported by solidity
     * Using storedStruct instead
     */
    function setStructArray(string value, string arrayValue, uint count) {
      for(uint i = 0; i < count; i++) {
        string[3] memory strArray;
        for(uint j = 0; j < 3; j++) {
          strArray[j] = arrayValue;
        }
        StoredStruct memory ss = StoredStruct(value,strArray);
        storedStructs.push(ss);
      }
    }

    function setMapping(string value, string key) returns (string) {
      valueMapping[key] = value;
      return valueMapping[key];
    }
}
