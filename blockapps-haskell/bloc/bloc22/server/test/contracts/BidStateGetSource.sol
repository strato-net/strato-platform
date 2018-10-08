contract BidState {

    enum BidState {
      NULL,
      OPEN,
      ACCEPTED,
      REJECTED
    }
    function __getContractName__() view returns (string) {
        return "BidState";
    }
    function __getSource__() view public returns (string) {
        return "contract BidState {\n\n    enum BidState {\n        NULL,\n        OPEN,\n        ACCEPTED,\n        REJECTED\n    }\n}\n";
    }
}
