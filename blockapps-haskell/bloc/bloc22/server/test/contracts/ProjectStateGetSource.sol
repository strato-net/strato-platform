contract ProjectState {

    enum ProjectState {
      NULL,
      OPEN,
      PRODUCTION,
      INTRANSIT,
      RECEIVED
    }
    function __getContractName__() constant returns (string) {
        return "ProjectState";
    }
    function __getSource__() constant public returns (string) {
        return "contract ProjectState {\n\n    enum ProjectState {\n        NULL,\n        OPEN,\n        PRODUCTION,\n        INTRANSIT,\n        RECEIVED\n    }\n}";  
    
    }
}