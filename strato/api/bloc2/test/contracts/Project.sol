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

contract ProjectState {

    enum ProjectState {
        NULL,
        OPEN,
        PRODUCTION,
        INTRANSIT,
        RECEIVED
    }
}

contract Project is ErrorCodes, ProjectState {
  string public name;
  string public buyer;
  string public description;
  string public spec;
  uint public price;

  uint public created;
  uint public targetDelivery;
  uint public delivered;

  string public addressStreet;
  string public addressCity;
  string public addressState;
  string public addressZip;

  ProjectState public state;

  function Project(
    string _name,
    string _buyer,
    string _description,
    string _spec,
    uint _price,
    uint _created,
    uint _targetDelivery
  ) {
    name = _name;
    buyer = _buyer;
    description = _description;
    spec = _spec;
    price = _price;
    created = _created;
    targetDelivery = _targetDelivery;

    state = ProjectState.OPEN;
  }

  function setShippingAddress(
    string _addressStreet,
    string _addressCity,
    string _addressState,
    string _addressZip
  ) {
    addressStreet = _addressStreet;
    addressCity = _addressCity;
    addressState = _addressState;
    addressZip = _addressZip;
  }

  function getState() returns (ProjectState) {
    return state;
  }

  function setState(ProjectState _state) {
    state = _state;
  }
}