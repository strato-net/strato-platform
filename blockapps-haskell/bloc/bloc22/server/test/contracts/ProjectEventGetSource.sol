contract ProjectEvent {

    enum ProjectEvent {
      NULL,
      ACCEPT,
      DELIVER,
      RECEIVE
    }
    function __getContractName__() view returns (string) {
        return "ProjectEvent";
    }
    function __getSource__() view public returns (string) {
        return "contract ProjectEvent {\n\n    enum ProjectEvent {\n        NULL,\n        ACCEPT,\n        DELIVER,\n        RECEIVE\n    }\n}";
    }
}
