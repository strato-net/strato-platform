contract ProjectState {

    enum ProjectState {
      NULL,
      OPEN,
      PRODUCTION,
      INTRANSIT,
      RECEIVED
    }
    function __getContractName__() view returns (string) {
        return "ProjectState";
    }
    function __getSource__() view public returns (string) {
        return "contract ProjectState {\n\n    enum ProjectState {\n        NULL,\n        OPEN,\n        PRODUCTION,\n        INTRANSIT,\n        RECEIVED\n    }\n}";
    }
}
