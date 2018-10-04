contract Util {

    function __getContractName__() view returns (string) {
        return "Util";
    }
    function __getSource__() view public returns (string) {
        return "/**\n * Util contract\n */\ncontract Util {\n  function stringToBytes32(string memory source) returns (bytes32 result) {\n    assembly {\n    result := mload(add(source, 32))\n        }\n  }\n\n  function b32(string memory source) returns (bytes32) {\n    return stringToBytes32(source);\n  }\n}\n";
    }
    function b32(string source) public returns (bytes32) {
        return stringToBytes32(source);
  
    }
    function stringToBytes32(string source) public returns (bytes32 result) {
        assembly {result := mload(add(source, 32))
        }
    }
}
