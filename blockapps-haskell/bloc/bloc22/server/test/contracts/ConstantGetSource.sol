pragma solidity ^0.4.8;
contract Constant {

    uint constant x = 777777;
    function __getContractName__() constant returns (string) {
        return "Constant";
    }
    function __getSource__() constant public returns (string) {
        return "pragma solidity ^0.4.8;\ncontract Constant {\n  uint constant x = 777777;\n}\n";  
    
    }
}