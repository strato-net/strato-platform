const SimpleStorage = `
contract SimpleStorage {
  uint storedData;
  constructor() {
    storedData = 1;
  }
  function set(uint x) {
    storedData = x;
  }
  function get() constant returns (uint) {
    return storedData;
  }
}`

const ERC20 = `
contract ERC20 {
  event Transfer(address _from, address _to, uint _value);
  event Approval(address _owner, address _spender, uint _value);

  uint public totalSupply;
  mapping(address => uint) public balanceOf;
  mapping(address => mapping(address => uint)) public allowance;
  string public name;
  string public symbol;
  uint8 public decimals = 18;

  constructor(string name_, string symbol_) {
    name = name_;
    symbol = symbol_;
  }

  function transfer(address recipient, uint amount) external returns (bool) {
      balanceOf[msg.sender] -= amount;
      balanceOf[recipient] += amount;
      emit Transfer(msg.sender, recipient, amount);
      return true;
  }

  function approve(address spender, uint amount) external returns (bool) {
      allowance[msg.sender][spender] = amount;
      emit Approval(msg.sender, spender, amount);
      return true;
  }

  function transferFrom(
      address sender,
      address recipient,
      uint amount
  ) external returns (bool) {
      allowance[sender][msg.sender] -= amount;
      balanceOf[sender] -= amount;
      balanceOf[recipient] += amount;
      emit Transfer(sender, recipient, amount);
      return true;
  }

  function mint(uint amount) external {
      balanceOf[msg.sender] += amount;
      totalSupply += amount;
      emit Transfer(address(0), msg.sender, amount);
  }

  function burn(uint amount) external {
      balanceOf[msg.sender] -= amount;
      totalSupply -= amount;
      emit Transfer(msg.sender, address(0), amount);
  }
}
`

const ERC721 = `
contract ERC721 {
  event Transfer(address indexed from, address indexed to, uint indexed id);
  event Approval(address indexed owner, address indexed spender, uint indexed id);
  event ApprovalForAll(
      address indexed owner,
      address indexed operator,
      bool approved
  );

  // Mapping from token ID to owner address
  mapping(uint => address) internal _ownerOf;

  // Mapping owner address to token count
  mapping(address => uint) internal _balanceOf;

  // Mapping from token ID to approved address
  mapping(uint => address) internal _approvals;

  // Mapping from owner to operator approvals
  mapping(address => mapping(address => bool)) public isApprovedForAll;

  function ownerOf(uint id) external view returns (address owner) {
      owner = _ownerOf[id];
      require(owner != address(0), "token doesn't exist");
  }

  function balanceOf(address owner) external view returns (uint) {
      require(owner != address(0), "owner = zero address");
      return _balanceOf[owner];
  }

  function setApprovalForAll(address operator, bool approved) external {
      isApprovedForAll[msg.sender][operator] = approved;
      emit ApprovalForAll(msg.sender, operator, approved);
  }

  function approve(address spender, uint id) external {
      address owner = _ownerOf[id];
      require(
          msg.sender == owner || isApprovedForAll[owner][msg.sender],
          "not authorized"
      );

      _approvals[id] = spender;

      emit Approval(owner, spender, id);
  }

  function getApproved(uint id) external view returns (address) {
      require(_ownerOf[id] != address(0), "token doesn't exist");
      return _approvals[id];
  }

  function _isApprovedOrOwner(
      address owner,
      address spender,
      uint id
  ) internal view returns (bool) {
      return (spender == owner ||
          isApprovedForAll[owner][spender] ||
          spender == _approvals[id]);
  }

  function transferFrom(address from, address to, uint id) public {
      require(from == _ownerOf[id], "from != owner");
      require(to != address(0), "transfer to zero address");

      require(_isApprovedOrOwner(from, msg.sender, id), "not authorized");

      _balanceOf[from]--;
      _balanceOf[to]++;
      _ownerOf[id] = to;

      delete _approvals[id];

      emit Transfer(from, to, id);
  }

  function safeTransferFrom(address from, address to, uint id) external {
      transferFrom(from, to, id);

      require(account(to).code("") == "", "unsafe recipient");
  }

  function safeTransferFrom(
      address from,
      address to,
      uint id,
      bytes calldata data
  ) external {
      transferFrom(from, to, id);

      require(account(to).code("") == "", "unsafe recipient");
  }

  function _mint(address to, uint id) internal {
      require(to != address(0), "mint to zero address");
      require(_ownerOf[id] == address(0), "already minted");

      _balanceOf[to]++;
      _ownerOf[id] = to;

      emit Transfer(address(0), to, id);
  }

  function _burn(uint id) internal {
      address owner = _ownerOf[id];
      require(owner != address(0), "not minted");

      _balanceOf[owner] -= 1;

      delete _ownerOf[id];
      delete _approvals[id];

      emit Transfer(owner, address(0), id);
  }
}
`

