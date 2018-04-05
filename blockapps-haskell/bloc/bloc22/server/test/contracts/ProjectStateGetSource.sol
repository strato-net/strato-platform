contract ProjectState {

    enum ProjectState {
      NULL,
      OPEN,
      PRODUCTION,
      INTRANSIT,
      RECEIVED
    }
    function __getSource__() constant returns (string) {
        return "contract ProjectState {\n\n    enum ProjectState {\n        NULL,\n        OPEN,\n        PRODUCTION,\n        INTRANSIT,\n        RECEIVED\n    }\n}";  
    }
}