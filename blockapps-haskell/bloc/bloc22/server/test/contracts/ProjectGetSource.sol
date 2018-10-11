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
    function __getContractName__() view returns (string) {
        return "ErrorCodes";
    }
    function __getSource__() view public returns (string) {
        return "contract ErrorCodes {\n\n    enum ErrorCodes {\n        NULL,\n        SUCCESS,\n        ERROR,\n        NOT_FOUND,\n        EXISTS,\n        RECURSIVE,\n        INSUFFICIENT_BALANCE\n    }\n}\n\ncontract ProjectState {\n\n    enum ProjectState {\n        NULL,\n        OPEN,\n        PRODUCTION,\n        INTRANSIT,\n        RECEIVED\n    }\n}\n\ncontract Project is ErrorCodes, ProjectState {\n  string public name;\n  string public buyer;\n  string public description;\n  string public spec;\n  uint public price;\n\n  uint public created;\n  uint public targetDelivery;\n  uint public delivered;\n\n  string public addressStreet;\n  string public addressCity;\n  string public addressState;\n  string public addressZip;\n\n  ProjectState public state;\n\n  function Project(\n    string _name,\n    string _buyer,\n    string _description,\n    string _spec,\n    uint _price,\n    uint _created,\n    uint _targetDelivery\n  ) {\n    name = _name;\n    buyer = _buyer;\n    description = _description;\n    spec = _spec;\n    price = _price;\n    created = _created;\n    targetDelivery = _targetDelivery;\n\n    state = ProjectState.OPEN;\n  }\n\n  function setShippingAddress(\n    string _addressStreet,\n    string _addressCity,\n    string _addressState,\n    string _addressZip\n  ) {\n    addressStreet = _addressStreet;\n    addressCity = _addressCity;\n    addressState = _addressState;\n    addressZip = _addressZip;\n  }\n\n  function getState() returns (ProjectState) {\n    return state;\n  }\n\n  function setState(ProjectState _state) {\n    state = _state;\n  }\n}";
    }
}contract ProjectState {

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
        return "contract ErrorCodes {\n\n    enum ErrorCodes {\n        NULL,\n        SUCCESS,\n        ERROR,\n        NOT_FOUND,\n        EXISTS,\n        RECURSIVE,\n        INSUFFICIENT_BALANCE\n    }\n}\n\ncontract ProjectState {\n\n    enum ProjectState {\n        NULL,\n        OPEN,\n        PRODUCTION,\n        INTRANSIT,\n        RECEIVED\n    }\n}\n\ncontract Project is ErrorCodes, ProjectState {\n  string public name;\n  string public buyer;\n  string public description;\n  string public spec;\n  uint public price;\n\n  uint public created;\n  uint public targetDelivery;\n  uint public delivered;\n\n  string public addressStreet;\n  string public addressCity;\n  string public addressState;\n  string public addressZip;\n\n  ProjectState public state;\n\n  function Project(\n    string _name,\n    string _buyer,\n    string _description,\n    string _spec,\n    uint _price,\n    uint _created,\n    uint _targetDelivery\n  ) {\n    name = _name;\n    buyer = _buyer;\n    description = _description;\n    spec = _spec;\n    price = _price;\n    created = _created;\n    targetDelivery = _targetDelivery;\n\n    state = ProjectState.OPEN;\n  }\n\n  function setShippingAddress(\n    string _addressStreet,\n    string _addressCity,\n    string _addressState,\n    string _addressZip\n  ) {\n    addressStreet = _addressStreet;\n    addressCity = _addressCity;\n    addressState = _addressState;\n    addressZip = _addressZip;\n  }\n\n  function getState() returns (ProjectState) {\n    return state;\n  }\n\n  function setState(ProjectState _state) {\n    state = _state;\n  }\n}";
    }
}contract Project is ErrorCodes, ProjectState {

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
    function Project(string _name, string _buyer, string _description, string _spec, uint _price, uint _created, uint _targetDelivery) public {
        name = _name;
    buyer = _buyer;
    description = _description;
    spec = _spec;
    price = _price;
    created = _created;
    targetDelivery = _targetDelivery;

    state = ProjectState.OPEN;
  
    }
    function __getContractName__() view returns (string) {
        return "Project";
    }
    function __getSource__() view public returns (string) {
        return "contract ErrorCodes {\n\n    enum ErrorCodes {\n        NULL,\n        SUCCESS,\n        ERROR,\n        NOT_FOUND,\n        EXISTS,\n        RECURSIVE,\n        INSUFFICIENT_BALANCE\n    }\n}\n\ncontract ProjectState {\n\n    enum ProjectState {\n        NULL,\n        OPEN,\n        PRODUCTION,\n        INTRANSIT,\n        RECEIVED\n    }\n}\n\ncontract Project is ErrorCodes, ProjectState {\n  string public name;\n  string public buyer;\n  string public description;\n  string public spec;\n  uint public price;\n\n  uint public created;\n  uint public targetDelivery;\n  uint public delivered;\n\n  string public addressStreet;\n  string public addressCity;\n  string public addressState;\n  string public addressZip;\n\n  ProjectState public state;\n\n  function Project(\n    string _name,\n    string _buyer,\n    string _description,\n    string _spec,\n    uint _price,\n    uint _created,\n    uint _targetDelivery\n  ) {\n    name = _name;\n    buyer = _buyer;\n    description = _description;\n    spec = _spec;\n    price = _price;\n    created = _created;\n    targetDelivery = _targetDelivery;\n\n    state = ProjectState.OPEN;\n  }\n\n  function setShippingAddress(\n    string _addressStreet,\n    string _addressCity,\n    string _addressState,\n    string _addressZip\n  ) {\n    addressStreet = _addressStreet;\n    addressCity = _addressCity;\n    addressState = _addressState;\n    addressZip = _addressZip;\n  }\n\n  function getState() returns (ProjectState) {\n    return state;\n  }\n\n  function setState(ProjectState _state) {\n    state = _state;\n  }\n}";
    }
    function getState() public returns (ProjectState) {
        return state;
  
    }
    function setShippingAddress(string _addressStreet, string _addressCity, string _addressState, string _addressZip) public {
        addressStreet = _addressStreet;
    addressCity = _addressCity;
    addressState = _addressState;
    addressZip = _addressZip;
  
    }
    function setState(ProjectState _state) public {
        state = _state;
  
    }
}
