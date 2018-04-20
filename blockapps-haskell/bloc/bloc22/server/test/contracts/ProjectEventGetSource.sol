contract ProjectEvent {

    enum ProjectEvent {
      NULL,
      ACCEPT,
      DELIVER,
      RECEIVE
    }
    function __getContractName__() constant returns (string) {
        return "ProjectEvent";
    }
    function __getSource__() constant public returns (string) {
        return "contract ProjectEvent {\n\n    enum ProjectEvent {\n        NULL,\n        ACCEPT,\n        DELIVER,\n        RECEIVE\n    }\n}";  
    
    }
}