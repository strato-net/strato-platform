contract ProjectState {

    enum ProjectState {
        NULL,
        OPEN,
        PRODUCTION,
        INTRANSIT,
        RECEIVED
    }

    function __getSource__() constant returns (string) {
        return "contract ProjectState {    enum ProjectState {        NULL,        OPEN,        PRODUCTION,        INTRANSIT,        RECEIVED    }}";
  }
}