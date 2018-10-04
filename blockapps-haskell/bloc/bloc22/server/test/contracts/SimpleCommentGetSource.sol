contract SimpleStorage {

    uint storedData;
    function __getContractName__() view returns (string) {
        return "SimpleStorage";
    }
    function __getSource__() view public returns (string) {
        return "contract SimpleStorage {\n  // So many comments!!!\n  // Allll the comments!!!!\n  // need more Comments!!!!!\n  // need more Comments!!!!!\n  // need more Comments!!!!!\n  // need more Comments!!!!!\n  // need more Comments!!!!!\n  // need more Comments!!!!!\n  // need more Comments!!!!!\n  // need more Comments!!!!!\n  // need more Comments!!!!!\n  uint storedData;\n  // need more Comments!!!!!\n  function set(uint x) {\n    // need more Comments!!!!!\n    storedData = x;\n    // need more Comments!!!!!\n  }\n  // need more Comments!!!!!\n  function get() returns (uint retVal) {\n    // need more Comments!!!!!\n    return storedData;\n    // need more Comments!!!!!\n  }\n  // need more Comments!!!!!\n}\n";
    }
    function get() public returns (uint retVal) {
        return storedData;
    
  
    }
    function set(uint x) public {
        storedData = x;
    
  
    }
}
