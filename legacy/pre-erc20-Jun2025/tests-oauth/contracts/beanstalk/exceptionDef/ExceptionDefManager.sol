import "../RestStatus.sol";

import "./ExceptionDef.sol";
import "./ExceptionType.sol";
import "../dapp/PrivateChainType.sol";
import "../permission/BeanstalkPermissionManager.sol";
import "../eventDef/EventDef.sol";
import "../eventDef/EventDefManager.sol";
import "../dapp/BeanstalkErrorCodes.sol";

/**
* Exception Definition Manager
*
* Entry point to create new exception definition
*
* #see ExceptionDef
*/

contract record ExceptionDefManager is RestStatus, BeanstalkErrorCodes, ExceptionType, PrivateChainType {
  address public dappAddress;
  BeanstalkPermissionManager permissionManager;
  EventDefManager eventDefManager;

  mapping(string => address) exceptionDefs;

  /**
  * Constructor
  */
  constructor (address _dappAddress, address _permissionManager, address _eventDefManager) public {
    dappAddress = _dappAddress;
    permissionManager = BeanstalkPermissionManager(_permissionManager);
    eventDefManager = EventDefManager(_eventDefManager);
  }

  function createExceptionDef(
    string _exceptionId,
    string _eventId,
    ExceptionType _exceptionType,
    uint _minValue,
    uint _maxValue,
    uint _timeout,
    string _template,
    PrivateChainType _chainType,
    bool _enabled
  ) public returns (uint, uint, address) {
    // check permissions
    if (!permissionManager.canCreateExceptionDef(tx.origin)) return (RestStatus.UNAUTHORIZED, BeanstalkErrorCodes.UNAUTHORIZED, tx.origin);
    // exists ?
    if (contains(_exceptionId)) return (RestStatus.CONFLICT, BeanstalkErrorCodes.EXCEPTION_DEF_DUPLICATION, 0);
    (uint restStatus, uint errorCode, address eventDefAddress) = eventDefManager.get(_eventId);
    if (restStatus != RestStatus.OK) return (restStatus, errorCode, address(0));
    string programId = EventDef(eventDefAddress).programId();
    string programName = EventDef(eventDefAddress).programName();
    // create new
    ExceptionDef exceptionDef = new ExceptionDef(
      dappAddress,
      _exceptionId,
      address(permissionManager),
      _eventId,
      programId,
      programName,
      _exceptionType,
      _minValue,
      _maxValue,
      _timeout,
      _template,
      _chainType,
      _enabled
    );

    put(_exceptionId, address(exceptionDef));

    return (RestStatus.CREATED, BeanstalkErrorCodes.NULL, address(exceptionDef));
  }

  function updateExceptionDef(
    string _exceptionId,
    string _eventId,
    ExceptionType _exceptionType,
    uint _minValue,
    uint _maxValue,
    uint _timeout,
    string _template,
    PrivateChainType _chainType,
    bool _enabled
  ) public returns (uint, uint, address) {

    if (!permissionManager.canUpdateExceptionDef(tx.origin)) return (RestStatus.UNAUTHORIZED, BeanstalkErrorCodes.UNAUTHORIZED, tx.origin);

    if (!contains(_exceptionId)) return (RestStatus.NOT_FOUND, BeanstalkErrorCodes.EXCEPTION_DEF_NOT_FOUND, 0);

    ExceptionDef exceptionDef = exceptionDefs[_exceptionId];

    return exceptionDef.update(
      _exceptionType,
      _minValue,
      _maxValue,
      _timeout,
      _template,
      _chainType,
      _enabled
    );
  }


  function put(string _exceptionId, address exceptionDef) public {
    exceptionDefs[_exceptionId] = address(exceptionDef);
  }

  function get(string _exceptionId) public view returns (uint, address) {
    if (!contains(_exceptionId)) return (RestStatus.NOT_FOUND, 0);
    return (RestStatus.OK, exceptionDefs[_exceptionId]);
  }

  function contains(string _exceptionId) public view returns (bool) {
    return exceptionDefs[_exceptionId] != address(0);
  }

  function containsAll(string[] _exceptionIds) public view returns (bool) {
    for (uint i = 0; i < _exceptionIds.length; i++) {
      if (!contains(_exceptionIds[i])) {
        return false;
      }
    }
    return true;
  }

  function containsDuplicate(string[] _exceptionIds) public view returns (bool) {
    for (uint i = 0; i < _exceptionIds.length; i++) {
      for (uint j = i + 1; j < _exceptionIds.length; j++) {
        if (_exceptionIds[i] == _exceptionIds[j]) {
          return true;
        }
      }
    }
    return false;
  }
}
