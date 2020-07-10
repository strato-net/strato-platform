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