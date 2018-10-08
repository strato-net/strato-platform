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
        return "contract ErrorCodes {\n\n  enum ErrorCodes {\n    NULL,\n    SUCCESS,\n    ERROR,\n    NOT_FOUND,\n    EXISTS,\n    RECURSIVE,\n    INSUFFICIENT_BALANCE\n  }\n}\n\ncontract Version {\n  uint version;\n}\n\ncontract UserRole {\n\n    enum UserRole {\n        NULL,\n        ADMIN,\n        BUYER,\n        SUPPLIER\n    }\n}\n\ncontract User is ErrorCodes, Version, UserRole {\n  address public account = 0x1234;\n  string public username;\n  bytes32 public pwHash;\n  uint public id;\n  UserRole public role;\n\n  function User(address _account, string _username, bytes32 _pwHash, uint _id, UserRole _role) {\n    account = _account;\n    username = _username;\n    pwHash = _pwHash;\n    id = _id;\n    role = _role;\n    version = 1;\n  }\n\n  function authenticate(bytes32 _pwHash) returns (bool) {\n    return pwHash == _pwHash;\n  }\n}\n\ncontract Util {\n  function stringToBytes32(string memory source) returns (bytes32 result) {\n    assembly {\n    result := mload(add(source, 32))\n        }\n  }\n\n  function b32(string memory source) returns (bytes32) {\n    return stringToBytes32(source);\n  }\n}\n\ncontract UserManager is ErrorCodes, Util, UserRole {\n  User[] users;\n  mapping (bytes32 => uint) usernameToIdMap;\n\n  function UserManager() {\n    users.length = 1;\n  }\n\n  function exists(string username) returns (bool) {\n    return usernameToIdMap[b32(username)] != 0;\n  }\n\n  function getUser(string username) returns (address) {\n    uint userId = usernameToIdMap[b32(username)];\n    return users[userId];\n  }\n\n  function createUser(address account, string username, bytes32 pwHash, UserRole role) returns (ErrorCodes) {\n    if (bytes(username).length > 32)\n      return ErrorCodes.ERROR;\n    if (exists(username))\n      return ErrorCodes.EXISTS;\n    uint userId = users.length;\n    usernameToIdMap[b32(username)] = userId;\n    users.push(new User(account, username, pwHash, userId, role));\n    return ErrorCodes.SUCCESS;\n  }\n\n  function login(string username, bytes32 pwHash) returns (bool) {\n    if (!exists(username))\n      return false;\n    address a = getUser(username);\n    User user = User(a);\n    return user.authenticate(pwHash);\n  }\n}";
    }
}contract Version {

    uint version;
    function __getContractName__() view returns (string) {
        return "Version";
    }
    function __getSource__() view public returns (string) {
        return "contract ErrorCodes {\n\n  enum ErrorCodes {\n    NULL,\n    SUCCESS,\n    ERROR,\n    NOT_FOUND,\n    EXISTS,\n    RECURSIVE,\n    INSUFFICIENT_BALANCE\n  }\n}\n\ncontract Version {\n  uint version;\n}\n\ncontract UserRole {\n\n    enum UserRole {\n        NULL,\n        ADMIN,\n        BUYER,\n        SUPPLIER\n    }\n}\n\ncontract User is ErrorCodes, Version, UserRole {\n  address public account = 0x1234;\n  string public username;\n  bytes32 public pwHash;\n  uint public id;\n  UserRole public role;\n\n  function User(address _account, string _username, bytes32 _pwHash, uint _id, UserRole _role) {\n    account = _account;\n    username = _username;\n    pwHash = _pwHash;\n    id = _id;\n    role = _role;\n    version = 1;\n  }\n\n  function authenticate(bytes32 _pwHash) returns (bool) {\n    return pwHash == _pwHash;\n  }\n}\n\ncontract Util {\n  function stringToBytes32(string memory source) returns (bytes32 result) {\n    assembly {\n    result := mload(add(source, 32))\n        }\n  }\n\n  function b32(string memory source) returns (bytes32) {\n    return stringToBytes32(source);\n  }\n}\n\ncontract UserManager is ErrorCodes, Util, UserRole {\n  User[] users;\n  mapping (bytes32 => uint) usernameToIdMap;\n\n  function UserManager() {\n    users.length = 1;\n  }\n\n  function exists(string username) returns (bool) {\n    return usernameToIdMap[b32(username)] != 0;\n  }\n\n  function getUser(string username) returns (address) {\n    uint userId = usernameToIdMap[b32(username)];\n    return users[userId];\n  }\n\n  function createUser(address account, string username, bytes32 pwHash, UserRole role) returns (ErrorCodes) {\n    if (bytes(username).length > 32)\n      return ErrorCodes.ERROR;\n    if (exists(username))\n      return ErrorCodes.EXISTS;\n    uint userId = users.length;\n    usernameToIdMap[b32(username)] = userId;\n    users.push(new User(account, username, pwHash, userId, role));\n    return ErrorCodes.SUCCESS;\n  }\n\n  function login(string username, bytes32 pwHash) returns (bool) {\n    if (!exists(username))\n      return false;\n    address a = getUser(username);\n    User user = User(a);\n    return user.authenticate(pwHash);\n  }\n}";
    }
}contract UserRole {

    enum UserRole {
      NULL,
      ADMIN,
      BUYER,
      SUPPLIER
    }
    function __getContractName__() view returns (string) {
        return "UserRole";
    }
    function __getSource__() view public returns (string) {
        return "contract ErrorCodes {\n\n  enum ErrorCodes {\n    NULL,\n    SUCCESS,\n    ERROR,\n    NOT_FOUND,\n    EXISTS,\n    RECURSIVE,\n    INSUFFICIENT_BALANCE\n  }\n}\n\ncontract Version {\n  uint version;\n}\n\ncontract UserRole {\n\n    enum UserRole {\n        NULL,\n        ADMIN,\n        BUYER,\n        SUPPLIER\n    }\n}\n\ncontract User is ErrorCodes, Version, UserRole {\n  address public account = 0x1234;\n  string public username;\n  bytes32 public pwHash;\n  uint public id;\n  UserRole public role;\n\n  function User(address _account, string _username, bytes32 _pwHash, uint _id, UserRole _role) {\n    account = _account;\n    username = _username;\n    pwHash = _pwHash;\n    id = _id;\n    role = _role;\n    version = 1;\n  }\n\n  function authenticate(bytes32 _pwHash) returns (bool) {\n    return pwHash == _pwHash;\n  }\n}\n\ncontract Util {\n  function stringToBytes32(string memory source) returns (bytes32 result) {\n    assembly {\n    result := mload(add(source, 32))\n        }\n  }\n\n  function b32(string memory source) returns (bytes32) {\n    return stringToBytes32(source);\n  }\n}\n\ncontract UserManager is ErrorCodes, Util, UserRole {\n  User[] users;\n  mapping (bytes32 => uint) usernameToIdMap;\n\n  function UserManager() {\n    users.length = 1;\n  }\n\n  function exists(string username) returns (bool) {\n    return usernameToIdMap[b32(username)] != 0;\n  }\n\n  function getUser(string username) returns (address) {\n    uint userId = usernameToIdMap[b32(username)];\n    return users[userId];\n  }\n\n  function createUser(address account, string username, bytes32 pwHash, UserRole role) returns (ErrorCodes) {\n    if (bytes(username).length > 32)\n      return ErrorCodes.ERROR;\n    if (exists(username))\n      return ErrorCodes.EXISTS;\n    uint userId = users.length;\n    usernameToIdMap[b32(username)] = userId;\n    users.push(new User(account, username, pwHash, userId, role));\n    return ErrorCodes.SUCCESS;\n  }\n\n  function login(string username, bytes32 pwHash) returns (bool) {\n    if (!exists(username))\n      return false;\n    address a = getUser(username);\n    User user = User(a);\n    return user.authenticate(pwHash);\n  }\n}";
    }
}contract User is ErrorCodes, Version, UserRole {

    address public account = 0x1234;
    string public username;
    bytes32 public pwHash;
    uint public id;
    UserRole public role;
    function User(address _account, string _username, bytes32 _pwHash, uint _id, UserRole _role) public {
        account = _account;
    username = _username;
    pwHash = _pwHash;
    id = _id;
    role = _role;
    version = 1;
  
    }
    function __getContractName__() view returns (string) {
        return "User";
    }
    function __getSource__() view public returns (string) {
        return "contract ErrorCodes {\n\n  enum ErrorCodes {\n    NULL,\n    SUCCESS,\n    ERROR,\n    NOT_FOUND,\n    EXISTS,\n    RECURSIVE,\n    INSUFFICIENT_BALANCE\n  }\n}\n\ncontract Version {\n  uint version;\n}\n\ncontract UserRole {\n\n    enum UserRole {\n        NULL,\n        ADMIN,\n        BUYER,\n        SUPPLIER\n    }\n}\n\ncontract User is ErrorCodes, Version, UserRole {\n  address public account = 0x1234;\n  string public username;\n  bytes32 public pwHash;\n  uint public id;\n  UserRole public role;\n\n  function User(address _account, string _username, bytes32 _pwHash, uint _id, UserRole _role) {\n    account = _account;\n    username = _username;\n    pwHash = _pwHash;\n    id = _id;\n    role = _role;\n    version = 1;\n  }\n\n  function authenticate(bytes32 _pwHash) returns (bool) {\n    return pwHash == _pwHash;\n  }\n}\n\ncontract Util {\n  function stringToBytes32(string memory source) returns (bytes32 result) {\n    assembly {\n    result := mload(add(source, 32))\n        }\n  }\n\n  function b32(string memory source) returns (bytes32) {\n    return stringToBytes32(source);\n  }\n}\n\ncontract UserManager is ErrorCodes, Util, UserRole {\n  User[] users;\n  mapping (bytes32 => uint) usernameToIdMap;\n\n  function UserManager() {\n    users.length = 1;\n  }\n\n  function exists(string username) returns (bool) {\n    return usernameToIdMap[b32(username)] != 0;\n  }\n\n  function getUser(string username) returns (address) {\n    uint userId = usernameToIdMap[b32(username)];\n    return users[userId];\n  }\n\n  function createUser(address account, string username, bytes32 pwHash, UserRole role) returns (ErrorCodes) {\n    if (bytes(username).length > 32)\n      return ErrorCodes.ERROR;\n    if (exists(username))\n      return ErrorCodes.EXISTS;\n    uint userId = users.length;\n    usernameToIdMap[b32(username)] = userId;\n    users.push(new User(account, username, pwHash, userId, role));\n    return ErrorCodes.SUCCESS;\n  }\n\n  function login(string username, bytes32 pwHash) returns (bool) {\n    if (!exists(username))\n      return false;\n    address a = getUser(username);\n    User user = User(a);\n    return user.authenticate(pwHash);\n  }\n}";
    }
    function authenticate(bytes32 _pwHash) public returns (bool) {
        return pwHash == _pwHash;
  
    }
}contract Util {

    function __getContractName__() view returns (string) {
        return "Util";
    }
    function __getSource__() view public returns (string) {
        return "contract ErrorCodes {\n\n  enum ErrorCodes {\n    NULL,\n    SUCCESS,\n    ERROR,\n    NOT_FOUND,\n    EXISTS,\n    RECURSIVE,\n    INSUFFICIENT_BALANCE\n  }\n}\n\ncontract Version {\n  uint version;\n}\n\ncontract UserRole {\n\n    enum UserRole {\n        NULL,\n        ADMIN,\n        BUYER,\n        SUPPLIER\n    }\n}\n\ncontract User is ErrorCodes, Version, UserRole {\n  address public account = 0x1234;\n  string public username;\n  bytes32 public pwHash;\n  uint public id;\n  UserRole public role;\n\n  function User(address _account, string _username, bytes32 _pwHash, uint _id, UserRole _role) {\n    account = _account;\n    username = _username;\n    pwHash = _pwHash;\n    id = _id;\n    role = _role;\n    version = 1;\n  }\n\n  function authenticate(bytes32 _pwHash) returns (bool) {\n    return pwHash == _pwHash;\n  }\n}\n\ncontract Util {\n  function stringToBytes32(string memory source) returns (bytes32 result) {\n    assembly {\n    result := mload(add(source, 32))\n        }\n  }\n\n  function b32(string memory source) returns (bytes32) {\n    return stringToBytes32(source);\n  }\n}\n\ncontract UserManager is ErrorCodes, Util, UserRole {\n  User[] users;\n  mapping (bytes32 => uint) usernameToIdMap;\n\n  function UserManager() {\n    users.length = 1;\n  }\n\n  function exists(string username) returns (bool) {\n    return usernameToIdMap[b32(username)] != 0;\n  }\n\n  function getUser(string username) returns (address) {\n    uint userId = usernameToIdMap[b32(username)];\n    return users[userId];\n  }\n\n  function createUser(address account, string username, bytes32 pwHash, UserRole role) returns (ErrorCodes) {\n    if (bytes(username).length > 32)\n      return ErrorCodes.ERROR;\n    if (exists(username))\n      return ErrorCodes.EXISTS;\n    uint userId = users.length;\n    usernameToIdMap[b32(username)] = userId;\n    users.push(new User(account, username, pwHash, userId, role));\n    return ErrorCodes.SUCCESS;\n  }\n\n  function login(string username, bytes32 pwHash) returns (bool) {\n    if (!exists(username))\n      return false;\n    address a = getUser(username);\n    User user = User(a);\n    return user.authenticate(pwHash);\n  }\n}";
    }
    function b32(string source) public returns (bytes32) {
        return stringToBytes32(source);
  
    }
    function stringToBytes32(string source) public returns (bytes32 result) {
        assembly {result := mload(add(source, 32))
        }
    }
}contract UserManager is ErrorCodes, Util, UserRole {

    User[] users;
    mapping (bytes32 => uint) usernameToIdMap;
    function UserManager() public {
        users.length = 1;
  
    }
    function __getContractName__() view returns (string) {
        return "UserManager";
    }
    function __getSource__() view public returns (string) {
        return "contract ErrorCodes {\n\n  enum ErrorCodes {\n    NULL,\n    SUCCESS,\n    ERROR,\n    NOT_FOUND,\n    EXISTS,\n    RECURSIVE,\n    INSUFFICIENT_BALANCE\n  }\n}\n\ncontract Version {\n  uint version;\n}\n\ncontract UserRole {\n\n    enum UserRole {\n        NULL,\n        ADMIN,\n        BUYER,\n        SUPPLIER\n    }\n}\n\ncontract User is ErrorCodes, Version, UserRole {\n  address public account = 0x1234;\n  string public username;\n  bytes32 public pwHash;\n  uint public id;\n  UserRole public role;\n\n  function User(address _account, string _username, bytes32 _pwHash, uint _id, UserRole _role) {\n    account = _account;\n    username = _username;\n    pwHash = _pwHash;\n    id = _id;\n    role = _role;\n    version = 1;\n  }\n\n  function authenticate(bytes32 _pwHash) returns (bool) {\n    return pwHash == _pwHash;\n  }\n}\n\ncontract Util {\n  function stringToBytes32(string memory source) returns (bytes32 result) {\n    assembly {\n    result := mload(add(source, 32))\n        }\n  }\n\n  function b32(string memory source) returns (bytes32) {\n    return stringToBytes32(source);\n  }\n}\n\ncontract UserManager is ErrorCodes, Util, UserRole {\n  User[] users;\n  mapping (bytes32 => uint) usernameToIdMap;\n\n  function UserManager() {\n    users.length = 1;\n  }\n\n  function exists(string username) returns (bool) {\n    return usernameToIdMap[b32(username)] != 0;\n  }\n\n  function getUser(string username) returns (address) {\n    uint userId = usernameToIdMap[b32(username)];\n    return users[userId];\n  }\n\n  function createUser(address account, string username, bytes32 pwHash, UserRole role) returns (ErrorCodes) {\n    if (bytes(username).length > 32)\n      return ErrorCodes.ERROR;\n    if (exists(username))\n      return ErrorCodes.EXISTS;\n    uint userId = users.length;\n    usernameToIdMap[b32(username)] = userId;\n    users.push(new User(account, username, pwHash, userId, role));\n    return ErrorCodes.SUCCESS;\n  }\n\n  function login(string username, bytes32 pwHash) returns (bool) {\n    if (!exists(username))\n      return false;\n    address a = getUser(username);\n    User user = User(a);\n    return user.authenticate(pwHash);\n  }\n}";
    }
    function createUser(address account, string username, bytes32 pwHash, UserRole role) public returns (ErrorCodes) {
        if (bytes(username).length > 32)
      return ErrorCodes.ERROR;
    if (exists(username))
      return ErrorCodes.EXISTS;
    uint userId = users.length;
    usernameToIdMap[b32(username)] = userId;
    users.push(new User(account, username, pwHash, userId, role));
    return ErrorCodes.SUCCESS;
  
    }
    function exists(string username) public returns (bool) {
        return usernameToIdMap[b32(username)] != 0;
  
    }
    function getUser(string username) public returns (address) {
        uint userId = usernameToIdMap[b32(username)];
    return users[userId];
  
    }
    function login(string username, bytes32 pwHash) public returns (bool) {
        if (!exists(username))
      return false;
    address a = getUser(username);
    User user = User(a);
    return user.authenticate(pwHash);
  
    }
}
