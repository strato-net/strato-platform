contract Constant {

    uint constant x = 777777;
    function __getContractName__() constant returns (string) {
        return "Constant";
    }
    function __getSource__() constant public returns (string) {
        return "contract Constant {\n  uint constant x = 777777;\n}\n";  
    
    }
}