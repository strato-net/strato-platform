contract BidState {

    enum BidState {
        NULL,
        OPEN,
        ACCEPTED,
        REJECTED
    }
}

contract ErrorCodes {

    enum ErrorCodes {
        NULL,
        SUCCESS,
        ERROR,
        NOT_FOUND,
        EXISTS,
        RECURSIVE,
        INSUFFICIENT_BALANCE
    }
}

contract Bid is ErrorCodes, BidState {
  uint public id;
  string public name;
  string public supplier;
  uint public amount;
  BidState public state;

  function Bid(uint _id, string _name, string _supplier, uint _amount) {
    id = _id;
    name = _name;
    supplier = _supplier;
    amount = _amount;
    state = BidState.OPEN;
  }

  function getState() returns (BidState) {
    return state;
  }

  function setState(BidState _state) {
    state = _state;
  }

  function setBidState(BidState newState) payable returns (ErrorCodes) {
    if (state == BidState.OPEN && newState == BidState.ACCEPTED) {
      setState(newState);
      return ErrorCodes.SUCCESS;
    }
    if (state == BidState.OPEN && newState == BidState.REJECTED) {
      setState(newState);
      return ErrorCodes.SUCCESS;
    }
    return ErrorCodes.ERROR;
  }

  function settle(address supplierAddress) returns (ErrorCodes) {
    if (this.balance < amount) {
      return ErrorCodes.INSUFFICIENT_BALANCE;
    }
    uint fee = 10000000 wei;
    uint amountWei = amount * 1 ether;

    supplierAddress.send(amountWei-fee);
    return ErrorCodes.SUCCESS;
  }
}
