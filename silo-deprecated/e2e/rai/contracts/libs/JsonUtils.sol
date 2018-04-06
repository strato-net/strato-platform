/**
  * Inheritable contract with json utility methods
*/
contract JsonUtils {
  /**
    * Turn a bytes array into a json array
    * @param array {bytes[]} - array of bytes to be json-ified
    * @return {string} - string json array
  */
  function getJsonArray(bytes[] array) internal returns (string) {
    uint jsonIndex = 1;
    uint size = 1;

    for (uint a = 0; a < array.length; a++) {
      size += array[a].length + 3;
    }

    bytes memory json = new bytes(size);
    json[0] = '[';

    for (uint i = 0; i < array.length; i++) {
      bytes memory element = new bytes(array[i].length);
      element = array[i];

      json[jsonIndex++] = '"';
      for (uint j = 0; j < element.length; j++) {
        json[jsonIndex++] = element[j];
      }
      json[jsonIndex++] = '"';
      json[jsonIndex++] = ',';
    }
    json[jsonIndex - 1] = ']';
    return string(json);
  }
}
