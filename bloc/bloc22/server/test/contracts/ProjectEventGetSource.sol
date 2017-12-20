contract ProjectEvent {

    enum ProjectEvent {
        NULL,
        ACCEPT,
        DELIVER,
        RECEIVE
    }

    function __getSource__() constant returns (string) {
        return "contract ProjectEvent {    enum ProjectEvent {        NULL,        ACCEPT,        DELIVER,        RECEIVE    }}";
  }
}