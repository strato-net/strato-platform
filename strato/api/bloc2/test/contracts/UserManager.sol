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