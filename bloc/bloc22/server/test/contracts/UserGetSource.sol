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
    function __getSource__() constant returns (string) {
        return "contract ErrorCodes {\n\n  enum ErrorCodes {\n    NULL,\n    SUCCESS,\n    ERROR,\n    NOT_FOUND,\n    EXISTS,\n    RECURSIVE,\n    INSUFFICIENT_BALANCE\n  }\n}\n\ncontract Version {\n  uint version;\n}\n\ncontract UserRole {\n\n    enum UserRole {\n        NULL,\n        ADMIN,\n        BUYER,\n        SUPPLIER\n    }\n}\n\ncontract User is ErrorCodes, Version, UserRole {\n  address public account = 0x1234;\n  string public username;\n  bytes32 public pwHash;\n  uint public id;\n  UserRole public role;\n\n  function User(address _account, string _username, bytes32 _pwHash, uint _id, UserRole _role) {\n    account = _account;\n    username = _username;\n    pwHash = _pwHash;\n    id = _id;\n    role = _role;\n    version = 1;\n  }\n\n  function authenticate(bytes32 _pwHash) returns (bool) {\n    return pwHash == _pwHash;\n  }\n}";  
    }
}contract Version {

    uint version;
    function __getSource__() constant returns (string) {
        return "contract ErrorCodes {\n\n  enum ErrorCodes {\n    NULL,\n    SUCCESS,\n    ERROR,\n    NOT_FOUND,\n    EXISTS,\n    RECURSIVE,\n    INSUFFICIENT_BALANCE\n  }\n}\n\ncontract Version {\n  uint version;\n}\n\ncontract UserRole {\n\n    enum UserRole {\n        NULL,\n        ADMIN,\n        BUYER,\n        SUPPLIER\n    }\n}\n\ncontract User is ErrorCodes, Version, UserRole {\n  address public account = 0x1234;\n  string public username;\n  bytes32 public pwHash;\n  uint public id;\n  UserRole public role;\n\n  function User(address _account, string _username, bytes32 _pwHash, uint _id, UserRole _role) {\n    account = _account;\n    username = _username;\n    pwHash = _pwHash;\n    id = _id;\n    role = _role;\n    version = 1;\n  }\n\n  function authenticate(bytes32 _pwHash) returns (bool) {\n    return pwHash == _pwHash;\n  }\n}";  
    }
}contract UserRole {

    enum UserRole {
      NULL,
      ADMIN,
      BUYER,
      SUPPLIER
    }
    function __getSource__() constant returns (string) {
        return "contract ErrorCodes {\n\n  enum ErrorCodes {\n    NULL,\n    SUCCESS,\n    ERROR,\n    NOT_FOUND,\n    EXISTS,\n    RECURSIVE,\n    INSUFFICIENT_BALANCE\n  }\n}\n\ncontract Version {\n  uint version;\n}\n\ncontract UserRole {\n\n    enum UserRole {\n        NULL,\n        ADMIN,\n        BUYER,\n        SUPPLIER\n    }\n}\n\ncontract User is ErrorCodes, Version, UserRole {\n  address public account = 0x1234;\n  string public username;\n  bytes32 public pwHash;\n  uint public id;\n  UserRole public role;\n\n  function User(address _account, string _username, bytes32 _pwHash, uint _id, UserRole _role) {\n    account = _account;\n    username = _username;\n    pwHash = _pwHash;\n    id = _id;\n    role = _role;\n    version = 1;\n  }\n\n  function authenticate(bytes32 _pwHash) returns (bool) {\n    return pwHash == _pwHash;\n  }\n}";  
    }
}contract User is ErrorCodes, Version, UserRole {

    address public account;
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
    function __getSource__() constant returns (string) {
        return "contract ErrorCodes {\n\n  enum ErrorCodes {\n    NULL,\n    SUCCESS,\n    ERROR,\n    NOT_FOUND,\n    EXISTS,\n    RECURSIVE,\n    INSUFFICIENT_BALANCE\n  }\n}\n\ncontract Version {\n  uint version;\n}\n\ncontract UserRole {\n\n    enum UserRole {\n        NULL,\n        ADMIN,\n        BUYER,\n        SUPPLIER\n    }\n}\n\ncontract User is ErrorCodes, Version, UserRole {\n  address public account = 0x1234;\n  string public username;\n  bytes32 public pwHash;\n  uint public id;\n  UserRole public role;\n\n  function User(address _account, string _username, bytes32 _pwHash, uint _id, UserRole _role) {\n    account = _account;\n    username = _username;\n    pwHash = _pwHash;\n    id = _id;\n    role = _role;\n    version = 1;\n  }\n\n  function authenticate(bytes32 _pwHash) returns (bool) {\n    return pwHash == _pwHash;\n  }\n}";  
    }
    function authenticate(bytes32 _pwHash) returns (bool) {
        return pwHash == _pwHash;
  
    }
}