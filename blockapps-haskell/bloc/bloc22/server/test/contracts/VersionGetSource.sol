contract Version {

    uint version;
    function __getContractName__() constant returns (string) {
        return "Version";
    }
    function __getSource__() constant public returns (string) {
        return "contract Version {\n  uint version;\n}";  
    
    }
}