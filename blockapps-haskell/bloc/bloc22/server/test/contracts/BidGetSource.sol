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
        return "contract BidState {\n\n    enum BidState {\n        NULL,\n        OPEN,\n        ACCEPTED,\n        REJECTED\n    }\n}\n\ncontract ErrorCodes {\n\n    enum ErrorCodes {\n        NULL,\n        SUCCESS,\n        ERROR,\n        NOT_FOUND,\n        EXISTS,\n        RECURSIVE,\n        INSUFFICIENT_BALANCE\n    }\n}\n\ncontract Bid is ErrorCodes, BidState {\n  uint public id;\n  string public name;\n  string public supplier;\n  uint public amount;\n  BidState public state;\n\n  function Bid(uint _id, string _name, string _supplier, uint _amount) {\n    id = _id;\n    name = _name;\n    supplier = _supplier;\n    amount = _amount;\n    state = BidState.OPEN;\n  }\n\n  function getState() returns (BidState) {\n    return state;\n  }\n\n  function setState(BidState _state) {\n    state = _state;\n  }\n\n  function setBidState(BidState newState) payable returns (ErrorCodes) {\n    if (state == BidState.OPEN && newState == BidState.ACCEPTED) {\n      setState(newState);\n      return ErrorCodes.SUCCESS;\n    }\n    if (state == BidState.OPEN && newState == BidState.REJECTED) {\n      setState(newState);\n      return ErrorCodes.SUCCESS;\n    }\n    return ErrorCodes.ERROR;\n  }\n\n  function settle(address supplierAddress) returns (ErrorCodes) {\n    if (this.balance < amount) {\n      return ErrorCodes.INSUFFICIENT_BALANCE;\n    }\n    uint fee = 10000000 wei;\n    uint amountWei = amount * 1 ether;\n\n    supplierAddress.send(amountWei-fee);\n    return ErrorCodes.SUCCESS;\n  }\n}\n";
    }
}contract ErrorCodes {

    enum ErrorCodes {
      NULL,
      SUCCESS,
      ERROR,
      NOT_FOUND,
      EXISTS,
      RECURSIVE,
      INSUFFICIENT_BALANCE
    }
    function __getContractName__() view returns (string) {
        return "ErrorCodes";
    }
    function __getSource__() view public returns (string) {
        return "contract BidState {\n\n    enum BidState {\n        NULL,\n        OPEN,\n        ACCEPTED,\n        REJECTED\n    }\n}\n\ncontract ErrorCodes {\n\n    enum ErrorCodes {\n        NULL,\n        SUCCESS,\n        ERROR,\n        NOT_FOUND,\n        EXISTS,\n        RECURSIVE,\n        INSUFFICIENT_BALANCE\n    }\n}\n\ncontract Bid is ErrorCodes, BidState {\n  uint public id;\n  string public name;\n  string public supplier;\n  uint public amount;\n  BidState public state;\n\n  function Bid(uint _id, string _name, string _supplier, uint _amount) {\n    id = _id;\n    name = _name;\n    supplier = _supplier;\n    amount = _amount;\n    state = BidState.OPEN;\n  }\n\n  function getState() returns (BidState) {\n    return state;\n  }\n\n  function setState(BidState _state) {\n    state = _state;\n  }\n\n  function setBidState(BidState newState) payable returns (ErrorCodes) {\n    if (state == BidState.OPEN && newState == BidState.ACCEPTED) {\n      setState(newState);\n      return ErrorCodes.SUCCESS;\n    }\n    if (state == BidState.OPEN && newState == BidState.REJECTED) {\n      setState(newState);\n      return ErrorCodes.SUCCESS;\n    }\n    return ErrorCodes.ERROR;\n  }\n\n  function settle(address supplierAddress) returns (ErrorCodes) {\n    if (this.balance < amount) {\n      return ErrorCodes.INSUFFICIENT_BALANCE;\n    }\n    uint fee = 10000000 wei;\n    uint amountWei = amount * 1 ether;\n\n    supplierAddress.send(amountWei-fee);\n    return ErrorCodes.SUCCESS;\n  }\n}\n";
    }
}contract Bid is ErrorCodes, BidState {

    uint public id;
    string public name;
    string public supplier;
    uint public amount;
    BidState public state;
    function Bid(uint _id, string _name, string _supplier, uint _amount) public {
        id = _id;
    name = _name;
    supplier = _supplier;
    amount = _amount;
    state = BidState.OPEN;
  
    }
    function __getContractName__() view returns (string) {
        return "Bid";
    }
    function __getSource__() view public returns (string) {
        return "contract BidState {\n\n    enum BidState {\n        NULL,\n        OPEN,\n        ACCEPTED,\n        REJECTED\n    }\n}\n\ncontract ErrorCodes {\n\n    enum ErrorCodes {\n        NULL,\n        SUCCESS,\n        ERROR,\n        NOT_FOUND,\n        EXISTS,\n        RECURSIVE,\n        INSUFFICIENT_BALANCE\n    }\n}\n\ncontract Bid is ErrorCodes, BidState {\n  uint public id;\n  string public name;\n  string public supplier;\n  uint public amount;\n  BidState public state;\n\n  function Bid(uint _id, string _name, string _supplier, uint _amount) {\n    id = _id;\n    name = _name;\n    supplier = _supplier;\n    amount = _amount;\n    state = BidState.OPEN;\n  }\n\n  function getState() returns (BidState) {\n    return state;\n  }\n\n  function setState(BidState _state) {\n    state = _state;\n  }\n\n  function setBidState(BidState newState) payable returns (ErrorCodes) {\n    if (state == BidState.OPEN && newState == BidState.ACCEPTED) {\n      setState(newState);\n      return ErrorCodes.SUCCESS;\n    }\n    if (state == BidState.OPEN && newState == BidState.REJECTED) {\n      setState(newState);\n      return ErrorCodes.SUCCESS;\n    }\n    return ErrorCodes.ERROR;\n  }\n\n  function settle(address supplierAddress) returns (ErrorCodes) {\n    if (this.balance < amount) {\n      return ErrorCodes.INSUFFICIENT_BALANCE;\n    }\n    uint fee = 10000000 wei;\n    uint amountWei = amount * 1 ether;\n\n    supplierAddress.send(amountWei-fee);\n    return ErrorCodes.SUCCESS;\n  }\n}\n";
    }
    function getState() public returns (BidState) {
        return state;
  
    }
    function setBidState(BidState newState) payable public returns (ErrorCodes) {
        if (state == BidState.OPEN && newState == BidState.ACCEPTED) {setState(newState);
      return ErrorCodes.SUCCESS;
    }if (state == BidState.OPEN && newState == BidState.REJECTED) {setState(newState);
      return ErrorCodes.SUCCESS;
    }return ErrorCodes.ERROR;
  
    }
    function setState(BidState _state) public {
        state = _state;
  
    }
    function settle(address supplierAddress) public returns (ErrorCodes) {
        if (this.balance < amount) {return ErrorCodes.INSUFFICIENT_BALANCE;
    }uint fee = 10000000 wei;
    uint amountWei = amount * 1 ether;

    supplierAddress.send(amountWei-fee);
    return ErrorCodes.SUCCESS;
  
    }
}