const HelloWorld = `
contract HelloWorld {
  function riseAndShine () returns (string) {
    return "Hello World!";
  }
}
`

const PermissionManager = `
contract Permit {
  address owner;

  string id;
  address adrs;
  uint public permissions;

  constructor(string _id, address _adrs, uint _permissions) {
    owner = msg.sender;
    id = _id;
    adrs = _adrs;
    permissions = _permissions;
  }
  
  function setPermissions(uint _permissions) {
    require(owner == msg.sender);
    permissions = _permissions;
  }
}

/**
* Permission Manager for all
*/
contract PermissionManager {
  // master account
  address master;
  // owner account
  address owner;

  // addresses and their permissions

  Permit[] permits;

  enum EventLogType { 
    NULL,
    GRANT,
    REVOKE,
    CHECK
  }

  // event log entry
  struct EventLogEntry {
    // meta
    address msgSender;
    uint blockTimestamp;
    // event
    uint eventType;
    string id;
    address adrs;
    uint permissions;
    bool result;
  }

  // event log
  EventLogEntry[] eventLog;

  /*
    note on mapping to array index:
    a non existing mapping will return 0, so 0 should not be a valid value in a map,
    otherwise exists() will not work
  */
  mapping (address => uint) addressToIndexMap;

  /**
  * Constructor
  */
  function PermissionManager(address _owner, address _master) {
    owner = _owner;
    master = _master;
    permits.length = 1; // see above note
  }

  function transferOwnership(address _newOwner) public returns (bool) {
    // only the master can transfer ownership
    if (msg.sender != master) {
      return false;
    }

    owner = _newOwner;
    return true;
  }

  function exists(address _address) public returns (bool) {
    return addressToIndexMap[_address] != 0;
  }

  function getPermissions(address _address) public constant returns (bool, uint) {
    // error if address doesnt exists
    if (!exists(_address)) {
      return (false, 0);
    }
    // got permissions
    uint index = addressToIndexMap[_address];
    return (true, permits[index].permissions());
  }


  function _grant(string _id, address _address, uint _permissions) private returns (bool, uint) {
    // authorize owner
    if (msg.sender != owner) {
      return (false, 0);
    }
    uint index;
    Permit permit;
    // exists ?
    if (!exists(_address)) {
      // if new - add permit with initial permissions
      index = permits.length;
      addressToIndexMap[_address] = index;
      permit = new Permit(_id, _address, _permissions);
      permits.push(permit);
    } else {
      // if exists - update
      index = addressToIndexMap[_address];
      permit = permits[index];
      permit.setPermissions(permit.permissions() | _permissions);
    }
    return (true, permit.permissions());
  }

  function grant(string _id, address _address, uint _permissions) public returns (bool, uint) {
    // call grant
    var(restStatus, permitPermissions) = _grant(_id, _address, _permissions);
    // log the results
    EventLogEntry memory eventLogEntry = EventLogEntry(
    // meta
      msg.sender,
      block.timestamp,
    // event
      uint(EventLogType.GRANT),
      _id,
      _address,
      _permissions,
      restStatus
    );
    eventLog.push(eventLogEntry);
    return (restStatus, permitPermissions);
  }

  function _revoke(address _address) private returns (bool) {
    // authorize owner
    if (msg.sender != owner) {
      return false;
    }
    // error if address doesnt exists
    if (!exists(_address)) {
      return false;
    }
    // revoke
    uint index = addressToIndexMap[_address];
    Permit permit = permits[index];
    permit.setPermissions(0);
    return true;
  }

  function revoke(address _address) public returns (bool) {
    // call revoke
    bool result = _revoke(_address);
    // log the result
    EventLogEntry memory eventLogEntry = EventLogEntry(
    // meta
      msg.sender,
      block.timestamp,
    // event
      uint(EventLogType.REVOKE),
      '',
      _address,
      0,
      result
    );
    eventLog.push(eventLogEntry);
    return (result);
  }

  function _check(address _address, uint _permissions) private constant returns (bool) {
    // error if address doesnt exists
    if (!exists(_address)) {
      return false;
    }
    // check
    uint index = addressToIndexMap[_address];
    Permit permit = permits[index];
    if (permit.permissions() & _permissions != _permissions) {
      return false;
    }
    return true;
  }

  function check(address _address, uint _permissions) public constant returns (bool) {
    // call check
    bool result = _check(_address, _permissions);
    // log the result
    if (result != true) {
      EventLogEntry memory eventLogEntry = EventLogEntry(
      // meta
        msg.sender,
        block.timestamp,
      // event
        uint(EventLogType.CHECK),
        '',
        _address,
        _permissions,
        result
      );
      eventLog.push(eventLogEntry);
    }
    return (result);
  }
  
  // STUB base function - must be overriden
  function canModifyMap(address _address) returns (bool) {
    return false;
  }
}
`

export default {
    HelloWorld,
    SimpleStorage,
    ERC20,
    ERC721,
    PermissionManager,
  }
