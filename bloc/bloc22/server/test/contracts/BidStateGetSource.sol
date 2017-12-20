contract BidState {

    enum BidState {
        NULL,
        OPEN,
        ACCEPTED,
        REJECTED
    }

    function __getSource__() constant returns (string) {
      return "contract BidState {    enum BidState {        NULL,        OPEN,        ACCEPTED,        REJECTED    }}";
  }
}
