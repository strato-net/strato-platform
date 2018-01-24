contract BidState {

    enum BidState {
      NULL,
      OPEN,
      ACCEPTED,
      REJECTED
    }
    function __getSource__() constant returns (string) {
        return "contract BidState {\n\n    enum BidState {\n        NULL,\n        OPEN,\n        ACCEPTED,\n        REJECTED\n    }\n}\n";  
    }
}