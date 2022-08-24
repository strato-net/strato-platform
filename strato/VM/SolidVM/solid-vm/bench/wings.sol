//import "../../../sol/rest/contracts/RestStatus.sol";
/*
 * @see: https://www.w3.org/Protocols/rfc2616/rfc2616-sec10.html
 * @see: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status
 */
contract RestStatus {
  uint constant OK = 200;
  uint constant CREATED = 201;
  uint constant ACCEPTED = 202;
  uint constant CLIENT_ERROR = 400; // 4xx
  uint constant BAD_REQUEST = 400;
  uint constant UNAUTHORIZED = 401;
  uint constant FORBIDDEN = 403;
  uint constant NOT_FOUND = 404;
  uint constant CONFLICT = 409;
  uint constant SERVER_ERROR = 500; // 5xx
  uint constant INTERNAL_SERVER_ERROR = 500;
  uint constant BAD_GATEWAY = 502;
  uint constant GATEWAY_TIMEOUT = 504;
}


//import "../../../sol/util/contracts/Validator.sol";
/**
 * Validator contract
 */
contract Validator {
  function isEmptyString(string _s) public returns (bool) {
    return  bytes(_s).length == 0;
  }

  function isEmptyAddress(address _a) public returns (bool) {
    return  _a == 0;
  }

  function isEmptyIntArray(uint[] _arr) public returns (bool) {
    return _arr.length == 0;
  }

  function isEmptyByteArray(bytes32[] _arr) public returns (bool) {
    return _arr.length == 0;
  }

  function isEmptyByte(bytes32 _bytes) public returns (bool) {
    return _bytes == 0;
  }

}


//import "../../../sol/util/contracts/Util.sol";
/**
 * Util contract
 */
contract Util {
  function stringToBytes32(string memory source) returns (bytes32 result) {
      assembly {
          result := mload(add(source, 32))
      }
  }

  function bytes32ToString(bytes32 x) constant returns (string) {
      bytes memory bytesString = new bytes(32);
      uint charCount = 0;
      for (charCount = 0; charCount < 32; charCount++) {
        byte char = byte((uint(x) >> (32 - charCount - 1) * 8) & 0xFF);
        if (char == 0) {
          break;
        }
        bytesString[charCount] = char;
      }
      bytes memory bytesStringTrimmed = new bytes(charCount);
      for (uint j = 0; j < charCount; j++) {
          bytesStringTrimmed[j] = bytesString[j];
      }
      return string(bytesStringTrimmed);
  }

  function b32(string memory source) returns (bytes32) {
    return stringToBytes32(source);
  }

  function i2b32(uint source) returns (bytes32) {
    return stringToBytes32(uintToString(source));
  }

  function a2b32(uint[] source) returns (bytes32[]) {
    uint256 len = source.length;
    bytes32[] memory result = new bytes32[](len);
    for (uint i = 0; i < source.length; i++) {
      result[i] = stringToBytes32(uintToString(source[i]));
    }
    return result;
  }

  function uintToString(uint v) constant returns (string str) {
    if (v ==0) return "0";

    uint maxlength = 100;
    bytes memory reversed = new bytes(maxlength);
    uint i = 0;
    while (v != 0) {
      uint remainder = v % 10;
      v = v / 10;
      reversed[i++] = byte(48 + remainder);
    }
    bytes memory s = new bytes(i);
    for (uint j = 0; j < i; j++) {
      s[j] = reversed[i - j - 1];
    }
    str = string(s);
  }

  function utfStringLength(string str) constant returns (uint characterCount) {
    uint i=0;
    bytes memory byteArray = bytes(str);

    while (i<byteArray.length)
    {
        if (byteArray[i]>>7==0)
            i+=1;
        else if (byteArray[i]>>5==0x6)
            i+=2;
        else if (byteArray[i]>>4==0xE)
            i+=3;
        else if (byteArray[i]>>3==0x1E)
            i+=4;
        else //For safety
            i+=1;

        characterCount++;
    }
  }
}


//import "../../permission/contracts/WingsPermissionManager.sol";
//import "../../../sol/auth/permission/contracts/PermissionManager.sol";
//import "../../../rest/contracts/RestStatus.sol";
// exists


