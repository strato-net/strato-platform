contract Enumerable {
    mapping (uint => string) reverseEnumMap;
    function getJson() constant returns (string) {
        bytes memory json = new bytes(1024);
        uint enumIndex = 0;
        json[0] = '[';
        uint jsonIndex = 1;
        while (bytes(reverseEnumMap[enumIndex]).length != 0) {

            // add thename info
            bytes memory name = new bytes(bytes(reverseEnumMap[enumIndex]).length);
            name = bytes(reverseEnumMap[enumIndex]);
            json[jsonIndex++] = '"';
            for (uint i = 0; i < name.length; i++) {
                json[jsonIndex++] = name[i];
            }
            json[jsonIndex++] = '"';
            json[jsonIndex++] = ',';
            enumIndex++;
        }
        json[jsonIndex - 1] = ']';
        return string(json);
    }
}
