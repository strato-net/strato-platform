
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

contract Version {
  uint version;
}

contract UserRole {

    enum UserRole {
        NULL,
        ADMIN,
        BUYER,
        SUPPLIER
    }
}

contract User is ErrorCodes, Version, UserRole {
  address public account = 0x1234;
  string public username;
  bytes32 public pwHash;
  uint public id;
  UserRole public role;

  function User(address _account, string _username, bytes32 _pwHash, uint _id, UserRole _role) {
    account = _account;
    username = _username;
    pwHash = _pwHash;
    id = _id;
    role = _role;
    version = 1;
  }

  function authenticate(bytes32 _pwHash) returns (bool) {
    return pwHash == _pwHash;
  }
}

contract Util {
  function stringToBytes32(string memory source) returns (bytes32 result) {
    assembly {
    result := mload(add(source, 32))
        }
  }

  function b32(string memory source) returns (bytes32) {
    return stringToBytes32(source);
  }
}

contract UserManager is ErrorCodes, Util, UserRole {
  User[] users;
  mapping (bytes32 => uint) usernameToIdMap;

  function UserManager() {
    users.length = 1;
  }

  function exists(string username) returns (bool) {
    return usernameToIdMap[b32(username)] != 0;
  }

  function getUser(string username) returns (address) {
    uint userId = usernameToIdMap[b32(username)];
    return users[userId];
  }

  function createUser(address account, string username, bytes32 pwHash, UserRole role) returns (ErrorCodes) {
    if (bytes(username).length > 32)
      return ErrorCodes.ERROR;
    if (exists(username))
      return ErrorCodes.EXISTS;
    uint userId = users.length;
    usernameToIdMap[b32(username)] = userId;
    users.push(new User(account, username, pwHash, userId, role));
    return ErrorCodes.SUCCESS;
  }

  function login(string username, bytes32 pwHash) returns (bool) {
    if (!exists(username))
      return false;
    address a = getUser(username);
    User user = User(a);
    return user.authenticate(pwHash);
  }
}

contract BidState {

    enum BidState {
        NULL,
        OPEN,
        ACCEPTED,
        REJECTED
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

contract ProjectEvent {

    enum ProjectEvent {
        NULL,
        ACCEPT,
        DELIVER,
        RECEIVE
    }
}

contract ProjectManager is ErrorCodes, Util, ProjectState, ProjectEvent, BidState {

  Project[] projects;
  uint bidId;
  mapping (bytes32 => uint) nameToIndexMap;

  function ProjectManager() {
    projects.length = 1;
    bidId = block.number;
  }

  function exists(string name) returns (bool) {
    return nameToIndexMap[b32(name)] != 0;
  }

  function getProject(string name) returns (address) {
    uint index = nameToIndexMap[b32(name)];
    return projects[index];
  }

  function createProject(
    string name,
    string buyer,
    string description,
    string spec,
    uint price,
    uint created,
    uint targetDelivery
  ) returns (ErrorCodes) 
  {
    if (bytes(name).length > 32)
      return ErrorCodes.ERROR;
    if (exists(name))
      return ErrorCodes.EXISTS;
    uint index = projects.length;
    nameToIndexMap[b32(name)] = index;
    projects.push(new Project(
      name,
      buyer,
      description,
      spec,
      price,
      created,
      targetDelivery
    ));
    return ErrorCodes.SUCCESS;
  }

  function createBid(string name, string supplier, uint amount) returns (ErrorCodes, uint) {
    if (!exists(name))
      return (ErrorCodes.NOT_FOUND, 0);
    bidId++;
    Bid bid = new Bid(bidId, name, supplier, amount);
    return (ErrorCodes.SUCCESS, bidId);
  }

  function settleProject(string name, address supplierAddress, address bidAddress) returns (ErrorCodes) {
    if (!exists(name))
      return (ErrorCodes.NOT_FOUND);
    address projectAddress = getProject(name);
    var (errorCode, state) = handleEvent(projectAddress, ProjectEvent.RECEIVE);
    if (errorCode != ErrorCodes.SUCCESS)
      return errorCode;
    Bid bid = Bid(bidAddress);
    return bid.settle(supplierAddress);
  }

  function handleEvent(address projectAddress, ProjectEvent projectEvent) returns (ErrorCodes, ProjectState) {
    Project project = Project(projectAddress);
    ProjectState state = project.getState();
    var (errorCode, newState) = fsm(state, projectEvent);
    if (errorCode != ErrorCodes.SUCCESS) {
      return (errorCode, state);
    }
    project.setState(newState);
    return (ErrorCodes.SUCCESS, newState);
  }

  function fsm(ProjectState state, ProjectEvent projectEvent) returns (ErrorCodes, ProjectState) {
    if (state == ProjectState.NULL)
      return (ErrorCodes.ERROR, state);
    if (state == ProjectState.OPEN) {
      if (projectEvent == ProjectEvent.ACCEPT)
        return (ErrorCodes.SUCCESS, ProjectState.PRODUCTION);
    }
    if (state == ProjectState.PRODUCTION) {
      if (projectEvent == ProjectEvent.DELIVER)
        return (ErrorCodes.SUCCESS, ProjectState.INTRANSIT);
    }
    if (state == ProjectState.INTRANSIT) {
      if (projectEvent == ProjectEvent.RECEIVE)
        return (ErrorCodes.SUCCESS, ProjectState.RECEIVED);
    }
    return (ErrorCodes.ERROR, state);
  }
}

contract AdminInterface {
  UserManager public userManager;
  ProjectManager public projectManager;

  function AdminInterface() {
    userManager = new UserManager();
    projectManager = new ProjectManager();
  }
}