/**
* Permission Manager for all
*/
contract PermissionManager is RestStatus {
  // master account
  address master;
  // owner account
  address owner;

  // addresses and their permissions
  struct Permit {
    string id;
    address adrs;
    uint permissions;
  }
  Permit[] permits;

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
    uint result;
  }

  // event log type
  enum EventLogType { // TODO expose -LS
    NULL,
    GRANT,
    REVOKE,
    CHECK
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

  function transferOwnership(address _newOwner) public returns (uint) {
    // only the master can transfer ownership
    if (msg.sender != master) {
      return (RestStatus.UNAUTHORIZED);
    }

    owner = _newOwner;
    return (RestStatus.OK);
  }

  function exists(address _address) public returns (bool) {
    return addressToIndexMap[_address] != 0;
  }

  function getPermissions(address _address) public constant returns (uint, uint) {
    // error if address doesnt exists
    if (!exists(_address)) {
      return (RestStatus.NOT_FOUND, 0);
    }
    // got permissions
    uint index = addressToIndexMap[_address];
    return (RestStatus.OK, permits[index].permissions);
  }


  function _grant(string _id, address _address, uint _permissions) private returns (uint, uint) {
    // authorize owner
    if (msg.sender != owner) {
      return (RestStatus.UNAUTHORIZED, 0);
    }
    uint index;
    Permit memory permit;
    // exists ?
    if (!exists(_address)) {
      // if new - add permit with initial permissions
      index = permits.length;
      addressToIndexMap[_address] = index;
      permit = Permit(_id, _address, _permissions);
      permits.push(permit);
    } else {
      // if exists - update
      index = addressToIndexMap[_address];
      permit = permits[index];
      permit.permissions |= _permissions;
      permits[index] = permit;
    }
    return (RestStatus.OK, permit.permissions);
  }

  function grant(string _id, address _address, uint _permissions) public returns (uint, uint) {
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

  function _revoke(address _address) private returns (uint) {
    // authorize owner
    if (msg.sender != owner) {
      return (RestStatus.UNAUTHORIZED);
    }
    // error if address doesnt exists
    if (!exists(_address)) {
      return (RestStatus.BAD_REQUEST);
    }
    // revoke
    uint index = addressToIndexMap[_address];
    Permit permit = permits[index];
    permit.permissions = 0;
    permits[index] = permit;
    return (RestStatus.OK);
  }

  function revoke(address _address) public returns (uint) {
    // call revoke
    uint result = _revoke(_address);
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

  function _check(address _address, uint _permissions) private constant returns (uint) {
    // error if address doesnt exists
    if (!exists(_address)) {
      return (RestStatus.NOT_FOUND);
    }
    // check
    uint index = addressToIndexMap[_address];
    Permit permit = permits[index];
    if (permit.permissions & _permissions != _permissions) {
      return (RestStatus.UNAUTHORIZED);
    }
    return (RestStatus.OK);
  }

  function check(address _address, uint _permissions) public constant returns (uint) {
    // call check
    uint result = _check(_address, _permissions);
    // log the result
    if (result != RestStatus.OK) {
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


//import "./WingsPermission.sol";
/* pragma solidity ^0.4.8; */
contract WingsPermission {
  enum WingsPermission {
    TRANSFER_OWNERSHIP_MAP,
    MANAGE_MANAGERS,
    ADD_TAX_CODE,
    REMOVE_TAX_CODE,
    CREATE_TRANSACTION,
    CREATE_TICKET,
    UPDATE_TICKET,
    CREATE_USER,
    MANAGE_PERMISSIONS,
    UPDATE_MANAGERS
  }
}


//import "./EventPermission.sol";
/* pragma solidity ^0.4.8; */
contract EventPermission {
  enum EventPermission {
    PROCESS_DATA,
    AUTHORIZE,
    NULLIFY,
    SETTLE,
    REQUEST_REFUND,
    AUTHORIZE_REFUND,
    SETTLE_REFUND
  }
}


//import "./WingsRolePermissions.sol";
//import "./WingsRole.sol";
contract WingsRole {
  enum WingsRole {
    NULL,
    ADMIN,
    MASTER,
    AIRLINE,
    AGENCY,
    ARC
  }
}


//import "./WingsPermission.sol";
// exists

//import "./EventPermission.sol";
// exists

contract WingsRolePermissions  is WingsRole, WingsPermission, EventPermission {
  uint[] rolePermissions;
  constructor() {
    rolePermissions.length = uint(WingsRole.ARC)+1;
    rolePermissions[uint(WingsRole.NULL)] = 0;
    rolePermissions[uint(WingsRole.ADMIN)] =
      (1 << uint(WingsPermission.TRANSFER_OWNERSHIP_MAP)) |
      (1 << uint(WingsPermission.MANAGE_MANAGERS)) |
      (1 << uint(WingsPermission.ADD_TAX_CODE)) |
      (1 << uint(WingsPermission.REMOVE_TAX_CODE)) |
      (1 << uint(WingsPermission.CREATE_TICKET)) |
      (1 << uint(WingsPermission.UPDATE_TICKET)) |
      (1 << uint(WingsPermission.CREATE_USER)) |
      (1 << uint(WingsPermission.MANAGE_PERMISSIONS)) |
      (1 << uint(WingsPermission.UPDATE_MANAGERS)) |
      (1 << uint(EventPermission.PROCESS_DATA)) |
      (1 << uint(EventPermission.AUTHORIZE)) |
      (1 << uint(EventPermission.NULLIFY)) |
      (1 << uint(EventPermission.SETTLE)) |
      (1 << uint(EventPermission.REQUEST_REFUND)) |
      (1 << uint(EventPermission.AUTHORIZE_REFUND)) |
      (1 << uint(EventPermission.SETTLE_REFUND)) ;
    rolePermissions[uint(WingsRole.MASTER)] =
      (1 << uint(WingsPermission.TRANSFER_OWNERSHIP_MAP)) |
      (1 << uint(WingsPermission.MANAGE_MANAGERS)) |
      (1 << uint(WingsPermission.ADD_TAX_CODE)) |
      (1 << uint(WingsPermission.REMOVE_TAX_CODE)) |
      (1 << uint(WingsPermission.CREATE_TICKET)) |
      (1 << uint(WingsPermission.UPDATE_TICKET)) |
      (1 << uint(WingsPermission.CREATE_USER)) |
      (1 << uint(WingsPermission.MANAGE_PERMISSIONS)) |
      (1 << uint(WingsPermission.UPDATE_MANAGERS)) |
      (1 << uint(WingsPermission.CREATE_TRANSACTION)) |
      (1 << uint(EventPermission.PROCESS_DATA)) |
      (1 << uint(EventPermission.AUTHORIZE)) |
      (1 << uint(EventPermission.NULLIFY)) |
      (1 << uint(EventPermission.SETTLE)) |
      (1 << uint(EventPermission.REQUEST_REFUND)) |
      (1 << uint(EventPermission.AUTHORIZE_REFUND)) |
      (1 << uint(EventPermission.SETTLE_REFUND)) ;
    rolePermissions[uint(WingsRole.AIRLINE)] =
      (1 << uint(WingsPermission.CREATE_TICKET)) |
      (1 << uint(WingsPermission.CREATE_TRANSACTION)) |
      (1 << uint(WingsPermission.UPDATE_TICKET)) |
      (1 << uint(EventPermission.AUTHORIZE)) |
      (1 << uint(EventPermission.NULLIFY)) |
      (1 << uint(EventPermission.AUTHORIZE_REFUND)) ;
    rolePermissions[uint(WingsRole.AGENCY)] =
      (1 << uint(WingsPermission.CREATE_TICKET)) |
      (1 << uint(WingsPermission.CREATE_TRANSACTION)) |
      (1 << uint(WingsPermission.UPDATE_TICKET)) |
      (1 << uint(EventPermission.AUTHORIZE)) |
      (1 << uint(EventPermission.NULLIFY)) |
      (1 << uint(EventPermission.REQUEST_REFUND)) ;
    rolePermissions[uint(WingsRole.ARC)] =
      (1 << uint(WingsPermission.CREATE_TICKET)) |
      (1 << uint(WingsPermission.CREATE_TRANSACTION)) |
      (1 << uint(WingsPermission.UPDATE_TICKET)) |
      (1 << uint(EventPermission.PROCESS_DATA)) |
      (1 << uint(EventPermission.SETTLE)) |
      (1 << uint(EventPermission.SETTLE_REFUND)) ;
  }
  function getRolePermissions(WingsRole _role) returns (uint) {
    return rolePermissions[uint(_role)];
  }
}


/**
* Wings Permission Manager
*/
contract WingsPermissionManager is PermissionManager, WingsPermission, EventPermission, WingsRolePermissions {
  constructor(
    address _admin,
    address _master) public
    PermissionManager(_admin, _master) {
    // grant Wings Admin permissions to admin
    grantRole('Admin', _admin, WingsRole.ADMIN);
    grantRole('Master', _master, WingsRole.ADMIN);
  }
  function grantRole(string _id, address _address, WingsRole _role) public returns (uint, uint) {
    uint permissions = getRolePermissions(_role);
    return grant(_id, _address, permissions);
  }
  function canTransferOwnershipMap(address _address) returns (bool) {
    uint permissions = 1 << uint(WingsPermission.TRANSFER_OWNERSHIP_MAP);
    return check(_address, permissions) == RestStatus.OK;
  }
  function canManageManagers(address _address) returns (bool) {
    uint permissions = 1 << uint(WingsPermission.MANAGE_MANAGERS);
    return check(_address, permissions) == RestStatus.OK;
  }
  function canAddTaxCode(address _address) returns (bool) {
    uint permissions = 1 << uint(WingsPermission.ADD_TAX_CODE);
    return check(_address, permissions) == RestStatus.OK;
  }
  function canRemoveTaxCode(address _address) returns (bool) {
    uint permissions = 1 << uint(WingsPermission.REMOVE_TAX_CODE);
    return check(_address, permissions) == RestStatus.OK;
  }
  function canCreateTicket(address _address) returns (bool) {
    uint permissions = 1 << uint(WingsPermission.CREATE_TICKET);
    return check(_address, permissions) == RestStatus.OK;
  }
  function canCreateTransaction(address _address) returns (bool) {
    uint permissions = 1 << uint(WingsPermission.CREATE_TRANSACTION);
    return check(_address, permissions) == RestStatus.OK;
  }
  function canUpdateTicket(address _address) returns (bool) {
    uint permissions = 1 << uint(WingsPermission.UPDATE_TICKET);
    return check(_address, permissions) == RestStatus.OK;
  }
  function canCreateUser(address _address) returns (bool) {
    uint permissions = 1 << uint(WingsPermission.CREATE_USER);
    return check(_address, permissions) == RestStatus.OK;
  }
  function canManagePermissions(address _address) returns (bool) {
    uint permissions = 1 << uint(WingsPermission.MANAGE_PERMISSIONS);
    return check(_address, permissions) == RestStatus.OK;
  }
  function canUpdateManagers(address _address) returns (bool) {
    uint permissions = 1 << uint(WingsPermission.UPDATE_MANAGERS);
    return check(_address, permissions) == RestStatus.OK;
  }
  function canProcessData(address _address) returns (bool) {
    uint permissions = 1 << uint(EventPermission.PROCESS_DATA);
    return check(_address, permissions) == RestStatus.OK;
  }
  function canAuthorize(address _address) returns (bool) {
    uint permissions = 1 << uint(EventPermission.AUTHORIZE);
    return check(_address, permissions) == RestStatus.OK;
  }
  function canVoid(address _address) returns (bool) {
    uint permissions = 1 << uint(EventPermission.NULLIFY);
    return check(_address, permissions) == RestStatus.OK;
  }
  function canSettle(address _address) returns (bool) {
    uint permissions = 1 << uint(EventPermission.SETTLE);
    return check(_address, permissions) == RestStatus.OK;
  }
  function canRequestRefund(address _address) returns (bool) {
    uint permissions = 1 << uint(EventPermission.REQUEST_REFUND);
    return check(_address, permissions) == RestStatus.OK;
  }
  function canAuthorizeRefund(address _address) returns (bool) {
    uint permissions = 1 << uint(EventPermission.AUTHORIZE_REFUND);
    return check(_address, permissions) == RestStatus.OK;
  }
  function canSettleRefund(address _address) returns (bool) {
    uint permissions = 1 << uint(EventPermission.SETTLE_REFUND);
    return check(_address, permissions) == RestStatus.OK;
  }
}


//import "../../ticket/contracts/TicketManager.sol";
//import "../../../sol/collections/hashmap/contracts/Hashmap.sol";
//import "./UnsafeHashmap.sol";
//import "../../../util/contracts/Util.sol";
// exists


contract UnsafeHashmap is Util {

  address[] public values;
  string[] public keys;
  bool public isIterable; // save the keys
  /*
    note on mapping to array index:
    a non existing mapping will return 0, so 0 should not be a valid value in a map,
    otherwise exists() will not work
  */
  mapping (bytes32 => uint) keyMap;

  function UnsafeHashmap() {
    values.length = 1; // see above note
    keys.length = 1; // see above note
    isIterable = false; // not saving keys, to conserve space
  }

  function put(string _key, address _value) public {
    // save the value
    keyMap[b32(_key)] = values.length;
    values.push(_value);
    // save the key if isIterable
    if (isIterable) {
      keys.push(_key);
    }
  }

  function get(string _key) public constant returns (address) {
    uint index = keyMap[b32(_key)];
    return values[index];
  }

  function contains(string _key) public constant returns (bool) {
    uint index = keyMap[b32(_key)];
    return values[index] != 0;
  }

  function size() public constant returns (uint) {
    return values.length -1; // not counting entry 0
  }

  function remove(string _key) public {
    uint index = keyMap[b32(_key)];
    if (index == 0) return;
    // remove the index mapping
    keyMap[b32(_key)] = 0;
    // remove the value
    values[index] = 0;
    // remove the key
    if (isIterable) {
      delete keys[index];
    }
  }
}



/**
 * The Hashmap contract maintains a permissioned implementation
 * of an UnsafeHashmap. All function calls are restricted to the
 * owner of the contract.
 */
contract Hashmap is UnsafeHashmap {
  address public owner;

  function Hashmap() {
    owner = msg.sender;
  }

  function put(string _key, address _value) public {
    if (msg.sender != owner) {
      return;
    }

    return super.put(_key, _value);
  }

  /**
   * @dev        If owner or manager contract is calling function, it will get the value at a key
   *
   * @param      _key    The key
   *
   * @return     returns the address of the contract value
   */
  function get(string _key) public constant returns (address) {
    if (msg.sender != owner) {
      return address(0);
    }

    return super.get(_key);
  }

  /**
   * @dev        If owner or manager contract is calling function, it will check existence of a key/value
   *
   * @param      _key    The key
   *
   * @return     returns a boolean of containment
   */
  function contains(string _key) public constant returns (bool) {
    if (msg.sender != owner) {
      return false;
    }

    return super.contains(_key);    
  }

  /**
   * @dev        If owner or manager contract is calling function, it will return the size of hashmap
   *
   * @return     returns size of hashmap
   */
  function size() public constant returns (uint) {
    if (msg.sender != owner) {
      return 0;
    }

    return super.size();
  }

  /**
   * @dev        Allows the current owner to transfer control of the contract to a newOwner.
   *
   * @param      _newOwner   The address to transfer ownership to.
   *
   * @return     returns status of ownership transfer
   */
  function transferOwnership(address _newOwner) public returns (bool) {
    if (msg.sender != owner) {
      return false;
    }

    owner = _newOwner;
    return true;
  }

  function getOwner() public constant returns (address) {
    return owner;
  }
}


//import "../../../sol/rest/contracts/RestStatus.sol";
// exists

/* import "../../../sol/util/contracts/Validator.sol"; */
//import "../../../sol/util/contracts/Util.sol";
// exists

//import "../../../sol/validation/contracts/ValidationEngine.sol";
//import "./ValidationRuleInterface.sol";
contract ValidationRuleInterface {

  function apply(address contractAddress) public returns (bool, uint, bytes32);

}


//import "./ValidationStatus.sol";
contract ValidationStatus {
  uint constant VALIDATION_PASSED = 200;
  uint constant PROFILE_INVALID   = 201;
}


//import "../../rest/contracts/RestStatus.sol";
// exists


contract ValidationEngine is RestStatus, ValidationStatus {

  mapping (bytes32 => bytes32[]) ruleNames;
  mapping (bytes32 => mapping(bytes32 => mapping(bool => ValidationRuleInterface))) public ruleSets;

  function addRule(bytes32 profileName, bytes32 ruleName, ValidationRuleInterface ruleContractAddress) public {
    ruleSets[profileName][ruleName][true] = ruleContractAddress;

    bytes32[] names = ruleNames[profileName];
    names.push(ruleName);
    ruleNames[profileName] = names;
  }

  function deactivateRule(bytes32 profileName, bytes32 ruleName) public {
    ruleSets[profileName][ruleName][false] = ruleSets[profileName][ruleName][true];
    ruleSets[profileName][ruleName][true]  = ValidationRuleInterface(0);
  }

  function activateRule(bytes32 profileName, bytes32 ruleName) public {
    ruleSets[profileName][ruleName][true]  = ruleSets[profileName][ruleName][false];
    ruleSets[profileName][ruleName][false] = ValidationRuleInterface(0);
  }

  function validate(address contractAddress, bytes32 profileName) public returns (uint, uint, bool, bytes32) {
    bytes32[] names = ruleNames[profileName];
    if(names.length == 0) {
      return (RestStatus.NOT_FOUND, ValidationStatus.PROFILE_INVALID, false, "Profile Not Found");
    }
    for(uint i = 0; i < names.length; i++) {
      address temp = ruleSets[profileName][names[i]][true];
      if (temp == 0x0) {
        continue;
      }
      ValidationRuleInterface rule = ValidationRuleInterface(temp);
      var (isValid, status, message) = rule.apply(contractAddress);
      if (!isValid) {
        return (RestStatus.OK, status, false, message);
      }
    }
    return (RestStatus.OK, ValidationStatus.VALIDATION_PASSED, true, "Validations Passed");
  }
}


//import "../../permission/contracts/WingsPermissionManager.sol";
// exists

//import "../validation/CommAmtBaseFareCapValidation.sol";
//import "../../../sol/validation/contracts/ValidationRuleInterface.sol";
// exists

//import "../../../sol/util/contracts/Util.sol";
// exists

//import "./TicketValidationStatus.sol";
//import "../../../sol/validation/contracts/ValidationStatus.sol";
// exists


contract TicketValidationStatus is ValidationStatus {
  uint constant COMM_AMT_GRT_BASE_FARE     = 2001;
  uint constant COMM_AMT_GRT_EQ_FARE       = 2002;
  uint constant COMM_AMT_GRT_50            = 2003;
  uint constant COMM_AMT_GRT_10K           = 2004;
  uint constant COMM_RATE_MAX_CAP_EXCEEDED = 2005;
  uint constant COMM_RATE_AND_AMT_0        = 2006;
  uint constant COMM_RATE_AND_AMT_NZ       = 2007;
  uint constant COMM_RATE_AND_AMT_INVALID  = 2008;
  uint constant COMM_RATE_INCR_BY_HALF     = 2009;
  uint constant COMM_RATE_INCR_BY_ONE      = 2010;

  uint constant TAX_CODE_NOT_FOUND         = 1001;
  uint constant TAX_VALUE_0                = 1002;
}





contract CommAmtBaseFareCapValidation is ValidationRuleInterface, TicketValidationStatus, Util {

  function apply(address _contractAddress) public returns (bool, uint, bytes32) {
    Ticket ticket = Ticket(_contractAddress);
    if (ticket.fare() > 0 && ticket.coam() > ticket.fare()) {
        return (false, TicketValidationStatus.COMM_AMT_GRT_BASE_FARE, Util.b32("Comm Amt > Base Fare"));
    }
    return (true, VALIDATION_PASSED, Util.b32("Comm Amt Base Fare Cap Validation Passed"));
  }
}


//import "../validation/CommAmtEqFareCapValidation.sol";
//import "../../../sol/validation/contracts/ValidationRuleInterface.sol";
// exists

//import "../../../sol/util/contracts/Util.sol";
// exists

//import "./TicketValidationStatus.sol";
// exists




contract CommAmtEqFareCapValidation is ValidationRuleInterface, TicketValidationStatus, Util {

  function apply(address _contractAddress) public returns (bool, uint, bytes32) {
    Ticket ticket = Ticket(_contractAddress);
    if (ticket.eqfr() > 0 && ticket.coam() > ticket.eqfr()) {
        return (false, TicketValidationStatus.COMM_AMT_GRT_EQ_FARE, Util.b32("Comm Amt > Equivalent Fare"));
    }
    return (true, VALIDATION_PASSED, Util.b32("Comm Amt Eq Fare Cap Validation Passed"));
  }
}


//import "../validation/CommAmtMaxCapValidation.sol";
//import "../../../sol/validation/contracts/ValidationRuleInterface.sol";
// exists

//import "../../../sol/util/contracts/Util.sol";
// exists

//import "./TicketValidationStatus.sol";
// exists




contract CommAmtMaxCapValidation is ValidationRuleInterface, TicketValidationStatus, Util {

  function apply(address _contractAddress) public returns (bool, uint, bytes32) {
    Ticket ticket = Ticket(_contractAddress);
    bool isValid = ticket.fare() == 0 ? ticket.coam() < 5000 : ticket.coam() <= 999999;
    if (isValid) {
      return (true, VALIDATION_PASSED, Util.b32("Comm Max Cap Validation Passed"));
    }
    else if (ticket.fare() == 0) {
      return (false, TicketValidationStatus.COMM_AMT_GRT_50, Util.b32("Comm Amt must be < $50.00"));
    }
    else {
      return (false, TicketValidationStatus.COMM_AMT_GRT_10K, Util.b32("Comm Amt must be < $9,999.99"));
    }
  }
}


//import "../validation/CommRateMaxCapValidation.sol";
//import "../../../sol/validation/contracts/ValidationRuleInterface.sol";
// exists

//import "../../../sol/util/contracts/Util.sol";
// exists

//import "./TicketValidationStatus.sol";
// exists




contract CommRateMaxCapValidation is ValidationRuleInterface, TicketValidationStatus, Util {

  function apply(address _contractAddress) public returns (bool, uint, bytes32) {
    Ticket ticket = Ticket(_contractAddress);
    bool isValid = ticket.cort() <= 4000;
    if (isValid) {
      return (true, VALIDATION_PASSED, Util.b32("Comm Max Cap Validation Passed"));
    } else {
      return (false, TicketValidationStatus.COMM_RATE_MAX_CAP_EXCEEDED, Util.b32("Comm Max Cap Exceeded"));
    }
  }
}


//import "../validation/CommRateOrAmtValidation.sol";
//import "../../../sol/validation/contracts/ValidationRuleInterface.sol";
// exists

//import "../../../sol/util/contracts/Util.sol";
// exists

//import "./TicketValidationStatus.sol";
// exists




contract CommRateOrAmtValidation is ValidationRuleInterface, TicketValidationStatus, Util {

  function apply(address _contractAddress) public returns (bool, uint, bytes32) {
    Ticket ticket = Ticket(_contractAddress);
    bool isValid = (ticket.coam() == 0 && ticket.cort() > 0) || (ticket.coam() > 0 && ticket.cort() == 0);
    if (isValid) {
      return (true, VALIDATION_PASSED, Util.b32("Comm Rate or Amt Validation Passed"));
    }
    else if (ticket.coam() == 0 && ticket.cort() == 0) {
      return (false, TicketValidationStatus.COMM_RATE_AND_AMT_0, Util.b32("Both Comm Rate and Amt = Zero"));
    }
    else if (ticket.coam() > 0 && ticket.cort() > 0) {
      return (false, TicketValidationStatus.COMM_RATE_AND_AMT_NZ, Util.b32("Both Comm Rate and Amt > Zero"));
    }
    return (false, TicketValidationStatus.COMM_RATE_AND_AMT_INVALID, Util.b32("Invalid Commission Rate or Amount Sent"));
  }
}


//import "../validation/CommRateValidation.sol";
//import "../../../sol/validation/contracts/ValidationRuleInterface.sol";
// exists

//import "../../../sol/util/contracts/Util.sol";
// exists

//import "./TicketValidationStatus.sol";
// exists




contract CommRateValidation is ValidationRuleInterface, TicketValidationStatus, Util {

  function apply(address _contractAddress) public returns (bool, uint, bytes32) {
    Ticket ticket = Ticket(_contractAddress);
    if (ticket.cort() == 0) {
      return (true, VALIDATION_PASSED, Util.b32("Commission Rate Validation Passed"));
    }
    if (ticket.cort() < 2100) {
      if (ticket.cort() % 50 == 0) {
        return (true, VALIDATION_PASSED, Util.b32("Commission Rate Validation Passed"));
      }
      else {
        return (false, TicketValidationStatus.COMM_RATE_INCR_BY_HALF, Util.b32("Comm Rate should increment by .5%"));
      }
    }
    if (ticket.cort() < 4100) {
      if (ticket.cort() % 100 == 0) {
        return (true, VALIDATION_PASSED, Util.b32("Commission Rate Validation Passed"));
      }
      else {
        return (false, TicketValidationStatus.COMM_RATE_INCR_BY_ONE, Util.b32("Comm Rate should increment by 1%"));
      }
    }
    return (false, TicketValidationStatus.COMM_RATE_MAX_CAP_EXCEEDED, Util.b32("Commission Rate must be <= 40%"));
  }
}


//import "../validation/TaxCodeValidation.sol";
//import "../../../sol/validation/contracts/ValidationRuleInterface.sol";
// exists

//import "../../../sol/util/contracts/Util.sol";
// exists

//import "../../taxCode/contracts/TaxCodeManager.sol";
//import "../../../sol/rest/contracts/RestStatus.sol";
// exists

//import "../../../sol/util/contracts/Validator.sol";
// exists

//import "../../permission/contracts/WingsPermissionManager.sol";
// exists


contract TaxCodeManager is RestStatus, Validator {
  WingsPermissionManager wingsPermissionManager;
  mapping (bytes32 => bool) public taxCodes;

  function TaxCodeManager(address _wingsPermissionManager) {
    wingsPermissionManager = WingsPermissionManager(_wingsPermissionManager);
  }

  function addTaxCode(bytes32 _taxCode) public returns (uint) {
    if (!wingsPermissionManager.canAddTaxCode(msg.sender)) { return RestStatus.UNAUTHORIZED; }
    if (Validator.isEmptyByte(_taxCode))                   { return RestStatus.BAD_REQUEST;  }
    taxCodes[_taxCode] = true;
    return RestStatus.OK;
  }

  function removeTaxCode(bytes32 _taxCode) public returns (uint) {
    if (!wingsPermissionManager.canRemoveTaxCode(msg.sender)) { return RestStatus.UNAUTHORIZED; }
    if (Validator.isEmptyByte(_taxCode))                      { return RestStatus.BAD_REQUEST;  }
    taxCodes[_taxCode] = false;
    return RestStatus.OK;
  }

  function isValidTaxCode(bytes32 _taxCode) public returns (bool) {
    return taxCodes[_taxCode];
  }
}


//import "./TicketValidationStatus.sol";
// exists



contract TaxCodeValidation is ValidationRuleInterface, TicketValidationStatus, Util {

  address private taxCodeManagerAddress;

  function TaxCodeValidation(address _taxCodeManagerAddress) {
    taxCodeManagerAddress = _taxCodeManagerAddress;
  }

  function apply(address _contractAddress) public returns (bool, uint, bytes32) {
    Ticket ticket = Ticket(_contractAddress);
    TaxCodeManager taxCodeManager = TaxCodeManager(taxCodeManagerAddress);
    // for (uint i = 0; i < ticket.getTaxLength(); i++) {
    // bool result = taxCodeManager.isValidTaxCode(ticket.getTmft(i));
    //  if (!result) {
    //    return (false, TicketValidationStatus.TAX_CODE_NOT_FOUND, Util.b32("TaxCode not found"));
    //  }
    // }
    return (true, VALIDATION_PASSED, Util.b32("Validation Passed"));
  }
}


//import "../validation/TaxValueValidation.sol";
//import "../../../sol/validation/contracts/ValidationRuleInterface.sol";
// exists

//import "../../../sol/util/contracts/Util.sol";
// exists

//import "./TicketValidationStatus.sol";
// exists



contract TaxValueValidation is ValidationRuleInterface, TicketValidationStatus, Util {

  function apply(address _contractAddress) public returns (bool, uint, bytes32) {
    Ticket ticket = Ticket(_contractAddress);
    for (uint i = 0; i < ticket.getTaxLength(); i++) {
      if (ticket.getTmfa(i) == 0) {
        return (false,
            TicketValidationStatus.TAX_VALUE_0,
            Util.b32("Tax should be > 0"));
      }
    }
    return (true, VALIDATION_PASSED, Util.b32("Tax Value Validation Passed"));
  }
}


//import "./TicketEvent.sol";
// copied from https://github.com/blockapps/EChO/blob/develop/server/dapp/deal/gas/contracts/GasDealEvent.sol

contract TicketEvent {
    enum TicketEvent {
        NULL,
        RECEIVE,
        VALIDATION_PASS,
        VALIDATION_FAIL,
        DATA_UPDATE,
        DATA_PROCESS,
        AGENCY_AUTHORIZE,
        AGENCY_NULLIFY,
        SETTLE,
        AGENCY_REFUND_REQUEST,
        AIRLINE_AUTHORIZE,
        REFUND_SETTLE
    }
}


//import "./Ticket.sol";
//import "./TicketFSM.sol";
// copied from https://github.com/blockapps/EChO/blob/develop/server/dapp/deal/gas/contracts/GasDealFSM.sol
//import "../../../sol/fsm/contracts/FSM.sol";

contract FSM {

    struct Transition {
        uint state;
        uint evt;
        uint newState;
    }

    // expose the transitions to the outside world
    Transition[] public transitions;

    mapping (uint => uint) stateMachine;

    function FSM(){
    }


    function handleEvent(uint _state, uint _event) returns (uint){
        return stateMachine[calculateKey(_state,_event)];
    }


    function addTransition(uint _state, uint _event, uint _newState) {
        stateMachine[calculateKey(_state, _event)] = _newState;
        transitions.push(Transition(_state, _event, _newState));
    }


    function calculateKey(uint _state, uint _event) returns (uint){
        return (_state * 1000) + _event;
    }
}


//import "./TicketState.sol";
// copied from https://github.com/blockapps/EChO/blob/develop/server/dapp/deal/gas/contracts/GasDealEvent.sol

contract TicketState {
    enum TicketState {
        NULL,
        RECEIVED,
        RECEIVED_NO_ERROR,
        RECEIVED_HAS_ERROR,
        MODIFIED,
        MODIFIED_NO_ERROR,
        MODIFIED_HAS_ERROR,
        PROCESSED,
        AUTHORIZED,
        VOID,
        SETTLED,
        REFUND_REQUESTED,
        REFUND_AUTHORIZED,
        REFUNDED
    }
}


//import "./TicketEvent.sol";
// exists


contract TicketFSM is FSM, TicketState, TicketEvent {
  function TicketFSM() {
    // receive ticket
    addTransition(TicketState.NULL, TicketEvent.RECEIVE, TicketState.RECEIVED);

    // pass validation ticket
    addTransition(TicketState.RECEIVED, TicketEvent.VALIDATION_PASS, TicketState.RECEIVED_NO_ERROR);
    // fail validation ticket
    addTransition(TicketState.RECEIVED, TicketEvent.VALIDATION_FAIL, TicketState.RECEIVED_HAS_ERROR);

    // modify new ticket
    addTransition(TicketState.RECEIVED, TicketEvent.DATA_UPDATE, TicketState.MODIFIED);
    // modify no-error ticket
    addTransition(TicketState.RECEIVED_NO_ERROR, TicketEvent.DATA_UPDATE, TicketState.MODIFIED);
    // modify error ticket
    addTransition(TicketState.RECEIVED_HAS_ERROR, TicketEvent.DATA_UPDATE, TicketState.MODIFIED);
    // modify modified ticket
    addTransition(TicketState.MODIFIED, TicketEvent.DATA_UPDATE, TicketState.MODIFIED);

    // pass validation modified ticket
    addTransition(TicketState.MODIFIED, TicketEvent.VALIDATION_PASS, TicketState.MODIFIED_NO_ERROR);
    // fail validation modified ticket
    addTransition(TicketState.MODIFIED, TicketEvent.VALIDATION_FAIL, TicketState.MODIFIED_HAS_ERROR);

    // modify no-error ticket
    addTransition(TicketState.MODIFIED_NO_ERROR, TicketEvent.DATA_UPDATE, TicketState.MODIFIED);
    // modify error ticket
    addTransition(TicketState.MODIFIED_HAS_ERROR, TicketEvent.DATA_UPDATE, TicketState.MODIFIED);

    // process ticket
    addTransition(TicketState.RECEIVED_NO_ERROR, TicketEvent.DATA_PROCESS, TicketState.PROCESSED);
    addTransition(TicketState.MODIFIED_NO_ERROR, TicketEvent.DATA_PROCESS, TicketState.PROCESSED);

    // nullify ticket
    // nullify can happen from any ticket state except from AUTHORIZED or SETTLED
    addTransition(TicketState.NULL, TicketEvent.AGENCY_NULLIFY, TicketState.VOID);
    addTransition(TicketState.RECEIVED, TicketEvent.AGENCY_NULLIFY, TicketState.VOID);
    addTransition(TicketState.RECEIVED_NO_ERROR, TicketEvent.AGENCY_NULLIFY, TicketState.VOID);
    addTransition(TicketState.RECEIVED_HAS_ERROR, TicketEvent.AGENCY_NULLIFY, TicketState.VOID);
    addTransition(TicketState.MODIFIED, TicketEvent.AGENCY_NULLIFY, TicketState.VOID);
    addTransition(TicketState.MODIFIED_NO_ERROR, TicketEvent.AGENCY_NULLIFY, TicketState.VOID);
    addTransition(TicketState.MODIFIED_HAS_ERROR, TicketEvent.AGENCY_NULLIFY, TicketState.VOID);
    addTransition(TicketState.PROCESSED, TicketEvent.AGENCY_NULLIFY, TicketState.VOID);

    // authorize ticket
    addTransition(TicketState.PROCESSED, TicketEvent.AGENCY_AUTHORIZE, TicketState.AUTHORIZED);

    // settle ticket
    addTransition(TicketState.AUTHORIZED, TicketEvent.SETTLE, TicketState.SETTLED);

    // request refund
    addTransition(TicketState.SETTLED, TicketEvent.AGENCY_REFUND_REQUEST, TicketState.REFUND_REQUESTED);

    // authorize refund
    addTransition(TicketState.REFUND_REQUESTED, TicketEvent.AIRLINE_AUTHORIZE, TicketState.REFUND_AUTHORIZED);

    // settle refund
    addTransition(TicketState.REFUND_AUTHORIZED, TicketEvent.REFUND_SETTLE, TicketState.REFUNDED);
  }

  function handleEvent(TicketState _state, TicketEvent _event) returns (TicketState){
    uint newState = FSM.handleEvent(uint(_state), uint(_event));
    if (newState == 0) {
      return TicketState.NULL;
    }
    return TicketState(newState);
  }

  function addTransition(TicketState _state, TicketEvent _event, TicketState _newState) {
    FSM.addTransition(uint(_state), uint(_event), uint(_newState));
  }
}


//import "./TicketState.sol";
// exists

//import "./TicketEvent.sol";
// exists

//import "./TicketSnapshot.sol";
//import "../../../sol/util/contracts/Util.sol";
// exists

//import "./TicketState.sol";
// exists


contract TicketSnapshot is TicketState, Util {

  string      private sped;
  string      private trnnid;
  string      private agtn;

  string      private dais;
  string      private stat;
  string      private tdnr;
  string      private trnc;
  string      private tcnr;
  string      private tacn;

  string      private pnrr;
  string      private tkmi;
  uint        private fare;
  uint        private eqfr;

  string      private tdam;
  string      private cutp;
  bytes32[]   private tmft;
  uint[]      private tmfa;
  string      private cotp;
  uint        private cort;
  uint        private coam;

  uint256     private validationCode;

  TicketState private ticketState;

  uint        private version;
  address     private lastUpdatedBy;
  uint        private lastUpdatedTimestamp;
  uint        private lastUpdatedBlock;

  function TicketSnapshot(bytes32[] _fields,
    uint[] _values,
    bytes32[] _tmft,
    uint[] _tmfa,
    uint _validationCode,
    uint256 _version,
    address _lastUpdatedBy,
    uint _lastUpdatedTimestamp,
    uint _lastUpdatedBlock,
    TicketState _state) {

    uint i = 0;
    sped = bytes32ToString(_fields[i]); i++;
    trnnid = bytes32ToString(_fields[i]); i++;
    agtn = bytes32ToString(_fields[i]); i++;
    dais = bytes32ToString(_fields[i]); i++;
    stat = bytes32ToString(_fields[i]); i++;
    tdnr = bytes32ToString(_fields[i]); i++;
    trnc = bytes32ToString(_fields[i]); i++;
    tcnr = bytes32ToString(_fields[i]); i++;
    tacn = bytes32ToString(_fields[i]); i++;
    pnrr = bytes32ToString(_fields[i]); i++;
    tkmi = bytes32ToString(_fields[i]); i++;
    tdam = bytes32ToString(_fields[i]); i++;
    cutp = bytes32ToString(_fields[i]); i++;
    cotp = bytes32ToString(_fields[i]); i++;

    i = 0;
    fare = _values[i]; i++;
    eqfr = _values[i]; i++;
    cort = _values[i]; i++;
    coam = _values[i]; i++;

    tmft = _tmft;
    tmfa = _tmfa;
    version = _version;

    validationCode = _validationCode;

    lastUpdatedBy = _lastUpdatedBy;
    lastUpdatedTimestamp = _lastUpdatedTimestamp;
    lastUpdatedBlock = _lastUpdatedBlock;

    ticketState = _state;
  }

}


//import "../../audit/AuditLog.sol";
contract AuditLog {

  struct Update {
    bytes32   key;
    bytes32   value;
    bytes32[] values;
    bool      scalar;
  }


  address private sender;
  address private contractAddress;

  string  private contractName;
  string  private method;

  uint256 private blockNumber;
  uint256 private blockTime;
  uint256 private version;

  Update[] private updates;

  function AuditLog(address _sender, address _contractAddress, string _contractName, string _method, uint256 _version) {
    sender          = _sender;
    contractAddress = _contractAddress;
    contractName    = _contractName;
    method          = _method;
    blockNumber     = block.number;
    blockTime       = block.timestamp;
    version         = _version;
  }

  function addUpdate(bytes32 key, bytes32 value, bytes32[] values, bool scalar) public {
    updates.push(Update(key, value, values, scalar));
  }

}


//import "../../../sol/rest/contracts/RestStatus.sol";
// exists

//import "../../../sol/util/contracts/Util.sol";
// exists


contract Ticket is TicketState, TicketEvent, RestStatus, Util {

  TicketFSM   public  ticketFSM;
  TicketState public  ticketState = TicketState.NULL;

  string    private sped;
  string    private trnnid;
  string    private agtn;

  string    private dais;
  string    private stat;
  string    private tdnr;
  string    private trnc;
  string    private tcnr;
  string    private tacn;

  string    private pnrr;
  string    private tkmi;
  uint      public  fare;
  uint      public  eqfr;

  string    private tdam;
  string    private cutp;
  bytes32[] private tmft;
  uint[]    private tmfa;
  string    private cotp;
  uint      public  cort;
  uint      public  coam;

  uint      private validationCode;
  bytes32   private validationMsg;

  uint      private updateCounter; // set update counter
  address   private lastUpdatedBy;
  uint      private lastUpdatedTimestamp;
  uint      private lastUpdatedBlock;

  bytes32[] private fields;
  uint[]    private values;

  function captureSnapshot() private {
    TicketSnapshot ticketSnapshot = new TicketSnapshot(fields,
      values,
      tmft,
      tmfa,
      validationCode,
      updateCounter++,
      lastUpdatedBy,
      lastUpdatedTimestamp,
      lastUpdatedBlock,
      ticketState);

    lastUpdatedBy = tx.origin;
    lastUpdatedTimestamp = block.timestamp;
    lastUpdatedBlock = block.number;
  }

  constructor(bytes32[] _fields, uint[] _values, bytes32[] _tmft, uint[] _tmfa) {
    fields = _fields;
    values = _values;

    uint i = 0;
    sped = bytes32ToString(_fields[i]); i++;
    trnnid = bytes32ToString(_fields[i]); i++;
    agtn = bytes32ToString(_fields[i]); i++;
    dais = bytes32ToString(_fields[i]); i++;
    stat = bytes32ToString(_fields[i]); i++;
    tdnr = bytes32ToString(_fields[i]); i++;
    trnc = bytes32ToString(_fields[i]); i++;
    tcnr = bytes32ToString(_fields[i]); i++;
    tacn = bytes32ToString(_fields[i]); i++;
    pnrr = bytes32ToString(_fields[i]); i++;
    tkmi = bytes32ToString(_fields[i]); i++;
    tdam = bytes32ToString(_fields[i]); i++;
    cutp = bytes32ToString(_fields[i]); i++;
    cotp = bytes32ToString(_fields[i]); i++;

    i = 0;
    fare = _values[i]; i++;
    eqfr = _values[i]; i++;
    cort = _values[i]; i++;
    coam = _values[i]; i++;

    tmft = _tmft;
    tmfa = _tmfa;

    ticketFSM = new TicketFSM();

    lastUpdatedBy = tx.origin;
    lastUpdatedTimestamp = block.timestamp;
    lastUpdatedBlock = block.number;
  }

  function updateTicket(bytes32[] _fields, uint[] _values, bytes32[] _tmft, uint[] _tmfa) {
    captureSnapshot();

    fields = _fields;
    values = _values;

    uint i = 0;
    sped = bytes32ToString(_fields[i]); i++;
    trnnid = bytes32ToString(_fields[i]); i++;
    agtn = bytes32ToString(_fields[i]); i++;
    dais = bytes32ToString(_fields[i]); i++;
    stat = bytes32ToString(_fields[i]); i++;
    // should not be able to update tdnr
    // tdnr = bytes32ToString(_fields[i]);
    i++;
    trnc = bytes32ToString(_fields[i]); i++;
    tcnr = bytes32ToString(_fields[i]); i++;
    tacn = bytes32ToString(_fields[i]); i++;
    pnrr = bytes32ToString(_fields[i]); i++;
    tkmi = bytes32ToString(_fields[i]); i++;
    tdam = bytes32ToString(_fields[i]); i++;
    cutp = bytes32ToString(_fields[i]); i++;
    cotp = bytes32ToString(_fields[i]); i++;

    i = 0;
    fare = _values[i]; i++;
    eqfr = _values[i]; i++;
    cort = _values[i]; i++;
    coam = _values[i]; i++;

    tmft = _tmft;
    tmfa = _tmfa;
  }

  function setStatus(uint code, bytes32 message) public {

    captureSnapshot();


    /* AuditLog auditLog = new AuditLog(msg.sender, address(this), "Ticket", "setStatus", ++updateCounter); */
    /* auditLog.addUpdate(b32("validationCode"), i2b32(validationCode), new bytes32[](0), true); */
    /* auditLog.addUpdate(b32("validationMsg"), validationMsg, new bytes32[](0), true); */

    validationCode = code;
    validationMsg  = message;
  }

  function getTaxLength() public constant returns (uint) {
    return tmfa.length;
  }

  function getTmft(uint i) public constant returns (bytes32) {
    if (i >= tmft.length) { return 0; }
    return tmft[i];
  }

  function getTmfa(uint i) public constant returns (uint) {
    if (i >= tmfa.length) { return 0; }
    return tmfa[i];
  }

  // copied from: https://github.com/blockapps/EChO/blob/develop/server/dapp/deal/gas/contracts/GasDeal.sol#L90
  function handleEvent(TicketEvent _event) public returns (uint, bytes32, TicketState, uint) {
    // check validity
    TicketState newState = ticketFSM.handleEvent(ticketState, _event);
    if (newState == TicketState.NULL) {
      return (RestStatus.BAD_REQUEST, Util.b32("Event not allowed"), TicketState.NULL, 0);
    }

    captureSnapshot();

    /* AuditLog auditLog = new AuditLog(msg.sender, address(this), "Ticket", "setStatus", ++updateCounter); */
    /* auditLog.addUpdate(b32("ticketState"), i2b32(uint256(ticketState)), new bytes32[](0), true); */

    // assume new state
    ticketState = newState;
    return (RestStatus.OK, Util.b32("Ticket State changed successfully"), ticketState, ++updateCounter);
  }

}


//import "./TicketValidator.sol";
//import "../../../sol/util/contracts/Validator.sol";
// exists


contract TicketValidator is Validator {
  function isNotByteArrayLength(bytes32[] _arr, uint _length) public returns (bool) {
    return  _arr.length != _length;
  }

  function isNotIntArrayLength(uint[] _arr, uint _length) public returns (bool) {
    return  _arr.length != _length;
  }
}



contract TicketManager is RestStatus, TicketValidator, TicketEvent, Util {
  /* address owner; */
  Hashmap tickets;
  ValidationEngine engine;
  WingsPermissionManager wingsPermissionManager;

  function TicketManager(address _wingsPermissionManager, address _taxcodeManager) {
    wingsPermissionManager = WingsPermissionManager(_wingsPermissionManager);
    tickets = new Hashmap();
    engine = new ValidationEngine();

    CommAmtBaseFareCapValidation commAmtBaseFareCapValidation = new CommAmtBaseFareCapValidation();
    CommAmtEqFareCapValidation commAmtEqFareCapValidation     = new CommAmtEqFareCapValidation();
    CommAmtMaxCapValidation commAmtMaxCapValidation           = new CommAmtMaxCapValidation();
    CommRateMaxCapValidation commRateMaxCapValidation         = new CommRateMaxCapValidation();
    CommRateOrAmtValidation commRateOrAmtValidation           = new CommRateOrAmtValidation();
    CommRateValidation commRateValidation                     = new CommRateValidation();

    TaxCodeValidation taxCodeValidation   = new TaxCodeValidation(_taxcodeManager);
    TaxValueValidation taxValueValidation = new TaxValueValidation();

    engine.addRule(Util.b32("PROFILE_MONITORY_AMOUNTS"), Util.b32("TAX_CODE_VALIDATION"), taxCodeValidation);
    engine.addRule(Util.b32("PROFILE_MONITORY_AMOUNTS"), Util.b32("TAX_VALUE_VALIDATION"), taxValueValidation);

    engine.addRule(Util.b32("PROFILE_MONITORY_AMOUNTS"), Util.b32("COMM_AMOUNT_BELOW_BASE_FARE_VALIDATION"), commAmtBaseFareCapValidation);
    engine.addRule(Util.b32("PROFILE_MONITORY_AMOUNTS"), Util.b32("COMM_AMOUNT_BELOW_EQ_FARE_VALIDATION"), commAmtEqFareCapValidation);
    engine.addRule(Util.b32("PROFILE_MONITORY_AMOUNTS"), Util.b32("COMM_MAX_AMOUNT_VALIDATION"), commAmtMaxCapValidation);
    engine.addRule(Util.b32("PROFILE_MONITORY_AMOUNTS"), Util.b32("COMM_MAX_RATE_VALIDATION"), commRateMaxCapValidation);
    engine.addRule(Util.b32("PROFILE_MONITORY_AMOUNTS"), Util.b32("COMM_RATE_OR_AMT_VALIDATION"), commRateOrAmtValidation);
    engine.addRule(Util.b32("PROFILE_MONITORY_AMOUNTS"), Util.b32("COMM_RATE_VALIDATION"), commRateValidation);
  }

  function createTicket(bytes32[] _fields, uint[] _values, bytes32[] _tmft, uint[] _tmfa)
  public
  returns (uint, bytes32, address) {

    // if (!wingsPermissionManager.canCreateTicket(tx.origin) ) { return (RestStatus.UNAUTHORIZED, Util.b32("Permission Denied"), 0);        }
    if (isEmptyByteArray(_fields))                           { return (RestStatus.BAD_REQUEST,  Util.b32("Fields array empty"), 0);       }
    if (isEmptyIntArray(_values))                            { return (RestStatus.BAD_REQUEST,  Util.b32("Values array empty"), 0);       }
    if (isNotByteArrayLength(_fields, 14))                   { return (RestStatus.BAD_REQUEST,  Util.b32("Fields length mismatch"), 0);   }
    if (isNotIntArrayLength(_values, 4))                     { return (RestStatus.BAD_REQUEST,  Util.b32("Values length mismatch"), 0);   }
    if (isEmptyByteArray(_tmft))                             { return (RestStatus.BAD_REQUEST,  Util.b32("TMFT empty array"), 0);         }
    if (isEmptyIntArray(_tmfa))                              { return (RestStatus.BAD_REQUEST,  Util.b32("TMFA empty array"), 0);         }

    string memory _tdnr = Util.bytes32ToString(_fields[5]);
    if (tickets.contains(_tdnr))                             { return (RestStatus.BAD_REQUEST,  Util.b32("Ticket ID already exists"), 0); }

    Ticket ticket = new Ticket(_fields, _values, _tmft, _tmfa);
    var (restStatus, eventMsg, , ) = ticket.handleEvent(TicketEvent.RECEIVE);

    if (restStatus != RestStatus.OK) { return (restStatus, eventMsg, 0); }

    var (,status, isValid, message) = engine.validate(ticket, Util.b32("PROFILE_MONITORY_AMOUNTS"));
    ticket.setStatus(status, message);

    // TODO:: check for rest status returned from handleEvent
    if (isValid) {
      ticket.handleEvent(TicketEvent.VALIDATION_PASS);
    } else {
      ticket.handleEvent(TicketEvent.VALIDATION_FAIL);
    }

    // TODO 5 is hard coded
    string memory _id = bytes32ToString(_fields[5]);
    if (isEmptyString(_id)) { return (RestStatus.BAD_REQUEST, Util.b32("ID field empty"), 0);  }

    tickets.put(_id, ticket);
    return (RestStatus.CREATED, Util.b32("Ticket Created successfully"), ticket);
  }

  function updateTicket(string _tdnr, bytes32[] _fields, uint[] _values, bytes32[] _tmft, uint[] _tmfa)
  public
  returns (uint, bytes32) {

    if (!wingsPermissionManager.canUpdateTicket(tx.origin)) { return (RestStatus.UNAUTHORIZED, Util.b32("Permission Denied"));     }
    if (isEmptyString(_tdnr))                               { return (RestStatus.BAD_REQUEST, Util.b32("TDNR is null"));           }
    if (isEmptyByteArray(_fields))                          { return (RestStatus.BAD_REQUEST, Util.b32("Fields array empty"));     }
    if (isEmptyIntArray(_values))                           { return (RestStatus.BAD_REQUEST, Util.b32("Values array empty"));     }
    if (isNotByteArrayLength(_fields, 14))                  { return (RestStatus.BAD_REQUEST, Util.b32("Fields length mismatch")); }
    if (isNotIntArrayLength(_values, 4))                    { return (RestStatus.BAD_REQUEST, Util.b32("Values length mismatch")); }
    if (isEmptyByteArray(_tmft))                            { return (RestStatus.BAD_REQUEST, Util.b32("TMFT empty array"));       }
    if (isEmptyIntArray(_tmfa))                             { return (RestStatus.BAD_REQUEST, Util.b32("TMFA empty array"));       }

    address a = getTicket(_tdnr);
    if (isEmptyAddress(a)) { return (RestStatus.NOT_FOUND, Util.b32("Ticket not found")); }
    Ticket ticket = Ticket(a);
    ticket.updateTicket(_fields, _values, _tmft, _tmfa);
    var (restStatus, eventMsg, , ) = ticket.handleEvent(TicketEvent.DATA_UPDATE);

    if (restStatus != RestStatus.OK) { return (restStatus, eventMsg); }

    var (, status, isValid, message) = engine.validate(ticket, Util.b32("PROFILE_MONITORY_AMOUNTS"));
    ticket.setStatus(status, message);

    // TODO:: check for rest status returned from handleEvent
    if (isValid) {
      ticket.handleEvent(TicketEvent.VALIDATION_PASS);
    } else {
      ticket.handleEvent(TicketEvent.VALIDATION_FAIL);
    }

    return (RestStatus.OK, Util.b32("Ticket Updated successfully"));
  }

  function setVoid(string _tdnr)
  public
  returns (uint, bytes32) {
    if (!wingsPermissionManager.canVoid(tx.origin)) { return (RestStatus.UNAUTHORIZED, Util.b32("Permission Denied")); }
    if (!tickets.contains(_tdnr))                           { return (RestStatus.NOT_FOUND, Util.b32("Ticket ID not found"));  }
    return handleEvent(_tdnr, TicketEvent.AGENCY_NULLIFY);
  }

  function requestRefund(string _tdnr)
  public
  returns (uint, bytes32) {
    if (!wingsPermissionManager.canRequestRefund(tx.origin)) { return (RestStatus.UNAUTHORIZED, Util.b32("Permission Denied")); }
    if (!tickets.contains(_tdnr))                           { return (RestStatus.NOT_FOUND, Util.b32("Ticket ID not found"));  }
    return handleEvent(_tdnr, TicketEvent.AGENCY_REFUND_REQUEST);
  }

  function authorizeRefund(string _tdnr)
  public
  returns (uint, bytes32) {
    if (!wingsPermissionManager.canAuthorizeRefund(tx.origin)) { return (RestStatus.UNAUTHORIZED, Util.b32("Permission Denied")); }
    if (!tickets.contains(_tdnr))                           { return (RestStatus.NOT_FOUND, Util.b32("Ticket ID not found"));  }
    return handleEvent(_tdnr, TicketEvent.AIRLINE_AUTHORIZE);
  }

  function settleRefund(string _tdnr)
  public
  returns (uint, bytes32) {
    if (!wingsPermissionManager.canSettleRefund(tx.origin)) { return (RestStatus.UNAUTHORIZED, Util.b32("Permission Denied")); }
    if (!tickets.contains(_tdnr))                           { return (RestStatus.NOT_FOUND, Util.b32("Ticket ID not found"));  }
    return handleEvent(_tdnr, TicketEvent.REFUND_SETTLE);
  }

  function getTicket(string _id)
  public
  returns (address) {
    return tickets.get(_id);
  }

  function handleEvent(string _tdnr, TicketEvent _event)
  public
  returns (uint, bytes32) {
    if (!wingsPermissionManager.canUpdateTicket(tx.origin)) { return (RestStatus.UNAUTHORIZED, Util.b32("Permission Denied")); }
    if (!tickets.contains(_tdnr))                           { return (RestStatus.NOT_FOUND, Util.b32("Ticket ID not found"));  }
    Ticket ticket = Ticket(getTicket(_tdnr));

    if (isAllowed(_event)) {
      var (restStatus, eventMsg, , ) = ticket.handleEvent(_event);
      return (restStatus, eventMsg);
    } else {
      return (RestStatus.UNAUTHORIZED, Util.b32("Permission Denied"));
    }
  }

  function isAllowed(TicketEvent _event)
  private
  returns (bool) {
    if (_event == TicketEvent.DATA_PROCESS) {
      return wingsPermissionManager.canProcessData(tx.origin);
    }

    if (_event == TicketEvent.AGENCY_AUTHORIZE) {
      return wingsPermissionManager.canAuthorize(tx.origin);
    }

    if (_event == TicketEvent.AGENCY_NULLIFY) {
      return wingsPermissionManager.canVoid(tx.origin);
    }

    if (_event == TicketEvent.SETTLE) {
      return wingsPermissionManager.canSettle(tx.origin);
    }

    if (_event == TicketEvent.AGENCY_REFUND_REQUEST) {
      return wingsPermissionManager.canRequestRefund(tx.origin);
    }

    if (_event == TicketEvent.AIRLINE_AUTHORIZE) {
      return wingsPermissionManager.canAuthorizeRefund(tx.origin);
    }

    if (_event == TicketEvent.REFUND_SETTLE) {
      return wingsPermissionManager.canSettleRefund(tx.origin);
    }

    return true;
  }

}


//import "./Transaction.sol";
contract Transaction {

  string private sped; // system provider reporting period ending date
  string private trnnid; // transaction id
  string private dais; // date of issue
  string private tdnr; // ticket id
  string private trnc; // transaction code, identifies the transaction type
  uint   private txStatus; // transaction status
  string private message; // transaction message

  constructor(string _sped, string _trnnid, string _dais, string _tdnr, string _trnc, uint _txStatus, string _message) {
    sped     = _sped;
    trnnid   = _trnnid;
    dais     = _dais;
    tdnr     = _tdnr;
    trnc     = _trnc;
    txStatus = _txStatus;
    message  = _message;
  }

}



contract TransactionManager is RestStatus, Validator, Util {

  WingsPermissionManager wingsPermissionManager;
  TicketManager ticketManager;
  mapping (string => bool) private isCancelRequest;
  mapping (string => bool) private isCreateRequest;
  mapping (string => bool) private isRefundRequest;

  constructor(address _wingsPermissionManager, address _ticketManager) {
    wingsPermissionManager = WingsPermissionManager(_wingsPermissionManager);
    ticketManager = TicketManager(_ticketManager);
    isCreateRequest["TKTT"] = true;

    isRefundRequest["RFND"] = true;

    isCancelRequest["CANX"] = true;
    isCancelRequest["CANU"] = true;
    isCancelRequest["CANN"] = true;
  }

  function createTicket(bytes32[] _fields, uint[] _values, bytes32[] _tmft, uint[] _tmfa) returns (uint, bytes32, address) {
    // check for permission
    if (!wingsPermissionManager.canCreateTransaction(msg.sender)) { return (RestStatus.UNAUTHORIZED, Util.b32("Permission Denied"), 0); }
    if (!isCreateRequest[bytes32ToString(_fields[6])])            { return (RestStatus.BAD_REQUEST, Util.b32("Not a Create Ticket Request"), 0);  }

    // proxy method for ticket manager
    var (status, message, addr) = ticketManager.createTicket(_fields, _values, _tmft, _tmfa);

    // create new transaction
    new Transaction( bytes32ToString(_fields[0]), bytes32ToString(_fields[1]), bytes32ToString(_fields[3]), bytes32ToString(_fields[5]), bytes32ToString(_fields[6]), status, bytes32ToString(message));

    return (status, message, addr);
  }

  function requestRefund(string _sped, string _trnnid, string _dais, string _tdnr, string _trnc) returns (uint, bytes32) {
    // check for permission
    if (!wingsPermissionManager.canRequestRefund(msg.sender)) { return (RestStatus.UNAUTHORIZED, Util.b32("Permission Denied"));   }
    if (!isRefundRequest[_trnc])                             { return (RestStatus.BAD_REQUEST, Util.b32("Not a Refund Request")); }

    // check if the ticket is available
    if(Validator.isEmptyAddress(ticketManager.getTicket(_tdnr))) { return (RestStatus.NOT_FOUND, Util.b32("Ticket not found")); }

    // proxy method for ticket manager
    var (status, message) = ticketManager.requestRefund(_tdnr);

    // create new transaction
    new Transaction(_sped, _trnnid, _dais, _tdnr, _trnc, status, bytes32ToString(message));

    return (status, message);
  }

  function voidTicket(string _sped, string _trnnid, string _dais, string _tdnr, string _trnc) returns (uint, bytes32) {
    // check for permission
    if (!wingsPermissionManager.canVoid(msg.sender)) { return (RestStatus.UNAUTHORIZED, Util.b32("Permission Denied")); }
    if (!isCancelRequest[_trnc])                             { return (RestStatus.BAD_REQUEST, Util.b32("Not a Cancel Request"));  }

    // check if the ticket is available
    if(Validator.isEmptyAddress(ticketManager.getTicket(_tdnr))) { return (RestStatus.NOT_FOUND, Util.b32("Ticket not found")); }

    // proxy method for ticket manager
    var (status, message) = ticketManager.setVoid(_tdnr);

    // create new transaction
    new Transaction(_sped, _trnnid, _dais, _tdnr, _trnc, status, bytes32ToString(message));

    return (status, message);
  }

}


