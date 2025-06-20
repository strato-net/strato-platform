import "../RestStatus.sol";
import "../permission/BeanstalkPermissionManager.sol";
import "../dapp/BeanstalkErrorCodes.sol";
import "../dapp/PrivateChainType.sol";
import "../program/ProgramManager.sol";
import "./EventDef.sol";

/**
* EventDef Manager
*
* Entry point to create new event-definitions and access existing eventDefs by eventId
*
* #see EventDef
*
* #return none
*/

contract record EventDefManager is RestStatus, BeanstalkErrorCodes, PrivateChainType  {
  address public dappAddress;
  BeanstalkPermissionManager permissionManager;
  ProgramManager programManager;

  mapping(string => address) eventDefs;

  /**
  * Constructor
  */
  constructor (address _dappAddress, address _permissionManager, address _programManager) public {
    dappAddress = _dappAddress;
    permissionManager = BeanstalkPermissionManager(_permissionManager);
    programManager = ProgramManager(_programManager);
  }

  function createEventDef(
    PrivateChainType _chainType,
    string _eventCategory,
    string _eventDescription,
    string _eventId,
    string _programId,
    string _eventType,
    string _order,
    string[] _payloadIds,
    string[] _payloadTypes,
    string _source,
    string _uniqueKey
  ) public returns (uint, BeanstalkErrorCodes, address) {
    // check permissions
    if (!permissionManager.canCreateEventDef(tx.origin)) return (RestStatus.UNAUTHORIZED, BeanstalkErrorCodes.UNAUTHORIZED, tx.origin);
    // exists ?
    if (contains(_eventId)) return (RestStatus.CONFLICT, BeanstalkErrorCodes.EVENT_DEF_DUPLICATION, 0);
    (uint restStatus, uint errorCode, address programAddress) = programManager.get(_programId);
    if (restStatus != RestStatus.OK) return (restStatus, errorCode, address(0));
    string programName = Program(programAddress).programName();
    // create new
    EventDef eventDef = new EventDef(
      dappAddress,
      _chainType,
      _eventCategory,
      _eventDescription,
      _eventId,
      _programId,
      programName,
      _eventType,
      _order,
      _payloadIds,
      _payloadTypes,
      _source,
      _uniqueKey
    );

    put(_eventId, address(eventDef));

    return (RestStatus.CREATED, BeanstalkErrorCodes.NULL, address(eventDef));
  }

  function put(string _eventId, address eventDef) public {
    eventDefs[_eventId] = address(eventDef);
  }

  function get(string _eventId) public view returns (uint, BeanstalkErrorCodes, address) {
    if (!contains(_eventId)) return (RestStatus.NOT_FOUND, BeanstalkErrorCodes.EVENT_DEF_NOT_FOUND, 0);
    return (RestStatus.OK, BeanstalkErrorCodes.NULL, eventDefs[_eventId]);
  }

  function contains(string _eventId) public view returns (bool) {
    return eventDefs[_eventId] != address(0);
  }

  function containsAll(string[] _eventIds) public view returns (bool) {
    for (uint i = 0; i < _eventIds.length; i++) {
      if (!contains(_eventIds[i])) {
        return false;
      }
    }
    return true;
  }

  function containsDuplicate(string[] _eventIds) public view returns (bool) {
    for (uint i = 0; i < _eventIds.length; i++) {
      for (uint j = i + 1; j < _eventIds.length; j++) {
        if (_eventIds[i] == _eventIds[j]) {
          return true;
        }
      }
    }
    return false;
  }
}
