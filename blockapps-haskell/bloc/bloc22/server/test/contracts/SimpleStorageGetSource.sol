contract SimpleStorage {

    uint storedData;
    function SimpleStorage() public {
        storedData = 1;
  
    }
    function __getContractName__() view returns (string) {
        return "SimpleStorage";
    }
    function __getSource__() view public returns (string) {
        return "contract SimpleStorage {\n  uint storedData;\n\n  function SimpleStorage() {\n    storedData = 1;\n  }\n\n  function set(uint x) {\n    storedData = x;\n  }\n\n  function get() constant returns (uint) {\n    return storedData;\n  }\n}\n";
    }
    function get() constant public returns (uint) {
        return storedData;
  
    }
    function set(uint x) public {
        storedData = x;
  
    }
}
